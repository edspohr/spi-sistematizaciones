// Service worker: opens the side panel from the toolbar button and keeps the shared state.
//   chrome.storage.local.tramites   {[tramiteId]: payload sent by the web app}
//   chrome.storage.local.activo     tramiteId chosen in the panel
//   chrome.storage.local.salida     [{id, tipo, tramiteId, ...}] results waiting to reach the web app
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const MAX_TRAMITES = 30;

// Only these messages are answered here; the side panel answers PEDIR_DOCUMENTO and listens to
// PROGRESO, so the worker must not reply to them.
const PROPIOS = ['GUARDAR_TRAMITE', 'SALIDA_PENDIENTE', 'SALIDA_ACK'];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!PROPIOS.includes(msg.type)) return false;
  (async () => {
    if (msg.type === 'GUARDAR_TRAMITE') {
      const { tramites = {} } = await chrome.storage.local.get('tramites');
      tramites[msg.payload.tramiteId] = { ...msg.payload, recibido: new Date().toISOString() };
      // keep the most recent ones only
      const ids = Object.keys(tramites).sort((a, b) => (tramites[b].recibido || '').localeCompare(tramites[a].recibido || ''));
      for (const id of ids.slice(MAX_TRAMITES)) delete tramites[id];
      await chrome.storage.local.set({ tramites, activo: msg.payload.tramiteId });
      return sendResponse({ ok: true });
    }
    if (msg.type === 'SALIDA_PENDIENTE') {
      const { salida = [] } = await chrome.storage.local.get('salida');
      return sendResponse({ ok: true, items: salida });
    }
    if (msg.type === 'SALIDA_ACK') {
      const { salida = [] } = await chrome.storage.local.get('salida');
      const ids = new Set(msg.ids || []);
      await chrome.storage.local.set({ salida: salida.filter((x) => !ids.has(x.id)) });
      return sendResponse({ ok: true });
    }
  })();
  return true;
});
