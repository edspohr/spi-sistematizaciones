/*
 * InvimAgil Live Mapping Kit
 *
 * Single-file DevTools Snippet. Paste into Chrome DevTools -> Sources -> Snippets,
 * then Ctrl+Enter. Also usable as a bookmarklet fallback (see mapper.bookmarklet.txt),
 * but note that many enterprise sites block javascript: bookmarklets via CSP.
 *
 * Hard guarantees:
 *   - Zero network. No fetch, no XMLHttpRequest, no dynamic import, no remote assets.
 *   - Idempotent. Re-injection restores state from localStorage; never duplicates the panel.
 *   - Autosave after every capture. Nothing lives only in memory.
 *   - Shadow-DOM UI. Does not leak CSS to the host, does not intercept clicks outside itself
 *     (except while in capture mode).
 *   - Survives SPA soft navigations (MutationObserver on <title> + polling location.href).
 *
 * All user-facing text is Spanish (Colombia). Code and comments are English.
 */

(() => {
  'use strict';

  const SENTINEL = '__invimagilMapper__';
  if (window[SENTINEL]) {
    // Re-injection: restore panel from persisted state and return.
    try { window[SENTINEL].reactivate(); } catch (e) { console.error('[InvimAgil]', e); }
    return;
  }

  // ------------------------------------------------------------------
  // Inline seed schema (must match schema/fields.cosmeticos.json shape).
  // Kept inline so the snippet is a single pasteable file with no fetch.
  // ------------------------------------------------------------------
  const FIELDS = {
    version: '0.1.0-seed',
    secciones: [
      { id: 'identificacion', nombre_es: 'Identificación del producto' },
      { id: 'titular_responsables', nombre_es: 'Titular y responsables' },
      { id: 'formula', nombre_es: 'Fórmula cuali-cuantitativa' },
      { id: 'presentacion_envase', nombre_es: 'Presentación y envase' },
      { id: 'condiciones', nombre_es: 'Condiciones' }
    ],
    campos: [
      { key: 'nombre_producto', label_es: 'Nombre del producto', section: 'identificacion' },
      { key: 'marca', label_es: 'Marca', section: 'identificacion' },
      { key: 'presentaciones', label_es: 'Referencias / presentaciones', section: 'identificacion' },
      { key: 'forma_cosmetica', label_es: 'Forma cosmética', section: 'identificacion' },
      { key: 'categoria', label_es: 'Categoría', section: 'identificacion' },
      { key: 'uso_previsto', label_es: 'Uso previsto', section: 'identificacion' },
      { key: 'expediente', label_es: 'Número de expediente', section: 'identificacion' },
      { key: 'nso_vigente', label_es: 'Número de registro / NSO vigente', section: 'identificacion' },
      { key: 'fecha_vencimiento_registro', label_es: 'Fecha de vencimiento del registro', section: 'identificacion' },
      { key: 'titular_razon_social', label_es: 'Titular — razón social', section: 'titular_responsables' },
      { key: 'titular_id', label_es: 'Titular — NIT / identificación', section: 'titular_responsables' },
      { key: 'titular_pais', label_es: 'Titular — país', section: 'titular_responsables' },
      { key: 'titular_direccion', label_es: 'Titular — dirección', section: 'titular_responsables' },
      { key: 'fabricante_razon_social', label_es: 'Fabricante — razón social', section: 'titular_responsables' },
      { key: 'fabricante_pais', label_es: 'Fabricante — país', section: 'titular_responsables' },
      { key: 'fabricante_direccion', label_es: 'Fabricante — dirección', section: 'titular_responsables' },
      { key: 'fabricante_rol', label_es: 'Fabricante — rol', section: 'titular_responsables' },
      { key: 'importador_razon_social', label_es: 'Importador — razón social', section: 'titular_responsables' },
      { key: 'apoderado', label_es: 'Apoderado', section: 'titular_responsables' },
      { key: 'formula', label_es: 'Fórmula cuali-cuantitativa (tabla)', section: 'formula' },
      { key: 'envase_tipo', label_es: 'Tipo de envase', section: 'presentacion_envase' },
      { key: 'envase_material', label_es: 'Material del envase', section: 'presentacion_envase' },
      { key: 'contenido', label_es: 'Contenido / capacidad', section: 'presentacion_envase' },
      { key: 'unidades', label_es: 'Unidades', section: 'presentacion_envase' },
      { key: 'vida_util', label_es: 'Vida útil', section: 'condiciones' },
      { key: 'condiciones_almacenamiento', label_es: 'Condiciones de almacenamiento', section: 'condiciones' },
      { key: 'pais_origen', label_es: 'País de origen', section: 'condiciones' }
    ]
  };

  const STORAGE_KEY = 'invimagil.mapper.v1';
  const MAX_OUTER_HTML = 4000;
  const LARGE_TEXT_NODE = 40;         // for snapshot sanitization
  const SNAPSHOT_MAX = 2_000_000;     // bytes, per snapshot
  const EXPORT_REMINDER_EVERY = 10;
  // Odoo-generated ids (e.g. "o_field_1234", "o-owl-h-1a2b3c") look unstable.
  // Heuristic: reject ids that contain long digit runs or look like short hashes.
  const UNSTABLE_ID = /(^|[_-])(o[_-]?field|owl|o[_-]?h)[_-]?[a-z0-9]{2,}|\d{4,}/i;
  const STABLE_DATA_ATTRS = ['data-testid', 'data-test', 'data-field', 'data-name', 'data-qa', 'data-cy'];

  // ------------------------------------------------------------------
  // Persistent state
  // ------------------------------------------------------------------
  const defaultState = () => ({
    perfil: 'invimagil-cosmeticos',
    creado: new Date().toISOString(),
    plataforma_url: location.href,
    plataforma_title: document.title,
    sanitizarSnapshots: true,
    pantallaActual: null,
    pantallas: [],
    mapeos: {},          // key -> mapping entry
    camposAdHoc: [],     // extra fields captured in-session
    pruebasInyeccion: [],
    sondaCombobox: null,
    snapshots: [],       // {id, pantalla, sanitizado, ts, html}
    errores: [],
    ultimaExportacionCapturas: 0
  });

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // Merge with defaults so a new field added later doesn't crash old state.
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      console.error('[InvimAgil] load falló, empezando limpio:', e);
      return defaultState();
    }
  };

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      pushError('guardado', e);
    }
  };

  const state = load();

  // ------------------------------------------------------------------
  // Error surface
  // ------------------------------------------------------------------
  function pushError(where, err) {
    const entry = {
      ts: new Date().toISOString(),
      donde: where,
      mensaje: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 2000) : null
    };
    state.errores.push(entry);
    try { save(); } catch (_) { /* nothing else we can do */ }
    try { renderErrorBadge(); } catch (_) {}
    console.error('[InvimAgil][' + where + ']', err);
  }

  const scopedErrorHandler = (event) => {
    // Best-effort: only capture errors whose stack mentions our source.
    const s = event && event.error && event.error.stack ? String(event.error.stack) : '';
    if (s.includes('invimagilMapper') || s.includes(SENTINEL)) {
      pushError('window.onerror', event.error || event.message);
    }
  };
  const scopedRejectionHandler = (event) => {
    const reason = event && event.reason;
    const s = reason && reason.stack ? String(reason.stack) : '';
    if (s.includes('invimagilMapper') || s.includes(SENTINEL)) {
      pushError('unhandledrejection', reason);
    }
  };
  window.addEventListener('error', scopedErrorHandler);
  window.addEventListener('unhandledrejection', scopedRejectionHandler);

  // Wrap any panel action so failures render in the panel, not just the console.
  function guarded(where, fn) {
    return (...args) => {
      try { return fn(...args); } catch (e) { pushError(where, e); }
    };
  }

  // ------------------------------------------------------------------
  // Selector strategy stack
  // ------------------------------------------------------------------
  function isStableId(id) {
    if (!id) return false;
    if (UNSTABLE_ID.test(id)) return false;
    // Also reject purely numeric ids.
    if (/^\d+$/.test(id)) return false;
    return true;
  }

  function cssEscape(s) {
    // window.CSS.escape exists in modern Chrome; fall back to a simple escaper.
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/([\\!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
  }

  function labelTextFor(el) {
    if (!el) return null;
    if (el.labels && el.labels.length) {
      const t = Array.from(el.labels).map(l => (l.textContent || '').trim()).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.id) {
      const lbl = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (lbl) return (lbl.textContent || '').trim() || null;
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) return (wrap.textContent || '').trim() || null;
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const ariaby = el.getAttribute && el.getAttribute('aria-labelledby');
    if (ariaby) {
      const ref = document.getElementById(ariaby);
      if (ref) return (ref.textContent || '').trim() || null;
    }
    if (el.placeholder) return el.placeholder;
    // Nearest preceding text node in the same block ancestor
    let node = el.previousSibling;
    while (node) {
      if (node.nodeType === 3 && node.textContent.trim()) return node.textContent.trim();
      if (node.nodeType === 1) {
        const t = (node.textContent || '').trim();
        if (t && t.length < 120) return t;
      }
      node = node.previousSibling;
    }
    return null;
  }

  function scopedCssPath(el) {
    // Walk up to an ancestor with a stable id or stable data-* attr, then build a path.
    const parts = [];
    let cur = el;
    let stop = null;
    for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
      if (cur.id && isStableId(cur.id)) { stop = cur; break; }
      const stableDA = STABLE_DATA_ATTRS.find(a => cur.hasAttribute && cur.hasAttribute(a));
      if (stableDA) { stop = cur; break; }
      cur = cur.parentElement;
    }
    const root = stop || document.body;
    let node = el;
    while (node && node !== root && node !== document.body) {
      let seg = node.tagName ? node.tagName.toLowerCase() : '';
      if (!seg) break;
      if (node.classList && node.classList.length) {
        const cls = Array.from(node.classList).filter(c => !/^(o_|owl_|is-|has-)/i.test(c)).slice(0, 2);
        if (cls.length) seg += '.' + cls.map(cssEscape).join('.');
      }
      // nth-of-type for disambiguation
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (sameTag.length > 1) seg += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(seg);
      node = parent;
    }
    let prefix = '';
    if (stop && stop.id && isStableId(stop.id)) prefix = '#' + cssEscape(stop.id) + ' ';
    else if (stop) {
      const da = STABLE_DATA_ATTRS.find(a => stop.hasAttribute(a));
      if (da) prefix = '[' + da + '="' + cssEscape(stop.getAttribute(da)) + '"] ';
    }
    return prefix + parts.join(' > ');
  }

  function absoluteXPath(el) {
    if (!el) return null;
    if (el === document.body) return '/html/body';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const parent = node.parentElement;
      let idx = 1;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        idx = siblings.indexOf(node) + 1;
      }
      parts.unshift(node.tagName.toLowerCase() + '[' + idx + ']');
      node = parent;
    }
    return '/' + parts.join('/');
  }

  function resolveSelector(sel) {
    if (!sel) return null;
    try {
      if (sel.tipo === 'xpath') {
        const r = document.evaluate(sel.valor, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return r.singleNodeValue;
      }
      return document.querySelector(sel.valor);
    } catch (e) {
      return null;
    }
  }

  function buildSelectorStack(el) {
    const out = [];
    // 1. Stable id
    if (el.id && isStableId(el.id)) {
      const s = { tipo: 'id', valor: '#' + cssEscape(el.id) };
      if (resolveSelector(s) === el) out.push(s);
    }
    // 2. [name]
    const nm = el.getAttribute && el.getAttribute('name');
    if (nm) {
      const s = { tipo: 'name', valor: el.tagName.toLowerCase() + '[name="' + cssEscape(nm) + '"]' };
      if (resolveSelector(s) === el) out.push(s);
    }
    // 3. aria-label / associated label
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) {
      const s = { tipo: 'aria-label', valor: '[aria-label="' + cssEscape(aria) + '"]' };
      if (resolveSelector(s) === el) out.push(s);
    } else if (el.id) {
      const forLabel = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (forLabel) {
        // We can't select by label text directly in CSS; keep the id-based selector we already have.
      }
    }
    // 4. Whitelisted data-*
    for (const attr of STABLE_DATA_ATTRS) {
      if (el.hasAttribute && el.hasAttribute(attr)) {
        const v = el.getAttribute(attr);
        const s = { tipo: attr, valor: '[' + attr + '="' + cssEscape(v) + '"]' };
        if (resolveSelector(s) === el) out.push(s);
      }
    }
    // 5. Scoped CSS path
    try {
      const path = scopedCssPath(el);
      const s = { tipo: 'css-scoped', valor: path };
      if (resolveSelector(s) === el) out.push(s);
    } catch (_) {}
    // 6. Absolute XPath (last resort)
    try {
      const xp = absoluteXPath(el);
      out.push({ tipo: 'xpath', valor: xp });
    } catch (_) {}
    return out;
  }

  function detectControlType(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select_nativo';
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'date' || type === 'datetime-local' || type === 'month') return 'fecha';
      // Odoo/OWL combobox heuristic
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      const hasList = el.hasAttribute('list') || el.getAttribute('aria-autocomplete');
      const adjacentDropdown = el.parentElement && el.parentElement.querySelector(
        '[role="listbox"], .dropdown, .o_input_dropdown, ul[role="menu"]'
      );
      if (role === 'combobox' || hasList || adjacentDropdown) return 'combobox_owl';
      return 'text';
    }
    if (el.isContentEditable) return 'text';
    return 'desconocido';
  }

  function summarizeAncestors(el) {
    const out = [];
    let node = el.parentElement;
    for (let i = 0; i < 5 && node && node !== document.body; i++) {
      const attrs = {};
      if (node.attributes) {
        for (const a of node.attributes) attrs[a.name] = a.value;
      }
      out.push({
        tag: node.tagName.toLowerCase(),
        attrs: attrs
      });
      node = node.parentElement;
    }
    return out;
  }

  function nearestWrapperHtml(el) {
    let node = el.parentElement;
    for (let i = 0; i < 5 && node && node !== document.body; i++) {
      const cls = (node.className && typeof node.className === 'string') ? node.className : '';
      if (
        cls.includes('field') || cls.includes('form-group') || cls.includes('o_field') ||
        (node.getAttribute && node.getAttribute('role') === 'group')
      ) {
        const html = node.outerHTML || '';
        return html.length > MAX_OUTER_HTML ? html.slice(0, MAX_OUTER_HTML) + '...[truncado]' : html;
      }
      node = node.parentElement;
    }
    return null;
  }

  function elementFingerprint(el) {
    const attrs = {};
    if (el.attributes) for (const a of el.attributes) attrs[a.name] = a.value;
    const html = el.outerHTML || '';
    return {
      selectors: buildSelectorStack(el),
      outerHTML: html.length > MAX_OUTER_HTML ? html.slice(0, MAX_OUTER_HTML) + '...[truncado]' : html,
      ancestros: summarizeAncestors(el),
      wrapperHtml: nearestWrapperHtml(el),
      atributos: attrs,
      etiquetaVisible: labelTextFor(el),
      tipoControl: detectControlType(el),
      rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
      indiceEnFormulario: Array.from(document.querySelectorAll('input,select,textarea,[contenteditable="true"]')).indexOf(el),
      pantalla: state.pantallaActual
    };
  }

  // ------------------------------------------------------------------
  // Screen tracking (SPA soft-nav survival)
  // ------------------------------------------------------------------
  let lastUrl = location.href;
  let lastTitle = document.title;

  function noteScreen(nombre, opts) {
    const entry = {
      id: 'p' + Date.now(),
      nombre: nombre || document.title || location.pathname,
      url: location.href,
      title: document.title,
      ts: new Date().toISOString(),
      auto: !!(opts && opts.auto)
    };
    state.pantallas.push(entry);
    state.pantallaActual = entry.nombre;
    save();
    ui.renderStatus();
  }

  function watchNavigation() {
    // Observe title changes
    const mo = new MutationObserver(() => {
      if (document.title !== lastTitle) {
        lastTitle = document.title;
        noteScreen('(auto) ' + document.title, { auto: true });
      }
    });
    const titleEl = document.querySelector('head > title');
    if (titleEl) mo.observe(titleEl, { childList: true, subtree: true, characterData: true });
    // Poll location
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        noteScreen('(auto) ' + location.pathname, { auto: true });
      }
    }, 800);
  }

  // ------------------------------------------------------------------
  // Capture mode
  // ------------------------------------------------------------------
  let capture = null;  // { onDone: fn, hoverEl: Element }

  function setOutline(el, on) {
    if (!el) return;
    if (on) {
      el.__invOldOutline = el.style.outline;
      el.__invOldOffset = el.style.outlineOffset;
      el.style.outline = '2px solid #ff6b00';
      el.style.outlineOffset = '2px';
    } else {
      el.style.outline = el.__invOldOutline || '';
      el.style.outlineOffset = el.__invOldOffset || '';
      delete el.__invOldOutline;
      delete el.__invOldOffset;
    }
  }

  function startCapture(onDone) {
    if (capture) exitCapture();
    capture = { onDone };
    ui.setCaptureBanner(true);
    document.addEventListener('mousemove', onCaptureMove, true);
    document.addEventListener('click', onCaptureClick, true);
    document.addEventListener('keydown', onCaptureKey, true);
  }

  function exitCapture() {
    if (!capture) return;
    if (capture.hoverEl) setOutline(capture.hoverEl, false);
    document.removeEventListener('mousemove', onCaptureMove, true);
    document.removeEventListener('click', onCaptureClick, true);
    document.removeEventListener('keydown', onCaptureKey, true);
    capture = null;
    ui.setCaptureBanner(false);
  }

  function isInsideUi(el) {
    return !!(ui.host && (el === ui.host || ui.host.contains(el)));
  }

  function onCaptureMove(e) {
    if (!capture) return;
    const el = e.target;
    if (isInsideUi(el)) return;
    if (capture.hoverEl && capture.hoverEl !== el) setOutline(capture.hoverEl, false);
    setOutline(el, true);
    capture.hoverEl = el;
  }

  function onCaptureClick(e) {
    if (!capture) return;
    const el = e.target;
    if (isInsideUi(el)) return;
    e.preventDefault();
    e.stopPropagation();
    const cb = capture.onDone;
    exitCapture();
    try { cb(el); } catch (err) { pushError('captura', err); }
  }

  function onCaptureKey(e) {
    if (!capture) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exitCapture();
    }
  }

  // ------------------------------------------------------------------
  // Mapping actions
  // ------------------------------------------------------------------
  function mapField(key) {
    startCapture((el) => {
      const fp = elementFingerprint(el);
      state.mapeos[key] = Object.assign({ key, ts: new Date().toISOString() }, fp);
      save();
      console.log('[InvimAgil] mapeado', key, fp.selectors[0]);
      ui.render();
      maybeExportReminder();
    });
  }

  function addAdHocField() {
    startCapture((el) => {
      const nombre = prompt('Nombre del campo (ej. numero_lote):');
      if (!nombre) return;
      const seccion = prompt(
        'Sección: ' + FIELDS.secciones.map(s => s.id).join(' | ') + '\n(o escriba una nueva)',
        state.pantallaActual ? '' : ''
      );
      const fp = elementFingerprint(el);
      const entry = Object.assign({
        key: nombre,
        section: seccion || 'sin_seccion',
        origen: 'sesion',
        ts: new Date().toISOString()
      }, fp);
      state.camposAdHoc.push(entry);
      save();
      ui.render();
      maybeExportReminder();
    });
  }

  // ------------------------------------------------------------------
  // Injection test
  // ------------------------------------------------------------------
  function detectSearchInput() {
    // Look for a search/filter input on the page
    const candidates = document.querySelectorAll('input[type="search"], input[placeholder*="Buscar" i], input[placeholder*="Filtrar" i], input[aria-label*="Buscar" i]');
    return candidates.length ? candidates[0] : null;
  }

  async function runInjectionTest() {
    const consent = confirm(
      'ADVERTENCIA\n\n' +
      'La prueba de inyección escribe un valor en un campo y luego lo restaura.\n' +
      'InvimÁgil autoguarda al modificar campos, así que esta prueba debe ejecutarse ' +
      'ÚNICAMENTE sobre un borrador nuevo o sobre un campo de búsqueda/filtro.\n\n' +
      '¿Continuar?'
    );
    if (!consent) return;

    const suggested = detectSearchInput();
    if (suggested) {
      const useIt = confirm('Se detectó un campo de búsqueda en la página. ¿Usarlo como objetivo de la prueba?');
      if (useIt) {
        return performInjectionTest(suggested);
      }
    }

    alert('Haga clic en el campo de texto que se usará como objetivo de la prueba (idealmente en un borrador nuevo).');
    startCapture(async (el) => {
      await performInjectionTest(el);
    });
  }

  function nativeSetValue(el, value) {
    const tag = el.tagName;
    const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  }

  function dispatchAll(el, extra) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (extra && extra.includes('keys')) {
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function performInjectionTest(el) {
    const original = 'value' in el ? el.value : (el.textContent || '');
    const testValue = '__inv_prueba_' + Math.floor(Math.random() * 1e6);
    const attempts = [
      { nombre: 'input+change+blur', extra: [] },
      { nombre: 'input+change+blur+keys', extra: ['keys'] }
    ];
    let workingAttempt = null;
    let stuck = null;
    for (const attempt of attempts) {
      try {
        nativeSetValue(el, testValue);
        dispatchAll(el, attempt.extra);
      } catch (e) {
        pushError('inyeccion.write', e);
        continue;
      }
      // Give the framework a beat
      await new Promise(r => setTimeout(r, 250));
      // Focus another field to trigger any deferred commit
      const sinks = document.querySelectorAll('input,textarea');
      const otherSink = Array.from(sinks).find(s => s !== el);
      if (otherSink) { try { otherSink.focus(); otherSink.blur(); } catch (_) {} }
      await new Promise(r => setTimeout(r, 200));
      const nowValue = 'value' in el ? el.value : (el.textContent || '');
      if (nowValue === testValue) {
        workingAttempt = attempt.nombre;
        stuck = true;
        break;
      }
      stuck = false;
    }

    // Restore original value
    let restoreOk = false;
    let restoreErr = null;
    try {
      nativeSetValue(el, original);
      dispatchAll(el, []);
      await new Promise(r => setTimeout(r, 200));
      const back = 'value' in el ? el.value : (el.textContent || '');
      restoreOk = (back === original);
    } catch (e) {
      restoreErr = e && e.message ? e.message : String(e);
    }

    const record = {
      ts: new Date().toISOString(),
      pantalla: state.pantallaActual,
      objetivo: elementFingerprint(el),
      valorOriginal: original,
      valorPrueba: testValue,
      combinacionQueFunciono: workingAttempt,
      valorSeMantuvo: !!stuck,
      restauracionExitosa: restoreOk,
      restauracionError: restoreErr
    };
    state.pruebasInyeccion.push(record);
    save();
    ui.render();

    let msg;
    if (stuck) {
      msg = 'El valor se mantuvo. Combinación efectiva: ' + workingAttempt + '.';
    } else {
      msg = 'El valor fue revertido por la plataforma. La estrategia actual no basta; se necesitará Playwright o un enfoque distinto.';
    }
    if (!restoreOk) {
      msg += '\n\n[ATENCIÓN] No se pudo confirmar la restauración del valor original ("' +
             String(original).slice(0, 60) + '"). Revise el campo manualmente antes de continuar.';
    } else {
      msg += '\nValor original restaurado.';
    }
    alert(msg);
  }

  // ------------------------------------------------------------------
  // Combobox probe
  // ------------------------------------------------------------------
  let probe = null;

  function startComboboxProbe() {
    if (probe) return;
    alert('Modo sonda del combobox: haga clic en el campo de búsqueda de ingredientes y escriba un INCI.\n\nCuando termine, use el botón "Detener sonda".');
    startCapture((el) => {
      probe = {
        objetivo: elementFingerprint(el),
        eventos: [],
        mutaciones: [],
        pantalla: state.pantallaActual,
        inicio: performance.now(),
        primeraOpcionEn: null,
        selectorLista: null,
        selectorOpciones: null
      };
      const now = () => Math.round(performance.now() - probe.inicio);
      const evtNames = ['input', 'change', 'keydown', 'keyup', 'focus', 'blur', 'click'];
      probe._onEvt = (e) => {
        probe.eventos.push({
          t: now(),
          tipo: e.type,
          key: e.key || null,
          value: e.target && 'value' in e.target ? String(e.target.value).slice(0, 200) : null
        });
        // Detect selection: an option click near the input
        if (e.type === 'click' && !isInsideUi(e.target)) {
          const opt = e.target.closest('[role="option"], li, .dropdown-item, .o_result');
          if (opt) probe.selectorOpciones = opt.tagName.toLowerCase() + (opt.getAttribute('role') ? '[role="' + opt.getAttribute('role') + '"]' : '');
        }
      };
      for (const n of evtNames) el.addEventListener(n, probe._onEvt, true);

      probe._mo = new MutationObserver((records) => {
        for (const r of records) {
          if (r.addedNodes && r.addedNodes.length) {
            for (const node of r.addedNodes) {
              if (node.nodeType === 1) {
                const info = {
                  t: now(),
                  tag: node.tagName.toLowerCase(),
                  cls: (node.className && typeof node.className === 'string') ? node.className.slice(0, 200) : '',
                  role: node.getAttribute && node.getAttribute('role'),
                  childCount: node.children ? node.children.length : 0
                };
                probe.mutaciones.push(info);
                if (!probe.primeraOpcionEn && (info.role === 'listbox' || /dropdown|autocomplete|o_input_dropdown/i.test(info.cls))) {
                  probe.primeraOpcionEn = info.t;
                  probe.selectorLista = info.tag + (info.role ? '[role="' + info.role + '"]' : '');
                }
              }
            }
          }
        }
      });
      probe._mo.observe(document.body, { childList: true, subtree: true });
      probe._input = el;
      ui.render();
      console.log('[InvimAgil] sonda activa sobre', el);
    });
  }

  function stopComboboxProbe() {
    if (!probe) return;
    try {
      const evtNames = ['input', 'change', 'keydown', 'keyup', 'focus', 'blur', 'click'];
      for (const n of evtNames) probe._input.removeEventListener(n, probe._onEvt, true);
      probe._mo.disconnect();
    } catch (_) {}
    const snapshot = {
      objetivo: probe.objetivo,
      pantalla: probe.pantalla,
      totalEventos: probe.eventos.length,
      eventos: probe.eventos.slice(0, 400),
      totalMutaciones: probe.mutaciones.length,
      mutaciones: probe.mutaciones.slice(0, 200),
      primeraOpcionEn_ms: probe.primeraOpcionEn,
      selectorLista: probe.selectorLista,
      selectorOpciones: probe.selectorOpciones
    };
    state.sondaCombobox = snapshot;
    save();
    probe = null;
    ui.render();
    alert('Sonda detenida. Datos guardados y exportables.');
  }

  // ------------------------------------------------------------------
  // Snapshots
  // ------------------------------------------------------------------
  function sanitizeHtml(html) {
    // Best-effort: parse into a document fragment, blank form values, shorten long text nodes.
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('input,textarea,select').forEach(el => {
        if (el.tagName === 'SELECT') {
          Array.from(el.options).forEach(o => o.removeAttribute('selected'));
        } else {
          el.setAttribute('value', '');
          if (el.tagName === 'TEXTAREA') el.textContent = '';
        }
      });
      const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT, null);
      const toReplace = [];
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.textContent && n.textContent.length > LARGE_TEXT_NODE) toReplace.push(n);
      }
      toReplace.forEach(n => { n.textContent = '[texto omitido]'; });
      return '<!doctype html>' + doc.documentElement.outerHTML;
    } catch (e) {
      pushError('sanitize', e);
      return '<!-- sanitize failed -->';
    }
  }

  function takeSnapshot() {
    const raw = document.documentElement.outerHTML;
    const sanitize = state.sanitizarSnapshots;
    let html = sanitize ? sanitizeHtml(raw) : raw;
    if (html.length > SNAPSHOT_MAX) html = html.slice(0, SNAPSHOT_MAX) + '\n<!-- truncado -->';
    const entry = {
      id: 's' + Date.now(),
      pantalla: state.pantallaActual,
      url: location.href,
      sanitizado: sanitize,
      ts: new Date().toISOString(),
      html
    };
    state.snapshots.push(entry);
    save();
    ui.render();
    console.log('[InvimAgil] snapshot guardado, sanitizado=' + sanitize + ', bytes=' + html.length);
  }

  // ------------------------------------------------------------------
  // Export / hygiene
  // ------------------------------------------------------------------
  function nowStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function buildExportPayload() {
    return {
      perfil: state.perfil,
      creado: state.creado,
      exportado: new Date().toISOString(),
      plataforma: {
        url: state.plataforma_url,
        title: state.plataforma_title,
        urlActual: location.href
      },
      schemaSeed: FIELDS,
      sanitizarSnapshots: state.sanitizarSnapshots,
      pantallas: state.pantallas,
      mapeos: state.mapeos,
      camposAdHoc: state.camposAdHoc,
      pruebasInyeccion: state.pruebasInyeccion,
      sondaCombobox: state.sondaCombobox,
      snapshots: state.snapshots,
      errores: state.errores
    };
  }

  function download(filename, text) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
      return true;
    } catch (e) {
      pushError('descarga', e);
      return false;
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { pushError('portapapeles', e); }
    // Fallback via textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      pushError('portapapeles.fallback', e);
      return false;
    }
  }

  function exportJson(useClipboard) {
    const payload = buildExportPayload();
    const text = JSON.stringify(payload, null, 2);
    const filename = 'mapeo-invimagil-' + nowStamp() + '.json';
    const unsanit = state.snapshots.some(s => !s.sanitizado);
    const warn = 'El archivo contiene la estructura de la plataforma' +
                 (unsanit ? ' Y snapshots SIN sanitizar (posibles datos de cliente)' : '') +
                 '. No lo comparta fuera del canal acordado.';
    alert(warn);
    if (useClipboard) {
      copyToClipboard(text).then(ok => {
        alert(ok ? 'JSON copiado al portapapeles.' : 'No se pudo copiar al portapapeles.');
      });
    } else {
      const ok = download(filename, text);
      if (!ok) {
        if (confirm('La descarga falló (¿bloqueada por política?). ¿Copiar al portapapeles en su lugar?')) {
          copyToClipboard(text).then(ok2 => alert(ok2 ? 'JSON copiado al portapapeles.' : 'También falló el portapapeles.'));
        }
      }
    }
    state.ultimaExportacionCapturas = countCaptures();
    save();
  }

  function countCaptures() {
    return Object.keys(state.mapeos).length + state.camposAdHoc.length + state.snapshots.length;
  }

  function maybeExportReminder() {
    const n = countCaptures();
    if (n > 0 && n - (state.ultimaExportacionCapturas || 0) >= EXPORT_REMINDER_EVERY) {
      ui.setReminder(true);
    }
  }

  function eraseAll() {
    if (!confirm('¿Borrar TODO el trabajo del mapper (mapeos, snapshots, pruebas, errores)?\nEsta acción no se puede deshacer.')) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { pushError('borrarTodo', e); }
    Object.assign(state, defaultState());
    save();
    ui.render();
    alert('Estado borrado.');
  }

  function eraseSnapshots() {
    if (!confirm('¿Borrar solo los snapshots (HTML de pantalla)? El mapeo y las pruebas se conservan.')) return;
    state.snapshots = [];
    save();
    ui.render();
  }

  // ------------------------------------------------------------------
  // UI (Shadow DOM)
  // ------------------------------------------------------------------
  const ui = (() => {
    const host = document.createElement('div');
    host.id = '__invimagil_mapper_host__';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    root.innerHTML = `
      <style>
        :host, .panel, .banner { all: initial; }
        .panel {
          position: fixed;
          right: 16px;
          bottom: 16px;
          width: 380px;
          max-height: 78vh;
          background: #ffffff;
          color: #1a1a1a;
          font: 12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          border: 1px solid #cccccc;
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
          pointer-events: auto;
          display: flex;
          flex-direction: column;
        }
        .panel.collapsed .body, .panel.collapsed .footer { display: none; }
        .head {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 8px; background: #003366; color: #fff;
          border-top-left-radius: 6px; border-top-right-radius: 6px;
          cursor: move; user-select: none;
        }
        .head strong { flex: 1; font-size: 12px; }
        .head button { all: initial; color: #fff; cursor: pointer; padding: 2px 6px; font-size: 12px; }
        .body { padding: 8px; overflow: auto; }
        .footer { padding: 6px 8px; border-top: 1px solid #eee; display: flex; gap: 4px; flex-wrap: wrap; }
        button.act {
          all: initial; display: inline-block;
          background: #f2f2f2; color: #1a1a1a;
          padding: 4px 8px; border: 1px solid #ccc; border-radius: 3px;
          cursor: pointer; font: 12px/1 system-ui; margin: 2px 2px 2px 0;
        }
        button.act:hover { background: #e6e6e6; }
        button.act.danger { background: #fdecec; border-color: #e0a0a0; color: #7a1414; }
        button.act.primary { background: #003366; color: #fff; border-color: #003366; }
        .status { font-size: 11px; color: #555; margin-bottom: 6px; }
        .status b { color: #1a1a1a; }
        .status .warn { color: #a35800; }
        .sec { margin-bottom: 8px; }
        .sec > .h { font-weight: bold; margin: 4px 0 3px 0; color: #003366; }
        .row { display: flex; align-items: center; gap: 4px; padding: 2px 0; border-bottom: 1px dotted #eee; }
        .row .lbl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row .st { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
        .row .st.ok { background: #d3f0d3; color: #204a20; }
        .row .st.no { background: #f0e0d0; color: #7a4400; }
        .banner {
          position: fixed; top: 0; left: 0; right: 0;
          background: #ff6b00; color: #fff;
          padding: 6px; font: bold 12px system-ui;
          text-align: center; z-index: 2147483647; pointer-events: none;
          display: none;
        }
        .banner.on { display: block; }
        .reminder { color: #a35800; font-size: 11px; margin-top: 4px; }
        .errbtn { color: #a30000; }
        .empty { color: #888; font-style: italic; }
        details { margin: 4px 0; }
        summary { cursor: pointer; font-weight: bold; color: #003366; }
        .kv { display: grid; grid-template-columns: auto 1fr; column-gap: 6px; row-gap: 2px; font-size: 11px; margin-top: 4px; }
        .kv b { color: #333; }
      </style>
      <div class="banner" id="banner">Modo captura activo — clic en un elemento (Esc para cancelar)</div>
      <div class="panel" id="panel">
        <div class="head" id="head">
          <strong>InvimÁgil — Mapeo</strong>
          <button id="min" title="Minimizar">▁</button>
          <button id="close" title="Ocultar">✕</button>
        </div>
        <div class="body" id="body"></div>
        <div class="footer" id="footer"></div>
      </div>
    `;

    const panel = root.getElementById('panel');
    const body = root.getElementById('body');
    const footer = root.getElementById('footer');
    const banner = root.getElementById('banner');
    const head = root.getElementById('head');

    // Drag
    (function () {
      let dragging = null;
      head.addEventListener('mousedown', (e) => {
        const r = panel.getBoundingClientRect();
        dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = Math.max(0, e.clientX - dragging.dx) + 'px';
        panel.style.top = Math.max(0, e.clientY - dragging.dy) + 'px';
      });
      document.addEventListener('mouseup', () => { dragging = null; });
    })();

    root.getElementById('min').addEventListener('click', () => panel.classList.toggle('collapsed'));
    root.getElementById('close').addEventListener('click', () => { host.style.display = host.style.display === 'none' ? '' : 'none'; });

    let reminderOn = false;

    function setCaptureBanner(on) {
      banner.classList.toggle('on', !!on);
    }
    function setReminder(on) {
      reminderOn = on;
      render();
    }
    function renderStatus() {
      // status is part of render() body, redraw
      render();
    }
    function renderErrorBadge() { render(); }

    function h(tag, opts, ...children) {
      const el = root.ownerDocument.createElement(tag);
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'onclick') el.addEventListener('click', v);
          else if (k === 'class') el.className = v;
          else if (k === 'title') el.title = v;
          else if (k === 'style') el.style.cssText = v;
          else el.setAttribute(k, v);
        }
      }
      for (const c of children) {
        if (c === null || c === undefined) continue;
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
      return el;
    }

    function render() {
      body.innerHTML = '';
      footer.innerHTML = '';

      // Status block
      const status = h('div', { class: 'status' });
      status.append(
        h('div', null, h('b', null, 'Pantalla actual: '), state.pantallaActual || '(sin marcar)'),
        h('div', null, h('b', null, 'Sanitizado: '), state.sanitizarSnapshots ? 'sí' : h('span', { class: 'warn' }, 'no'),
          '  •  ',
          h('b', null, 'Snapshots: '), String(state.snapshots.length),
          '  •  ',
          h('b', null, 'Pantallas: '), String(state.pantallas.length)),
        h('div', null, h('b', null, 'Errores: '),
          state.errores.length
            ? h('button', { class: 'act errbtn', onclick: guarded('verErrores', showErrors) }, 'Ver errores (' + state.errores.length + ')')
            : '0')
      );
      if (reminderOn) status.append(h('div', { class: 'reminder' }, 'Sugerencia: exporte el JSON para no perder trabajo.'));
      body.append(status);

      // Screens
      const screensSec = h('details', { open: '' });
      screensSec.append(h('summary', null, 'Pantalla y flujo'));
      const scrRow = h('div', null,
        h('button', { class: 'act', onclick: guarded('marcarPantalla', () => {
          const suggested = document.title || location.pathname;
          const name = prompt('Nombre de la pantalla:', suggested);
          if (name) noteScreen(name, {});
        }) }, 'Marcar pantalla'),
        h('button', { class: 'act', onclick: guarded('snapshot', takeSnapshot) }, 'Guardar snapshot'),
        h('button', { class: 'act', onclick: guarded('toggleSanit', () => {
          state.sanitizarSnapshots = !state.sanitizarSnapshots;
          if (!state.sanitizarSnapshots) {
            if (!confirm('¿Desactivar sanitización? Los snapshots incluirán valores y textos completos.')) {
              state.sanitizarSnapshots = true;
            }
          }
          save(); render();
        }) }, state.sanitizarSnapshots ? 'Desactivar sanitización' : 'Activar sanitización')
      );
      screensSec.append(scrRow);
      body.append(screensSec);

      // Injection test
      const injSec = h('details', { open: '' });
      injSec.append(h('summary', null, 'Prueba de inyección'));
      injSec.append(h('div', null,
        h('button', { class: 'act primary', onclick: guarded('inyeccion', runInjectionTest) }, 'Probar inyección'),
        ' ', String(state.pruebasInyeccion.length), ' pruebas registradas.'
      ));
      body.append(injSec);

      // Combobox probe
      const probeSec = h('details', { open: '' });
      probeSec.append(h('summary', null, 'Sonda del combobox de ingredientes'));
      probeSec.append(h('div', null,
        probe
          ? h('button', { class: 'act danger', onclick: guarded('detenerSonda', stopComboboxProbe) }, 'Detener sonda')
          : h('button', { class: 'act', onclick: guarded('iniciarSonda', startComboboxProbe) }, 'Sondear autocompletado'),
        ' ', state.sondaCombobox ? 'sonda guardada' : 'sin sonda'
      ));
      body.append(probeSec);

      // Fields by section
      const fieldsSec = h('details', { open: '' });
      fieldsSec.append(h('summary', null, 'Campos del esquema'));
      for (const sec of FIELDS.secciones) {
        const secDiv = h('div', { class: 'sec' });
        secDiv.append(h('div', { class: 'h' }, sec.nombre_es));
        const inSec = FIELDS.campos.filter(c => c.section === sec.id);
        for (const c of inSec) {
          const mapped = !!state.mapeos[c.key];
          const row = h('div', { class: 'row' },
            h('span', { class: 'lbl', title: c.key }, c.label_es),
            h('span', { class: 'st ' + (mapped ? 'ok' : 'no') }, mapped ? 'mapeado' : 'sin mapear'),
            h('button', { class: 'act', onclick: guarded('mapear', () => mapField(c.key)) }, mapped ? 'Remapear' : 'Mapear'),
            mapped
              ? h('button', { class: 'act', onclick: guarded('quitarMapeo', () => {
                  if (confirm('¿Quitar mapeo de ' + c.label_es + '?')) { delete state.mapeos[c.key]; save(); render(); }
                }) }, '✕')
              : null
          );
          secDiv.append(row);
        }
        fieldsSec.append(secDiv);
      }
      body.append(fieldsSec);

      // Ad-hoc fields
      const adHocSec = h('details', null);
      adHocSec.append(h('summary', null, 'Campos nuevos (' + state.camposAdHoc.length + ')'));
      if (state.camposAdHoc.length === 0) {
        adHocSec.append(h('div', { class: 'empty' }, 'Ninguno todavía.'));
      } else {
        for (let i = 0; i < state.camposAdHoc.length; i++) {
          const c = state.camposAdHoc[i];
          const row = h('div', { class: 'row' },
            h('span', { class: 'lbl' }, c.key + '  (' + (c.section || 'sin_seccion') + ')'),
            h('button', { class: 'act', onclick: guarded('quitarAdHoc', () => {
              if (confirm('¿Quitar campo ' + c.key + '?')) { state.camposAdHoc.splice(i, 1); save(); render(); }
            }) }, '✕')
          );
          adHocSec.append(row);
        }
      }
      adHocSec.append(h('div', null,
        h('button', { class: 'act', onclick: guarded('nuevoCampo', addAdHocField) }, '＋ Campo nuevo')
      ));
      body.append(adHocSec);

      // Footer actions
      footer.append(
        h('button', { class: 'act primary', onclick: guarded('exportar', () => { exportJson(false); reminderOn = false; render(); }) }, 'Descargar JSON'),
        h('button', { class: 'act', onclick: guarded('exportarCP', () => { exportJson(true); reminderOn = false; render(); }) }, 'Copiar al portapapeles'),
        h('button', { class: 'act danger', onclick: guarded('borrarSnapshots', eraseSnapshots) }, 'Borrar snapshots'),
        h('button', { class: 'act danger', onclick: guarded('borrarTodo', eraseAll) }, 'Borrar todo')
      );
    }

    function showErrors() {
      const lines = state.errores.slice(-20).map(e => '[' + e.ts + '] ' + e.donde + ': ' + e.mensaje).join('\n');
      const doClear = confirm('Últimos ' + Math.min(20, state.errores.length) + ' errores:\n\n' + lines + '\n\n¿Limpiar la lista?');
      if (doClear) { state.errores = []; save(); render(); }
    }

    return { host, root, render, setCaptureBanner, setReminder, renderStatus, renderErrorBadge };
  })();

  // ------------------------------------------------------------------
  // Public sentinel API (for re-injection)
  // ------------------------------------------------------------------
  window[SENTINEL] = {
    version: '0.1.0',
    reactivate() {
      // Show the panel again if hidden; refresh from storage.
      const fresh = load();
      Object.assign(state, fresh);
      ui.host.style.display = '';
      ui.render();
      console.log('[InvimAgil] reactivado');
    },
    dump() { return buildExportPayload(); },
    state
  };

  // Boot
  watchNavigation();
  ui.render();
  if (!state.pantallaActual) {
    // Auto-mark the initial screen so early captures have a pantalla value.
    noteScreen(document.title || location.pathname, { auto: true });
  }
  console.log('[InvimAgil] mapper cargado. window.' + SENTINEL + ' expuesto.');
})();
