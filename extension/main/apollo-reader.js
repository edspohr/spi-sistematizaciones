// Runs in the page's MAIN world. Read-only: exposes the current request.content from the
// Apollo cache so the add-on can verify what the platform actually stored. Never writes.
(() => {
  const TAG = 'invimagil-inyector:apollo';
  function findClient() {
    if (window.__APOLLO_CLIENT__) return window.__APOLLO_CLIENT__;
    // Fallback: React root -> apollo client via devtools hook is not guaranteed; return null.
    return null;
  }
  function extractRequest(cache, requestId) {
    try {
      const data = cache.extract ? cache.extract() : (cache.data && cache.data.data) || {};
      for (const [key, obj] of Object.entries(data)) {
        if (!obj || typeof obj !== 'object') continue;
        if (obj.content && String(obj.id) === String(requestId)) return obj;
        if (/Request/i.test(key) && obj.content && (!requestId || String(obj.id) === String(requestId))) return obj;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  // Apollo normalises nested objects into references {__ref}. Resolve them shallowly.
  function denormalise(cache, node, depth = 0) {
    if (depth > 12 || node === null || typeof node !== 'object') return node;
    const data = cache.extract ? cache.extract() : {};
    if (Array.isArray(node)) return node.map((n) => denormalise(cache, n, depth + 1));
    if (node.__ref) return denormalise(cache, data[node.__ref], depth + 1);
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '__typename') continue;
      out[k] = denormalise(cache, v, depth + 1);
    }
    return out;
  }
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.tag !== TAG || ev.data.kind !== 'read') return;
    const client = findClient();
    let result = { ok: false, reason: 'apollo-no-disponible' };
    if (client && client.cache) {
      const req = extractRequest(client.cache, ev.data.requestId);
      result = req ? { ok: true, request: denormalise(client.cache, req) } : { ok: false, reason: 'solicitud-no-en-cache' };
    }
    window.postMessage({ tag: TAG, kind: 'result', nonce: ev.data.nonce, result }, '*');
  });
})();
