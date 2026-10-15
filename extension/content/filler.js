// Filler: receives FILL_STEP / VERIFY_STEP / DRY_RUN from the side panel, walks the field map.
(() => {
  const E = window.__inyector;
  let MAPA = null;
  async function mapa() {
    if (!MAPA) MAPA = await (await fetch(chrome.runtime.getURL('mapa-formulario.json'))).json();
    return MAPA;
  }
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const report = (payload) => chrome.runtime.sendMessage({ type: 'PROGRESO', ...payload }).catch(() => {});

  function stepByHeader(m, header) {
    const h = E.norm(header || '');
    return m.pasos.find((p) => h.includes(E.norm(p.encabezado)));
  }

  // Resolve the value(s) for a field from planilla.
  function valueFor(campo, planilla) {
    const v = get(planilla, campo.ruta);
    if (v == null) return null;
    if (campo.tipo === 'select' && typeof v === 'object') return v.name ?? null;
    return v;
  }

  async function fillField(campo, planilla, ctx) {
    const el = E.find(campo.control, ctx.root);
    const value = campo.valor !== undefined ? campo.valor : valueFor(campo, planilla);
    const res = { campo: campo.etiqueta || campo.ruta, ruta: campo.ruta, esperado: value, leido: null, estado: 'ok', detalle: '' };
    if (value == null || value === '') { res.estado = 'vacio'; res.detalle = 'sin dato en la planilla (decisión pendiente)'; return res; }
    if (!el) { res.estado = 'no-encontrado'; res.detalle = 'control no encontrado en la pantalla; revisar el mapa'; return res; }
    if (ctx.dryRun) { el.scrollIntoView({ block: 'center' }); el.style.outline = '3px solid #faad14'; res.estado = 'simulado'; return res; }
    try {
      switch (campo.tipo) {
        case 'text': case 'number': case 'textarea': res.leido = (await E.setText(el, value)).leido; break;
        case 'switch': res.leido = (await E.setSwitch(el, !!value)).leido; break;
        case 'sino': res.leido = (await E.setRadio(el, value ? 'Sí' : 'No')).leido; res.esperado = value ? 'si' : 'no'; break;
        case 'radio': res.leido = (await E.setRadio(el, value)).leido; break;
        case 'date': res.leido = (await E.setDate(el, value)).leido; break;
        case 'select': {
          const r = await E.selectExact(el, campo.candidatos ? campo.candidatos(value, planilla) : [value]);
          res.leido = r.elegido; res.detalle = r.ofrecidos.length > 1 ? 'ofrecidos: ' + r.ofrecidos.slice(0, 6).join(' · ') : '';
          break;
        }
        case 'select-multiple': {
          const vals = Array.isArray(value) ? value : [value];
          for (const v of vals) await E.selectExact(el, [v], { multiple: true });
          await E.closeDropdown(el); res.leido = E.readSelect(el); break;
        }
        default: res.estado = 'tipo-desconocido';
      }
      if (res.estado === 'ok' && res.leido != null && typeof res.leido === 'string' && typeof value === 'string' && E.norm(res.leido) !== E.norm(value)) { res.estado = 'difiere'; }
    } catch (e) { res.estado = 'error'; res.detalle = e.message; if (e.ofrecidos) res.detalle += ' · ofrecidos: ' + e.ofrecidos.slice(0, 8).join(' · '); }
    return res;
  }

  // Tables (presentaciones, ingredientes, parámetros): one modal per row.
  async function fillTable(campo, planilla, ctx) {
    const rows = get(planilla, campo.ruta) || [];
    const out = [];
    const before = E.tableRows().length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const label = campo.etiquetaFila ? campo.etiquetaFila(row) : `${campo.etiqueta} ${i + 1}`;
      report({ paso: ctx.pasoId, mensaje: `${label}…`, indice: i + 1, total: rows.length });
      if (ctx.dryRun) { out.push({ campo: label, estado: 'simulado' }); continue; }
      let modal;
      try {
        modal = await E.openModal(campo.agregar);
        const sub = [];
        for (const sc of campo.modal) {
          const spec = { ...sc };
          // candidatos: for the reference list apply SPI preference order among what the platform offers
          if (sc.preferencia === 'listadoReferencia') spec.candidatos = () => (planilla._meta?.criterios?.listados_referencia_prioridad || []).map((r) => r.name);
          const r = await fillField(spec, row, { ...ctx, root: modal });
          sub.push(r);
          if (r.estado === 'error' || r.estado === 'no-encontrado') throw Object.assign(new Error(`${r.campo}: ${r.detalle}`), { sub });
        }
        await E.saveModal(modal);
        const after = E.tableRows().length;
        out.push({ campo: label, estado: after > before + out.filter((o) => o.estado === 'ok').length ? 'ok' : 'difiere', detalle: after <= before ? 'la fila no apareció en la tabla' : '', sub });
      } catch (e) {
        if (modal) await E.cancelModal(modal);
        out.push({ campo: label, estado: 'error', detalle: e.message, sub: e.sub || [] });
      }
    }
    return out;
  }

  async function runStep(msg) {
    const m = await mapa();
    const paso = m.pasos.find((p) => p.id === msg.pasoId) || stepByHeader(m, E.currentHeader());
    if (!paso) return { ok: false, error: 'No reconozco la pantalla actual: ' + (E.currentHeader() || 'sin encabezado') };
    const header = E.currentHeader();
    if (header && !E.norm(header).includes(E.norm(paso.encabezado))) return { ok: false, error: `La pantalla en el navegador es «${header}», no «${paso.titulo}».` };
    const urlId = E.requestIdFromUrl();
    if (msg.requestId && urlId && String(urlId) !== String(msg.requestId)) return { ok: false, error: `La pestaña muestra la solicitud ${urlId}, no la ${msg.requestId}. Detenido.` };
    const ctx = { pasoId: paso.id, dryRun: !!msg.dryRun, root: document };
    const resultados = [];
    for (const campo of paso.campos) {
      report({ paso: paso.id, mensaje: campo.etiqueta || campo.ruta });
      if (campo.tipo === 'tabla') resultados.push(...(await fillTable(campo, msg.planilla, ctx)));
      else resultados.push(await fillField(campo, msg.planilla, ctx));
    }
    return { ok: true, paso: paso.id, titulo: paso.titulo, resultados, filas: E.tableRows() };
  }

  function readApollo(requestId) {
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      const onMsg = (ev) => { if (ev.data && ev.data.tag === 'invimagil-inyector:apollo' && ev.data.kind === 'result' && ev.data.nonce === nonce) { window.removeEventListener('message', onMsg); resolve(ev.data.result); } };
      window.addEventListener('message', onMsg);
      window.postMessage({ tag: 'invimagil-inyector:apollo', kind: 'read', nonce, requestId }, '*');
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ ok: false, reason: 'timeout' }); }, 3000);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'ESTADO') return sendResponse({ ok: true, encabezado: E.currentHeader(), paso: E.currentStep(), requestId: E.requestIdFromUrl(), url: location.href });
        if (msg.type === 'FILL_STEP') return sendResponse(await runStep(msg));
        if (msg.type === 'APOLLO') return sendResponse(await readApollo(msg.requestId));
        sendResponse({ ok: false, error: 'mensaje desconocido' });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  });
})();
