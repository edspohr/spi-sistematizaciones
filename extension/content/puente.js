// Bridge on the SPI Sistematización web app. The page and the extension talk through
// window.postMessage (page side) and chrome.runtime (extension side):
//   extension -> page  {tag:'spi-ext', kind:'presente', version}
//   page -> extension  {tag:'spi-app', kind:'enviar', payload}     planilla for a trámite
//   extension -> page  {tag:'spi-ext', kind:'recibido', tramiteId}
//   extension -> page  {tag:'spi-ext', kind:'salida', items}        verifications / captures
//   page -> extension  {tag:'spi-app', kind:'ack', ids}             written to Firestore
(() => {
  const version = chrome.runtime.getManifest().version;
  const aPagina = (m) => window.postMessage({ tag: 'spi-ext', ...m }, window.location.origin);
  const anunciar = () => aPagina({ kind: 'presente', version });

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const d = ev.data;
    if (!d || d.tag !== 'spi-app') return;
    try {
      if (d.kind === 'hola') anunciar();
      if (d.kind === 'enviar') {
        const r = await chrome.runtime.sendMessage({ type: 'GUARDAR_TRAMITE', payload: d.payload });
        aPagina({ kind: 'recibido', tramiteId: d.payload.tramiteId, ok: !!r?.ok });
      }
      if (d.kind === 'ack') await chrome.runtime.sendMessage({ type: 'SALIDA_ACK', ids: d.ids });
    } catch (e) {
      aPagina({ kind: 'error', mensaje: String(e?.message || e) });
    }
  });

  async function entregar() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SALIDA_PENDIENTE' });
      if (r?.items?.length) aPagina({ kind: 'salida', items: r.items });
    } catch { /* extension reloaded: this script is orphaned until the page reloads */ }
  }
  anunciar();
  window.addEventListener('DOMContentLoaded', anunciar);
  setInterval(entregar, 5000);
  entregar();
})();
