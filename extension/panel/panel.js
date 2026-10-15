// Side panel: pick the product folder, read _invimagil/planilla.json, drive the content script, show verification.
const $ = (s) => document.querySelector(s);
let dirHandle = null, planilla = null, ultimoResultado = null;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/invimagil\.invima\.gov\.co\//.test(tab.url || '')) throw new Error('La pestaña activa no es InvimÁgil.');
  return tab;
}
async function send(msg) {
  const tab = await activeTab();
  return chrome.tabs.sendMessage(tab.id, msg);
}

// Planilla shape adjustments for the filler (keeps planilla.json untouched on disk).
function preparar(p) {
  const t = p.technicalCharacteristics || {};
  if (t.organoleptic && !Array.isArray(t.organoleptic)) t.organolepticRows = [t.organoleptic];
  if (p.general && p.general.manufacturer && typeof p.general.manufacturer.type === 'string') p.general.manufacturer.type = [p.general.manufacturer.type];
  if (p.initialValidation && p.initialValidation.answers) {
    for (const [k, v] of Object.entries(p.initialValidation.answers)) if (typeof v === 'boolean') p.initialValidation.answers[k] = v ? 'Sí' : 'No';
  }
  return p;
}

$('#btn-carpeta').addEventListener('click', async () => {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    let base = dirHandle;
    try { base = await dirHandle.getDirectoryHandle('_invimagil'); } catch { /* user may have picked _invimagil itself */ }
    const fh = await base.getFileHandle('planilla.json');
    planilla = preparar(JSON.parse(await (await fh.getFile()).text()));
    const m = planilla._meta || {};
    $('#p-nombre').textContent = m.producto || dirHandle.name;
    const nIng = (planilla.composition?.ingredients || []).length, nPres = (planilla.general?.presentations || []).length, nDec = (planilla.decisiones || []).length;
    $('#p-resumen').textContent = `${nIng} ingredientes · ${nPres} presentaciones · generado ${m.generado || '?'}`;
    $('#p-decisiones').classList.toggle('hidden', nDec === 0);
    $('#p-decisiones').textContent = nDec ? `${nDec} decisiones pendientes: esos campos quedarán vacíos (${(planilla.decisiones || []).map((d) => d.id).join(', ')}).` : '';
    $('#producto').classList.remove('hidden');
    $('#s-solicitud').classList.remove('hidden');
    $('#s-accion').classList.remove('hidden');
    await refrescarEstado();
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESO') $('#progreso').textContent = (msg.indice ? `${msg.indice}/${msg.total} · ` : '') + msg.mensaje;
});

function pintar(res) {
  ultimoResultado = res;
  const tb = $('#res-tabla tbody'); tb.innerHTML = '';
  let ok = 0, mal = 0, pend = 0;
  const fila = (r, sangria) => {
    const tr = document.createElement('tr');
    const cls = r.estado === 'ok' || r.estado === 'simulado' ? 'ok' : r.estado === 'vacio' ? 'pend' : 'mal';
    if (cls === 'ok') ok++; else if (cls === 'pend') pend++; else mal++;
    const icon = { ok: '✓', simulado: '◌', vacio: '…', difiere: '≠', error: '✗', 'no-encontrado': '?', 'tipo-desconocido': '?' }[r.estado] || r.estado;
    tr.innerHTML = `<td>${sangria ? '&nbsp;&nbsp;↳ ' : ''}${r.campo}</td><td>${fmt(r.esperado)}</td><td>${fmt(r.leido)}</td><td class="${cls}" title="${(r.detalle || '').replace(/"/g, '&quot;')}">${icon}</td>`;
    tb.appendChild(tr);
    if (r.detalle && cls !== 'ok') { const t2 = document.createElement('tr'); t2.innerHTML = `<td colspan="4" class="muted">${r.detalle}</td>`; tb.appendChild(t2); }
    (r.sub || []).forEach((s) => fila(s, true));
  };
  res.resultados.forEach((r) => fila(r, false));
  $('#res-resumen').innerHTML = `<b>${res.titulo}</b>: <span class="ok">${ok} correctos</span> · <span class="mal">${mal} con problema</span> · <span class="pend">${pend} sin dato</span>. Revise, corrija a mano lo marcado y pulse <b>Siguiente</b> usted.`;
  $('#s-resultado').classList.remove('hidden');
}
const fmt = (v) => v == null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v);

$('#btn-llenar').addEventListener('click', async () => {
  if (!planilla) return;
  const reqId = $('#req-id').value.trim();
  if (!reqId) return alert('Escriba el Id de la solicitud que aparece en pantalla.');
  $('#btn-llenar').disabled = true; $('#progreso').textContent = 'Iniciando…';
  try {
    const res = await send({ type: 'FILL_STEP', planilla, requestId: reqId, dryRun: $('#dry').checked });
    if (!res.ok) { alert(res.error); return; }
    pintar(res);
  } catch (e) { alert('Error: ' + e.message); }
  finally { $('#btn-llenar').disabled = false; $('#progreso').textContent = ''; }
});

$('#btn-verificar').addEventListener('click', async () => {
  try {
    const r = await send({ type: 'APOLLO', requestId: $('#req-id').value.trim() });
    if (!r.ok) return alert('No se pudo leer lo guardado por la plataforma (' + r.reason + '). La verificación por pantalla sigue válida.');
    const c = r.request.content || {};
    const n = (c.composition?.ingredients || []).length;
    alert(`Lo que la plataforma tiene guardado:\n· producto: ${c.general?.product?.name || '—'}\n· ingredientes: ${n}\n· presentaciones: ${(c.general?.presentations || []).length}\n· paso tocado: ${c.touchedStep || '—'}`);
    ultimoResultado = { ...(ultimoResultado || {}), apollo: c };
  } catch (e) { alert('Error: ' + e.message); }
});

$('#btn-log').addEventListener('click', async () => {
  if (!dirHandle || !ultimoResultado) return;
  try {
    let base = dirHandle; try { base = await dirHandle.getDirectoryHandle('_invimagil', { create: true }); } catch {}
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const fh = await base.getFileHandle('log-inyeccion.md', { create: true });
    const prev = await (await fh.getFile()).text();
    const res = ultimoResultado.resultados || [];
    const line = `| ${stamp} | ${ultimoResultado.titulo} | ${res.filter((r) => r.estado === 'ok').length} ok · ${res.filter((r) => !['ok', 'vacio', 'simulado'].includes(r.estado)).length} con problema · ${res.filter((r) => r.estado === 'vacio').length} sin dato | ${res.filter((r) => !['ok', 'vacio', 'simulado'].includes(r.estado)).map((r) => `${r.campo}: ${r.detalle}`).join('; ').replace(/\|/g, '/') || '—'} |\n`;
    const w = await fh.createWritable();
    await w.write((prev || '# Log de inyección\n\n| Fecha | Pantalla | Resultado | Problemas |\n|---|---|---|---|\n') + line);
    await w.close();
    const vh = await base.getFileHandle(`verificacion-${norm(ultimoResultado.paso || 'paso')}.json`, { create: true });
    const vw = await vh.createWritable(); await vw.write(JSON.stringify(ultimoResultado, null, 1)); await vw.close();
    alert('Registro guardado en _invimagil.');
  } catch (e) { alert('No se pudo guardar el registro: ' + e.message); }
});
