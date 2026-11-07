// Side panel: choose the trámite sent by the web app (or a local folder), drive the content
// script, show the verification, and queue results for the web app (chrome.storage.local.salida).
const $ = (s) => document.querySelector(s);
let planilla = null, tramite = null, dirHandle = null, ultimoResultado = null;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
$('#version').textContent = 'v' + chrome.runtime.getManifest().version;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  if (!/^https:\/\/invimagil\.invima\.gov\.co\//.test(url) && !/^http:\/\/localhost:8765\/tools\//.test(url)) throw new Error('La pestaña activa no es InvimÁgil.');
  return tab;
}
let tabFija = null; // the autopilot keeps talking to the tab it started on
async function send(msg) {
  const tab = tabFija || (await activeTab());
  return chrome.tabs.sendMessage(tab.id, msg);
}

// Planilla shape adjustments for the filler (the stored copy is not modified).
function preparar(original) {
  const p = structuredClone(original);
  const t = p.technicalCharacteristics || {};
  if (t.organoleptic && !Array.isArray(t.organoleptic)) t.organolepticRows = [t.organoleptic];
  if (p.general && p.general.manufacturer && typeof p.general.manufacturer.type === 'string') p.general.manufacturer.type = [p.general.manufacturer.type];
  if (p.initialValidation && p.initialValidation.answers) {
    for (const [k, v] of Object.entries(p.initialValidation.answers)) {
      const t = norm(v);
      p.initialValidation.answers[k] = v === true || t === 'si' ? 'Sí' : v === false || t === 'no' ? 'No' : null;
    }
  }
  // Complementary documents prepared by the web app (claves adicional-1, adicional-2, …)
  p._documentosAdicionales = documentos().filter((d) => d.clave.startsWith('adicional')).map((d) => ({ clave: d.clave, descripcion: d.titulo }));
  return p;
}
const documentos = () => (tramite && Array.isArray(tramite.documentos) ? tramite.documentos : []);

function mostrarProducto(p, extra) {
  planilla = preparar(p);
  const m = p._meta || {};
  $('#p-nombre').textContent = m.producto || extra.nombre || '';
  const nIng = (p.composition?.ingredients || []).length, nPres = (p.general?.presentations || []).length, nDec = (p.decisiones || []).length;
  $('#p-resumen').textContent = [extra.cliente, `${nIng} ingredientes`, `${nPres} presentaciones`, extra.version ? `planilla v${extra.version}` : m.generado].filter(Boolean).join(' · ');
  $('#p-decisiones').classList.toggle('hidden', nDec === 0);
  $('#p-decisiones').textContent = nDec ? `${nDec} decisiones pendientes: esos campos quedarán vacíos (${(p.decisiones || []).map((d) => d.id).join(', ')}).` : '';
  const nMez = (p.composition?.blends || []).length;
  $('#p-mezclas').classList.toggle('hidden', nMez === 0);
  $('#p-mezclas').textContent = nMez ? `Antes de Composición: ${nMez} mezcla(s) (${p.composition.blends.map((b) => b.name).join(', ')}). Abra Administración de Ingredientes → Mezclas y pulse «Crear las mezclas».` : '';
  const docs = documentos();
  $('#p-documentos').classList.remove('hidden');
  $('#p-documentos').textContent = docs.length ? `${docs.length} documentos listos para cargar (${docs.reduce((s, d) => s + (d.mb || 0), 0).toFixed(1)} MB).` : 'Sin documentos preparados: en la app pulse «Preparar documentos» y vuelva a enviar el trámite.';
  $('#producto').classList.remove('hidden');
  $('#s-solicitud').classList.remove('hidden');
  $('#s-accion').classList.remove('hidden');
  if (extra.invimaId) $('#req-id').value = extra.invimaId;
  refrescarEstado();
}

