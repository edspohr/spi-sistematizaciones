// Runs in the page's MAIN world at document_start. Read-only:
//  * exposes the current request.content from the Apollo cache, so the add-on can verify what
//    the platform actually stored;
//  * records the GraphQL operations the page itself sends (name, query text, variables and a
//    preview of the answer; never headers or cookies). The panel ships them with each screen
//    capture: they document the platform's own save calls. Never sends anything itself.
(() => {
  const TAG = 'invimagil-inyector:apollo';
  const OPS = [];
  const MAX = 150;
  const corta = (v, n) => { try { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; } catch { return null; } };
  function registrar(body, url, status, respuesta) {
    let lista;
    try { lista = typeof body === 'string' ? JSON.parse(body) : null; } catch { return; }
    if (!lista) return;
    for (const op of [].concat(lista)) {
      if (!op || typeof op.query !== 'string') continue;
      const tipo = /^\s*mutation\b/.test(op.query) ? 'mutation' : 'query';
      OPS.push({ fecha: new Date().toISOString(), ruta: location.pathname, url, status, tipo, operationName: op.operationName || null, query: corta(op.query, 6000), variables: corta(op.variables, 30000), respuesta: corta(respuesta, 3000) });
      if (OPS.length > MAX) OPS.splice(0, OPS.length - MAX);
    }
  }
  const esGraphql = (url) => /graphql/i.test(String(url || ''));
  if (window.fetch && !window.fetch.__inyector) {
    const original = window.fetch;
    const envuelto = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const p = original.apply(this, arguments);
      if (esGraphql(url) && init && typeof init.body === 'string') {
        p.then((r) => r.clone().text().then((t) => registrar(init.body, url, r.status, t)).catch(() => registrar(init.body, url, r.status, null))).catch(() => registrar(init.body, url, 0, null));
      }
      return p;
    };
    envuelto.__inyector = true;
    window.fetch = envuelto;
  }
  const xopen = XMLHttpRequest.prototype.open, xsend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__inyUrl = url; return xopen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    if (esGraphql(this.__inyUrl) && typeof body === 'string') this.addEventListener('loadend', () => registrar(body, this.__inyUrl, this.status, this.responseText));
    return xsend.apply(this, arguments);
  };
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
    if (ev.source !== window || !ev.data || ev.data.tag !== TAG) return;
    if (ev.data.kind === 'graphql') {
      window.postMessage({ tag: TAG, kind: 'result', nonce: ev.data.nonce, result: { ok: true, operaciones: OPS.slice() } }, '*');
      OPS.length = 0;
      return;
    }
    if (ev.data.kind !== 'read') return;
    const client = findClient();
    let result = { ok: false, reason: 'apollo-no-disponible' };
    if (client && client.cache) {
      const req = extractRequest(client.cache, ev.data.requestId);
      result = req ? { ok: true, request: denormalise(client.cache, req) } : { ok: false, reason: 'solicitud-no-en-cache' };
    }
    window.postMessage({ tag: TAG, kind: 'result', nonce: ev.data.nonce, result }, '*');
  });
})();
