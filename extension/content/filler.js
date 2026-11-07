// Filler: receives ESTADO / FILL_STEP / SIGUIENTE / CAPTURAR / APOLLO / GRAPHQL from the side
// panel and walks the field map (mapa-formulario.json) over the current screen.
(() => {
  const E = window.__inyector;
  let MAPA = null;
  async function mapa() {
    if (!MAPA) MAPA = await (await fetch(chrome.runtime.getURL('mapa-formulario.json'))).json();
    return MAPA;
  }
  const get = (obj, path) => (path ? path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj) : obj);
  const report = (payload) => chrome.runtime.sendMessage({ type: 'PROGRESO', ...payload }).catch(() => {});

  // Which map step is on screen. Wizard steps by the "NSO de Cosméticos - <paso>" header;
  // pages outside the wizard (Mezclas) by any heading or breadcrumb.
  function headings() {
    return [...document.querySelectorAll('h1, h2, h3, h4, .ant-page-header-heading-title, .ant-breadcrumb, .ant-card-head-title, .ant-tabs-tab-active')]
      .filter(E.visible).map((x) => x.textContent.trim());
  }
  function stepByHeader(m, header) {
    const h = E.norm(header || '');
    if (h) {
      // longest match first: "Documentos complementarios" before "Documentos"
      const cands = m.pasos.filter((p) => !p.fueraDelTramite && h.includes(E.norm(p.encabezado))).sort((a, b) => b.encabezado.length - a.encabezado.length);
      if (cands.length) return cands[0];
    }
    const hs = headings().map(E.norm);
    return m.pasos.find((p) => p.fueraDelTramite && hs.some((t) => t.includes(E.norm(p.encabezado)))) || null;
  }

  function valueFor(campo, planilla) {
    const v = get(planilla, campo.ruta);
    if (v == null) return null;
    const nombre = (x) => (x && typeof x === 'object' ? x.name ?? null : x);
    if (Array.isArray(v)) return v.map(nombre).filter((x) => x != null && x !== '');
    if ((campo.tipo === 'select' || campo.tipo === 'text') && typeof v === 'object') return v.name ?? null;
    if (campo.tipo === 'number' && typeof v === 'string') return v.replace(',', '.');
    return v;
  }

  function aBool(v) {
    if (typeof v === 'boolean' || v == null) return v ?? null;
    const t = E.norm(v);
    if (['si', 'true', 'yes', 's'].includes(t)) return true;
    if (['no', 'false', 'n'].includes(t)) return false;
    return null; // "desconocido": left empty for the analyst
  }

  // Documents are kept by the side panel; ask it for one when the screen needs it.
  async function pedirDocumento(clave) {
    const r = await chrome.runtime.sendMessage({ type: 'PEDIR_DOCUMENTO', clave });
    if (!r || !r.ok) throw new Error((r && r.error) || 'el panel no entregó el documento «' + clave + '»');
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], r.nombre, { type: r.mime || 'application/pdf' });
  }

  async function fillArchivo(campo, row, ctx, res) {
    const clave = campo.documento || get(row, campo.documentoRuta);
    const doc = (ctx.documentos || []).find((d) => d.clave === clave);
    res.esperado = doc ? doc.nombre : null;
    if (!doc) { res.estado = 'vacio'; res.detalle = 'no hay documento preparado para esta casilla (Preparar documentos en la app)'; return res; }
    const input = (campo.control && E.find(campo.control, ctx.root)) || E.findUpload(campo.claves, ctx.root === document ? null : ctx.root);
    if (!input) { res.estado = 'no-encontrado'; res.detalle = 'no se encontró la casilla de carga (' + (campo.claves || []).map((g) => [].concat(g).join('/')).join(' + ') + ')'; return res; }
    if (ctx.dryRun) { (input.closest('.ant-upload-wrapper, .ant-form-item') || input.parentElement).style.outline = '3px solid #faad14'; res.estado = 'simulado'; return res; }
    const file = await pedirDocumento(clave);
    res.leido = (await E.setFile(input, file)).leido;
    return res;
  }

  async function fillField(campo, planilla, ctx) {
    const res = { campo: campo.etiqueta || campo.ruta, ruta: campo.ruta, esperado: null, leido: null, estado: 'ok', detalle: '' };
    try {
      if (campo.tipo === 'archivo') return await fillArchivo(campo, planilla, ctx, res);
      let value = campo.valor !== undefined ? campo.valor : valueFor(campo, planilla);
      // The extractor writes tri-state answers as "si" / "no" / "desconocido".
      if (campo.tipo === 'switch' || campo.tipo === 'sino') value = aBool(value);
      res.esperado = value;
      if (value == null || value === '' || (Array.isArray(value) && !value.length)) { res.estado = 'vacio'; res.detalle = campo.opcional ? 'no aplica' : 'sin dato en la planilla (decisión pendiente)'; return res; }
      const { el, via, etiqueta } = E.findEx(campo.control, ctx.root);
      if (!el) { res.estado = 'no-encontrado'; res.detalle = 'control no encontrado en la pantalla; revisar el mapa'; return res; }
      if (via === 'etiqueta-aproximada') res.aviso = `ubicado por etiqueta aproximada «${etiqueta}»`;
      if (ctx.dryRun) { el.scrollIntoView({ block: 'center' }); el.style.outline = '3px solid #faad14'; res.estado = 'simulado'; return res; }
      el.scrollIntoView({ block: 'center' });
      switch (campo.tipo) {
        case 'text': case 'number': case 'textarea': res.leido = (await E.setText(el, value)).leido; break;
        case 'switch': res.leido = (await E.setSwitch(el, !!value)).leido; break;
        case 'sino': res.leido = (await E.setRadio(el, value ? 'Sí' : 'No')).leido; res.esperado = value ? 'si' : 'no'; break;
        case 'radio': res.leido = (await E.setRadio(el, value)).leido; break;
        case 'date': res.leido = (await E.setDate(el, value)).leido; res.esperado = E.formatDate(value, (el.matches('input') ? el : el.querySelector('input'))?.getAttribute('placeholder')); break;
        case 'select': {
          const equiv = campo.equivalencias && campo.equivalencias[value];
          const cands = campo.candidatos ? campo.candidatos(value, planilla) : equiv ? [].concat(equiv) : [value];
          const r = await E.selectExact(el, cands);
          res.leido = r.elegido; res.detalle = r.ofrecidos.length > 1 ? 'ofrecidos: ' + r.ofrecidos.slice(0, 6).join(' · ') : '';
          if (equiv) res.esperado = r.elegido;
          // A preference order (reference list UE > PCPC > FDA): any candidate the platform offers is correct.
          if (campo.candidatos && E.norm(r.elegido) !== E.norm(value)) { res.esperado = r.elegido; res.detalle = `«${value}» no se ofrece para este ingrediente; se eligió «${r.elegido}» por el orden de preferencia. ` + res.detalle; }
          break;
        }
        case 'select-multiple': {
          const vals = Array.isArray(value) ? value : [value];
          for (const v of vals) await E.selectExact(el, [v], { multiple: true });
          await E.closeDropdown(el); res.leido = E.readSelect(el); break;
        }
        default: res.estado = 'tipo-desconocido';
      }
      if (res.estado === 'ok' && res.leido != null && typeof res.leido === 'string' && typeof res.esperado === 'string' && E.norm(res.leido) !== E.norm(res.esperado)) res.estado = 'difiere';
      if (res.aviso) res.detalle = (res.aviso + '. ' + res.detalle).trim();
    } catch (e) { res.estado = 'error'; res.detalle = e.message; if (e.ofrecidos) res.detalle += ' · ofrecidos: ' + e.ofrecidos.slice(0, 8).join(' · '); }
    return res;
  }

  // Tables (presentations, ingredients, parameters, blends): one modal per row. Nested tables
  // (a blend's components inside the blend modal) use the modal as root.
  async function fillTable(campo, planilla, ctx) {
    const rows = (get(planilla, campo.ruta) || []).filter((r) => r != null);
    const out = [];
    const root = ctx.root === document ? null : ctx.root;
    const before = E.tableRows(root).length;
    let agregadas = 0;
    for (let i = 0; i < rows.length; i++) {
      if (ctx.debeParar && ctx.debeParar()) { out.push({ campo: campo.etiqueta, estado: 'vacio', detalle: `pausado: faltan ${rows.length - i} filas` }); break; }
      const row = rows[i];
      const label = `${campo.etiqueta} ${i + 1}` + (campo.rotulo ? ' · ' + (get(row, campo.rotulo) ?? '') : '');
      report({ paso: ctx.pasoId, mensaje: `${label}…`, indice: i + 1, total: rows.length });
      if (ctx.dryRun) { out.push({ campo: label, estado: 'simulado' }); continue; }
      let modal;
      try {
        modal = await E.openModal(campo.agregar, root);
        const sub = [];
        for (const sc of campo.modal) {
          const spec = { ...sc };
          if (sc.preferencia === 'listadoReferencia') spec.candidatos = () => (planilla._meta?.criterios?.listados_referencia_prioridad || []).map((r) => r.name);
          const r = sc.tipo === 'tabla' ? await fillTable(spec, row, { ...ctx, root: modal }) : await fillField(spec, row, { ...ctx, root: modal });
          if (Array.isArray(r)) { sub.push(...r); continue; }
          sub.push(r);
          if ((r.estado === 'error' || r.estado === 'no-encontrado') && !sc.opcional) throw Object.assign(new Error(`${r.campo}: ${r.detalle}`), { sub });
        }
        await E.saveModal(modal);
        agregadas++;
        const after = E.tableRows(root).length;
        out.push({ campo: label, estado: after >= before + agregadas ? 'ok' : 'difiere', detalle: after < before + agregadas ? 'la fila no apareció en la tabla' : '', sub });
      } catch (e) {
        if (modal && document.contains(modal)) await E.cancelModal(modal);
        out.push({ campo: label, estado: 'error', detalle: e.message, sub: e.sub || [] });
      }
    }
    return out;
  }

  let parar = false;
  async function runStep(msg) {
    parar = false;
    const m = await mapa();
    const header = E.currentHeader();
    const enPantalla = stepByHeader(m, header);
    const paso = m.pasos.find((p) => p.id === msg.pasoId) || enPantalla;
    if (!paso) return { ok: false, error: 'No reconozco la pantalla actual: ' + (header || headings()[0] || 'sin encabezado') };
    if (enPantalla && enPantalla.id !== paso.id) return { ok: false, error: `La pantalla en el navegador es «${enPantalla.titulo}», no «${paso.titulo}».` };
    const urlId = E.requestIdFromUrl();
    if (!paso.fueraDelTramite && msg.requestId && urlId && String(urlId) !== String(msg.requestId)) return { ok: false, error: `La pestaña muestra la solicitud ${urlId}, no la ${msg.requestId}. Detenido.` };
    const ctx = { pasoId: paso.id, dryRun: !!msg.dryRun, root: document, documentos: msg.documentos || [], debeParar: () => parar };
    const resultados = [];
    if (!paso.soloLectura) {
      for (const campo of paso.campos) {
        if (parar) break;
        report({ paso: paso.id, mensaje: campo.etiqueta || campo.ruta });
        if (campo.tipo === 'tabla') resultados.push(...(await fillTable(campo, msg.planilla, ctx)));
        else resultados.push(await fillField(campo, msg.planilla, ctx));
      }
    }
    await E.sleep(600);
    return { ok: true, paso: paso.id, titulo: paso.titulo, resultados, filas: E.tableRows(), errores: E.validationErrors(), captura: capturarPantalla(), graphql: await readGraphql() };
  }

  async function siguiente(msg) {
    const m = await mapa();
    const antes = E.currentHeader();
    const paso = stepByHeader(m, antes);
    if (!paso) return { ok: false, error: 'No reconozco la pantalla actual.' };
    if (paso.soloLectura || paso.id === 'terminos') return { ok: false, error: 'Términos y condiciones: el inyector se detiene aquí. La aceptación y la radicación las hace usted.' };
    if (msg.desde && paso.id !== msg.desde) return { ok: false, error: `La pantalla cambió a «${paso.titulo}» antes de avanzar.` };
    if (E.validationErrors().length) return { ok: false, error: 'La pantalla tiene errores de validación.', errores: E.validationErrors() };
    await E.next();
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      await E.sleep(300);
      const h = E.currentHeader();
      if (h && h !== antes) {
        await E.sleep(900);
        const p2 = stepByHeader(m, h);
        return { ok: true, desde: paso.id, hacia: p2 ? p2.id : null, encabezado: h };
      }
      const confirm = [...document.querySelectorAll('.ant-modal-confirm, .ant-popover:not(.ant-popover-hidden)')].find(E.visible);
      if (confirm) return { ok: false, error: 'La plataforma pide confirmar: «' + confirm.textContent.trim().slice(0, 200) + '». Responda usted y reanude.' };
      const errs = E.validationErrors();
      if (errs.length && Date.now() - t0 > 1200) return { ok: false, error: 'La plataforma no dejó avanzar.', errores: errs.slice(0, 30) };
    }
    return { ok: false, error: 'La pantalla no cambió en 25 segundos.', errores: E.validationErrors() };
  }

  // Mapping aid: describe every control on the current screen (and an open modal, if any).
  // Read-only: never types or clicks. The panel sends the result to the web app.
  function tipoControl(el) {
    if (!el) return null;
    if (el.matches('.ant-select, .ant-select *')) return el.closest('.ant-select')?.classList.contains('ant-select-multiple') ? 'select-multiple' : 'select';
    if (el.matches('[role=switch], .ant-switch')) return 'switch';
    if (el.closest('.ant-radio-group, [role=radiogroup]')) return 'radio';
    if (el.closest('.ant-picker')) return 'date';
    if (el.matches('textarea')) return 'textarea';
    if (el.matches('input[type=file]')) return 'file';
    if (el.matches('input[type=checkbox]')) return 'checkbox';
    if (el.matches('input[type=number]')) return 'number';
    if (el.matches('input')) return 'text';
    return el.tagName.toLowerCase();
  }
  function capturar(root, sinModales) {
    const fuera = (el) => sinModales && el.closest('.ant-modal, [role=dialog]');
    const items = [];
    for (const item of root.querySelectorAll('.ant-form-item')) {
      if (!E.visible(item) || fuera(item)) continue;
      const lab = item.querySelector('.ant-form-item-label label, .ant-form-item-label');
      const ctl = item.querySelector('.ant-select, [role=switch], .ant-switch, .ant-radio-group, [role=radiogroup], .ant-picker input, textarea, input:not([type=hidden])');
      const idEl = ctl && (ctl.id ? ctl : ctl.querySelector('[id]'));
      const radios = [...item.querySelectorAll('.ant-radio-wrapper, .ant-radio-button-wrapper')].map((r) => r.textContent.trim());
      const pick = item.querySelector('.ant-picker input');
      items.push({
        etiqueta: lab ? lab.textContent.trim().replace(/[:*]+$/, '').trim() : null,
        for: lab && lab.getAttribute && lab.getAttribute('for'),
        id: idEl ? idEl.id : null,
        tipo: tipoControl(ctl),
        requerido: !!item.querySelector('.ant-form-item-required'),
        valor: ctl ? (tipoControl(ctl)?.startsWith('select') ? E.readSelect(ctl.closest('.ant-select') || ctl) : ctl.matches('[role=switch], .ant-switch') ? E.readSwitch(ctl) : (ctl.value ?? null)) : null,
        opciones: radios.length ? radios : undefined,
        placeholder: (pick || ctl)?.getAttribute?.('placeholder') || undefined,
      });
    }
    const botones = [...root.querySelectorAll('button, [role=button]')].filter((b) => E.visible(b) && !fuera(b)).map((b) => b.textContent.trim()).filter(Boolean);
    const tablas = [...root.querySelectorAll('.ant-table')].filter(E.visible).filter((t) => !fuera(t)).map((t) => ({
      columnas: [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      filas: t.querySelectorAll('.ant-table-tbody > tr.ant-table-row').length,
    }));
    const archivos = [...root.querySelectorAll('input[type=file]')].filter((f) => !fuera(f)).map((f) => {
      let zona = f.parentElement; for (let i = 0; i < 4 && zona && zona.textContent.trim().length < 20; i++) zona = zona.parentElement;
      return { id: f.id || null, accept: f.accept || null, multiple: f.multiple, cerca: (zona?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200) };
    });
    return { items, botones, tablas, archivos };
  }
  function capturarPantalla() {
    const modal = [...document.querySelectorAll('.ant-modal-content, [role=dialog]')].find(E.visible);
    return {
      ok: true,
      encabezado: E.currentHeader(),
      paso: E.currentStep(),
      titulos: headings().slice(0, 12),
      url: location.href,
      requestId: E.requestIdFromUrl(),
      fecha: new Date().toISOString(),
      pantalla: capturar(document.querySelector('main, .ant-layout-content') || document.body, true),
      modal: modal ? { titulo: (modal.querySelector('.ant-modal-title, h3, h2')?.textContent || '').trim(), ...capturar(modal) } : null,
    };
  }

  // MAIN-world helpers (main/apollo-reader.js): Apollo cache and the GraphQL calls the page made.
  function aMain(kind, extra) {
    return new Promise((resolve) => {
      const nonce = Math.random().toString(36).slice(2);
      const onMsg = (ev) => { if (ev.data && ev.data.tag === 'invimagil-inyector:apollo' && ev.data.kind === 'result' && ev.data.nonce === nonce) { window.removeEventListener('message', onMsg); resolve(ev.data.result); } };
      window.addEventListener('message', onMsg);
      window.postMessage({ tag: 'invimagil-inyector:apollo', kind, nonce, ...extra }, '*');
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ ok: false, reason: 'timeout' }); }, 3000);
    });
  }
  const readApollo = (requestId) => aMain('read', { requestId });
  async function readGraphql() { const r = await aMain('graphql', {}); return r && r.ok ? r.operaciones : []; }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const tipos = ['ESTADO', 'FILL_STEP', 'SIGUIENTE', 'PARAR', 'APOLLO', 'GRAPHQL', 'CAPTURAR'];
    if (!tipos.includes(msg.type)) return false;
    (async () => {
      try {
        if (msg.type === 'ESTADO') {
          const m = await mapa();
          const p = stepByHeader(m, E.currentHeader());
          return sendResponse({ ok: true, encabezado: E.currentHeader(), paso: p ? p.titulo : E.currentStep(), pasoId: p ? p.id : null, requestId: E.requestIdFromUrl(), url: location.href, puedeAvanzar: !!E.nextButton() });
        }
        if (msg.type === 'FILL_STEP') return sendResponse(await runStep(msg));
        if (msg.type === 'SIGUIENTE') return sendResponse(await siguiente(msg));
        if (msg.type === 'PARAR') { parar = true; return sendResponse({ ok: true }); }
        if (msg.type === 'APOLLO') return sendResponse(await readApollo(msg.requestId));
        if (msg.type === 'GRAPHQL') return sendResponse({ ok: true, operaciones: await readGraphql() });
        if (msg.type === 'CAPTURAR') return sendResponse({ ...capturarPantalla(), graphql: await readGraphql() });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  });
})();