// ---- Trámites received from the web app --------------------------------------------------
async function cargarLista() {
  const { tramites = {}, activo } = await chrome.storage.local.get(['tramites', 'activo']);
  const sel = $('#sel-tramite');
  const lista = Object.values(tramites).sort((a, b) => (b.recibido || '').localeCompare(a.recibido || ''));
  sel.innerHTML = '<option value="">' + (lista.length ? '— Elija un trámite —' : '— Ninguno recibido —') + '</option>' +
    lista.map((t) => `<option value="${t.tramiteId}">${(t.producto || t.carpeta || t.tramiteId).replace(/</g, '&lt;')}${t.cliente ? ' · ' + t.cliente.replace(/</g, '&lt;') : ''}</option>`).join('');
  $('#ayuda-tramite').classList.toggle('hidden', lista.length > 0);
  if (activo && tramites[activo]) { sel.value = activo; elegir(tramites[activo]); }
}
function elegir(t) {
  tramite = t; dirHandle = null;
  mostrarProducto(t.planilla, { nombre: t.producto, cliente: t.cliente, version: t.version, invimaId: t.invimaId });
}
$('#sel-tramite').addEventListener('change', async (e) => {
  const { tramites = {} } = await chrome.storage.local.get('tramites');
  await chrome.storage.local.set({ activo: e.target.value || null });
  if (tramites[e.target.value]) elegir(tramites[e.target.value]);
});
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.tramites || ch.activo)) cargarLista(); });

// ---- Local folder fallback (InvimÁgil Base on Windows) -------------------------------------
$('#btn-carpeta').addEventListener('click', async () => {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    let base = dirHandle;
    try { base = await dirHandle.getDirectoryHandle('_invimagil'); } catch { /* user may have picked _invimagil itself */ }
    const fh = await base.getFileHandle('planilla.json');
    const p = JSON.parse(await (await fh.getFile()).text());
    tramite = null;
    $('#sel-tramite').value = '';
    mostrarProducto(p, { nombre: dirHandle.name, invimaId: p._meta?.invimaId });
  } catch (e) { alert('No se pudo leer la carpeta: ' + e.message + '\nElija la carpeta del producto que ya tiene _invimagil/planilla.json.'); }
});

async function refrescarEstado() {
  try {
    const st = await send({ type: 'ESTADO' });
    $('#estado-url').textContent = st.url ? new URL(st.url).pathname : '—';
    $('#estado-paso').textContent = st.paso || 'no reconocida';
    if (st.requestId && !$('#req-id').value) $('#req-id').value = st.requestId;
  } catch (e) { $('#estado-paso').textContent = e.message; }
}
chrome.tabs.onUpdated.addListener(() => refrescarEstado());
chrome.tabs.onActivated.addListener(() => refrescarEstado());
const cacheDocs = new Map();
async function base64De(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`descarga ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PROGRESO') { $('#progreso').textContent = (msg.indice ? `${msg.indice}/${msg.total} · ` : '') + msg.mensaje; return false; }
  if (msg.type === 'PEDIR_DOCUMENTO') {
    (async () => {
      try {
        const d = documentos().find((x) => x.clave === msg.clave);
        if (!d) return sendResponse({ ok: false, error: 'documento «' + msg.clave + '» no preparado' });
        if (!cacheDocs.has(d.url)) cacheDocs.set(d.url, await base64De(d.url));
        sendResponse({ ok: true, nombre: d.nombre, mime: d.mime || 'application/pdf', base64: cacheDocs.get(d.url) });
      } catch (e) { sendResponse({ ok: false, error: 'no se pudo descargar «' + msg.clave + '»: ' + e.message + '. Vuelva a enviar el trámite desde la app (los enlaces vencen).' }); }
    })();
    return true;
  }
  return false;
});

// ---- Verification table -------------------------------------------------------------------
const { clase, contar } = window.Autopiloto;
function pintar(res) {
  ultimoResultado = res;
  const tb = $('#res-tabla tbody'); tb.innerHTML = '';
  const fila = (r, sangria) => {
    const tr = document.createElement('tr');
    const cls = clase(r);
    const icon = { ok: '✓', simulado: '◌', vacio: '…', difiere: '≠', error: '✗', 'no-encontrado': '?', 'tipo-desconocido': '?' }[r.estado] || r.estado;
    tr.innerHTML = `<td>${sangria ? '&nbsp;&nbsp;↳ ' : ''}${esc(r.campo)}</td><td>${esc(fmt(r.esperado))}</td><td>${esc(fmt(r.leido))}</td><td class="${cls}" title="${esc(r.detalle || '')}">${icon}</td>`;
    tb.appendChild(tr);
    if (r.detalle && cls !== 'ok') { const t2 = document.createElement('tr'); t2.innerHTML = `<td colspan="4" class="muted">${esc(r.detalle)}</td>`; tb.appendChild(t2); }
    (r.sub || []).forEach((s) => fila(s, true));
  };
  res.resultados.forEach((r) => fila(r, false));
  const c = contar(res.resultados);
  const errs = (res.errores || []).length ? `<div class="mal">La plataforma marca: ${res.errores.map(esc).join(' · ')}</div>` : '';
  $('#res-resumen').innerHTML = `<b>${esc(res.titulo)}</b>: <span class="ok">${c.ok} correctos</span> · <span class="mal">${c.mal} con problema</span> · <span class="pend">${c.pend} sin dato</span>.${errs}`;
  $('#s-resultado').classList.remove('hidden');
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v) => v == null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v);

// ---- Results back to the web app ------------------------------------------------------------
async function encolar(item) {
  const { salida = [] } = await chrome.storage.local.get('salida');
  salida.push({ id: uid(), fecha: new Date().toISOString(), ...item });
  await chrome.storage.local.set({ salida: salida.slice(-200) });
}
function problemas(resultados) {
  const out = [];
  const walk = (r, padre) => {
    if (clase(r) !== 'ok') out.push({ campo: (padre ? padre + ' › ' : '') + r.campo, estado: r.estado, esperado: fmt(r.esperado), leido: fmt(r.leido), detalle: r.detalle || '' });
    (r.sub || []).forEach((s) => walk(s, r.campo));
  };
  resultados.forEach((r) => walk(r, ''));
  return out.slice(0, 300);
}
async function registrar(res, requestId) {
  const c = contar(res.resultados);
  // Every visited screen also leaves a capture (controls + the platform's GraphQL calls): it is
  // what keeps the map in step with the real platform.
  if (res.captura && !res.simulado) await encolar({ tipo: 'captura', tramiteId: tramite?.tramiteId || null, paso: res.paso, captura: { ...res.captura, graphql: res.graphql || [] } });
  if (tramite) {
    await encolar({ tipo: 'verificacion', tramiteId: tramite.tramiteId, version: tramite.version, requestId, paso: res.paso, titulo: res.titulo, simulado: !!res.simulado, ok: c.ok, mal: c.mal, pend: c.pend, problemas: problemas(res.resultados), errores: res.errores || [] });
    $('#res-envio').textContent = 'La verificación se enviará a SPI Sistematización cuando la app esté abierta.';
  } else if (dirHandle) {
    await guardarEnCarpeta(res);
    $('#res-envio').textContent = 'Registro guardado en _invimagil/log-inyeccion.md.';
  }
}
async function guardarEnCarpeta(res) {
  let base = dirHandle; try { base = await dirHandle.getDirectoryHandle('_invimagil', { create: true }); } catch {}
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const fh = await base.getFileHandle('log-inyeccion.md', { create: true });
  const prev = await (await fh.getFile()).text();
  const c = contar(res.resultados);
  const probs = problemas(res.resultados).map((p) => `${p.campo}: ${p.detalle || p.estado}`).join('; ').replace(/\|/g, '/') || '—';
  const w = await fh.createWritable();
  await w.write((prev || '# Log de inyección\n\n| Fecha | Pantalla | Resultado | Problemas |\n|---|---|---|---|\n') + `| ${stamp} | ${res.titulo} | ${c.ok} ok · ${c.mal} con problema · ${c.pend} sin dato | ${probs} |\n`);
  await w.close();
  const vh = await base.getFileHandle(`verificacion-${norm(res.paso || 'paso')}.json`, { create: true });
  const vw = await vh.createWritable(); await vw.write(JSON.stringify(res, null, 1)); await vw.close();
}

$('#btn-llenar').addEventListener('click', async () => {
  if (!planilla) return;
  const reqId = $('#req-id').value.trim();
  if (!reqId) return alert('Escriba el Id de la solicitud que aparece en pantalla.');
  const dry = $('#dry').checked;
  $('#btn-llenar').disabled = true; $('#progreso').textContent = 'Iniciando…'; $('#res-envio').textContent = '';
  try {
    const res = await send({ type: 'FILL_STEP', planilla, requestId: reqId, dryRun: dry, documentos: documentos() });
    if (!res.ok) { alert(res.error); return; }
    res.simulado = dry;
    pintar(res);
    await registrar(res, reqId);
  } catch (e) { alert('Error: ' + e.message); }
  finally { $('#btn-llenar').disabled = false; $('#progreso').textContent = ''; }
});

$('#btn-verificar').addEventListener('click', async () => {
  try {
    const r = await send({ type: 'APOLLO', requestId: $('#req-id').value.trim() });
    if (!r.ok) return alert('No se pudo leer lo guardado por la plataforma (' + r.reason + '). La verificación por pantalla sigue válida.');
    const c = r.request.content || {};
    alert(`Lo que la plataforma tiene guardado:\n· producto: ${c.general?.product?.name || '—'}\n· ingredientes: ${(c.composition?.ingredients || []).length}\n· presentaciones: ${(c.general?.presentations || []).length}\n· paso tocado: ${c.touchedStep || '—'}`);
  } catch (e) { alert('Error: ' + e.message); }
});

// ---- Autopilot ---------------------------------------------------------------------------
let pausar = false;
$('#btn-todo').addEventListener('click', async () => {
  if (!planilla) return;
  const reqId = $('#req-id').value.trim();
  if (!reqId) return alert('Escriba el Id de la solicitud que aparece en pantalla.');
  try { tabFija = await activeTab(); } catch (e) { return alert(e.message); }
  pausar = false;
  $('#btn-todo').disabled = true; $('#btn-llenar').disabled = true;
  $('#btn-pausar').classList.remove('hidden');
  $('#auto-pasos').innerHTML = ''; $('#res-envio').textContent = '';
  try {
    const fin = await window.Autopiloto.correr({
      send, planilla, requestId: reqId, documentos: documentos(),
      detenerEnProblemas: $('#detener').checked,
      debeParar: () => pausar,
      onEstado: (t) => { $('#auto-estado').textContent = t; },
      onPaso: async (res) => {
        pintar(res);
        await registrar(res, reqId);
        const c = contar(res.resultados);
        const li = document.createElement('li');
        li.innerHTML = `${esc(res.titulo)}: <span class="ok">${c.ok} ok</span> · <span class="${c.mal ? 'mal' : 'muted'}">${c.mal} con problema</span> · ${c.pend} sin dato`;
        $('#auto-pasos').appendChild(li);
      },
    });
    const base = window.Autopiloto.MENSAJES[fin.fin] || fin.fin;
    const det = [fin.error, ...(fin.errores || [])].filter(Boolean).join(' · ');
    $('#auto-estado').innerHTML = `<b>${esc(base)}</b>${det ? '<br>' + esc(det) : ''}`;
    if (tramite) await encolar({ tipo: 'recorrido', tramiteId: tramite.tramiteId, version: tramite.version, requestId: reqId, fin: fin.fin, detalle: det, pasos: fin.visitados.map((v) => ({ paso: v.paso, titulo: v.titulo, ...contar(v.resultados) })) });
  } catch (e) { $('#auto-estado').textContent = 'Error: ' + e.message; }
  finally {
    tabFija = null;
    $('#btn-todo').disabled = false; $('#btn-llenar').disabled = false;
    $('#btn-pausar').classList.add('hidden'); $('#progreso').textContent = '';
  }
});
$('#btn-pausar').addEventListener('click', async () => {
  pausar = true;
  $('#auto-estado').textContent = 'Pausando al terminar el campo actual…';
  try { await send({ type: 'PARAR' }); } catch {}
});

$('#btn-mezclas').addEventListener('click', async () => {
  if (!planilla) return;
  if (!(planilla.composition?.blends || []).length) return alert('La planilla no tiene mezclas.');
  $('#btn-mezclas').disabled = true; $('#progreso').textContent = 'Creando mezclas…';
  try {
    const res = await send({ type: 'FILL_STEP', pasoId: 'mezclas', planilla, dryRun: $('#dry').checked, documentos: [] });
    if (!res.ok) return alert(res.error);
    res.simulado = $('#dry').checked;
    pintar(res);
    await registrar(res, $('#req-id').value.trim());
  } catch (e) { alert('Error: ' + e.message); }
  finally { $('#btn-mezclas').disabled = false; $('#progreso').textContent = ''; }
});

$('#btn-capturar').addEventListener('click', async () => {
  try {
    const cap = await send({ type: 'CAPTURAR' });
    await encolar({ tipo: 'captura', tramiteId: tramite?.tramiteId || null, paso: cap.paso, captura: cap });
    const n = cap.pantalla.items.length + (cap.modal ? cap.modal.items.length : 0);
    $('#captura-estado').textContent = `${cap.paso || cap.encabezado || 'pantalla'}: ${n} controles capturados${cap.modal ? ' (incluye el modal abierto)' : ''}. Se enviará a la app.`;
  } catch (e) { $('#captura-estado').textContent = 'Error: ' + e.message; }
});

cargarLista();
