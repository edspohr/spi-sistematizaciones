// Engine: deterministic, human-paced driving of Ant Design controls. Isolated world.
// Rules baked in: exact matches only, whitelist of clickable buttons, never navigate.
(() => {
  const E = {};
  const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
  const PACE = { min: 150, max: 400 };
  const pace = () => SLEEP(PACE.min + Math.random() * (PACE.max - PACE.min));

  E.norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  E.sleep = SLEEP;

  // --- forbidden / allowed buttons -------------------------------------------------------
  const FORBIDDEN = ['siguiente', 'anterior', 'guardar y enviar', 'finalizar', 'radicar', 'firmar', 'enviar', 'eliminar', 'borrar', 'pagar', 'confirmar', 'aceptar terminos', 'cancelar tramite', 'desistir'];
  const ALLOWED_MODAL_SAVE = ['guardar', 'agregar', 'aceptar', 'ok'];
  E.isForbiddenButton = (el) => {
    const t = E.norm(el.textContent || el.value || el.getAttribute('aria-label'));
    return FORBIDDEN.some((f) => t === f || t.startsWith(f + ' '));
  };
  function safeClick(el, why) {
    if (!el) throw new Error('control no encontrado' + (why ? ': ' + why : ''));
    if (el.matches('button, [role=button], a') && E.isForbiddenButton(el)) throw new Error('BLOQUEADO: botón prohibido «' + el.textContent.trim() + '»');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  }
  E.safeClick = safeClick;

  // --- locating controls -----------------------------------------------------------------
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  E.visible = visible;
  function scope(root) { return root || document; }
  // Find by id, then by label text (exact, accent-insensitive), then by aria-label.
  E.find = (spec, root) => {
    const r = scope(root);
    if (!spec) return null;
    if (spec.id) {
      const el = r.querySelector('#' + CSS.escape(spec.id)) || r.querySelector('[id="' + spec.id + '"]');
      if (el) return el;
    }
    if (spec.selector) {
      const el = r.querySelector(spec.selector);
      if (el) return el;
    }
    if (spec.label) {
      const want = E.norm(spec.label);
      for (const lab of r.querySelectorAll('label, .ant-form-item-label > label, .ant-form-item-label')) {
        if (E.norm(lab.textContent).replace(/[:*]+$/, '').trim() !== want.replace(/[:*]+$/, '').trim()) continue;
        const forId = lab.getAttribute('for');
        if (forId) { const t = r.querySelector('#' + CSS.escape(forId)); if (t) return t; }
        const item = lab.closest('.ant-form-item, .ant-row, .form-group') || lab.parentElement;
        const ctl = item && item.querySelector('input, textarea, .ant-select, .ant-switch, .ant-radio-group, .ant-picker, button[role=switch]');
        if (ctl) return ctl;
      }
      for (const el of r.querySelectorAll('[aria-label]')) if (E.norm(el.getAttribute('aria-label')) === want) return el;
    }
    return null;
  };

  // --- primitives --------------------------------------------------------------------------
  function nativeSet(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    // React tracks the last value; clearing the tracker forces the onChange to fire.
    if (el._valueTracker) el._valueTracker.setValue('');
  }
  E.setText = async (el, value) => {
    const target = el.matches('input, textarea') ? el : el.querySelector('input, textarea');
    if (!target) throw new Error('no es un campo de texto');
    target.focus();
    nativeSet(target, '');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await pace();
    nativeSet(target, String(value));
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    await pace();
    target.blur();
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    return { leido: target.value };
  };
  E.readText = (el) => { const t = el.matches('input, textarea') ? el : el.querySelector('input, textarea'); return t ? t.value : null; };

  E.setSwitch = async (el, on) => {
    const sw = el.matches('[role=switch], .ant-switch') ? el : el.querySelector('[role=switch], .ant-switch');
    if (!sw) throw new Error('no es un interruptor');
    const cur = sw.getAttribute('aria-checked') === 'true' || sw.classList.contains('ant-switch-checked');
    if (cur !== !!on) { safeClick(sw, 'switch'); await pace(); }
    const now = sw.getAttribute('aria-checked') === 'true' || sw.classList.contains('ant-switch-checked');
    return { leido: now };
  };
  E.readSwitch = (el) => { const sw = el.matches('[role=switch], .ant-switch') ? el : el.querySelector('[role=switch], .ant-switch'); return sw ? (sw.getAttribute('aria-checked') === 'true' || sw.classList.contains('ant-switch-checked')) : null; };

  // Sí/No radio groups (Inicio) and generic radios
  E.setRadio = async (el, optionText) => {
    const want = E.norm(optionText);
    const group = el.matches('.ant-radio-group, [role=radiogroup]') ? el : (el.closest('.ant-radio-group, [role=radiogroup]') || el);
    for (const lab of group.querySelectorAll('label, .ant-radio-wrapper, .ant-radio-button-wrapper')) {
      if (E.norm(lab.textContent) === want) { safeClick(lab, 'radio'); await pace(); return { leido: E.readRadio(group) }; }
    }
    throw new Error('opción «' + optionText + '» no existe en el grupo');
  };
  E.readRadio = (group) => {
    const c = group.querySelector('.ant-radio-wrapper-checked, .ant-radio-button-wrapper-checked, input[type=radio]:checked');
    return c ? E.norm(c.closest('label') ? c.closest('label').textContent : c.textContent) : null;
  };

  // Ant Design Select (single or multiple, local or remote search). Exact match or throw.
  async function openDropdown(sel) {
    const trigger = sel.querySelector('.ant-select-selector') || sel;
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await pace();
    const input = sel.querySelector('input.ant-select-selection-search-input, input[role=combobox], input');
    return input;
  }
  function dropdownFor(sel) {
    const input = sel.querySelector('input[aria-controls], input[aria-owns]');
    const listId = input && (input.getAttribute('aria-controls') || input.getAttribute('aria-owns'));
    const byId = listId && document.getElementById(listId);
    const list = byId ? byId.closest('.ant-select-dropdown') || byId : [...document.querySelectorAll('.ant-select-dropdown')].find((d) => visible(d) && !d.classList.contains('ant-select-dropdown-hidden'));
    return list;
  }
  async function waitOptions(sel, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const dd = dropdownFor(sel);
      if (dd) {
        if (dd.querySelector('.ant-spin, .ant-select-item-empty .ant-spin')) { await SLEEP(120); continue; }
        const opts = [...dd.querySelectorAll('.ant-select-item-option, [role=option]')].filter(visible);
        if (opts.length || dd.querySelector('.ant-select-item-empty, .ant-empty')) return opts;
      }
      await SLEEP(120);
    }
    return [];
  }
  E.optionsFor = async (sel, typed) => {
    const input = await openDropdown(sel);
    if (typed != null && input) {
      nativeSet(input, String(typed));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    }
    const opts = await waitOptions(sel, 8000);
    return opts.map((o) => ({ el: o, texto: (o.querySelector('.ant-select-item-option-content') || o).textContent.trim() }));
  };
  E.closeDropdown = async (sel) => {
    const input = sel.querySelector('input');
    if (input) input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await pace();
  };
  // candidates: ordered list of acceptable option texts (first = preferred). Returns chosen text.
  E.selectExact = async (sel, candidates, opts) => {
    const list = Array.isArray(candidates) ? candidates : [candidates];
    // One candidate: type it as a filter (remote searches need it). Several candidates (a
    // preference order): open without filtering and pick the first candidate the platform offers;
    // if the list is long/remote and nothing matched, retry typing each candidate in order.
    const attempts = list.length === 1 || (opts && opts.typed) ? [(opts && opts.typed) ?? list[0]] : ['', ...list];
    let offered = [];
    for (const typed of attempts) {
      const found = await E.optionsFor(sel, typed);
      offered = found.map((o) => o.texto);
      for (const cand of list) {
        const hit = found.find((o) => E.norm(o.texto) === E.norm(cand));
        if (hit) {
          safeClick(hit.el, 'opción');
          await pace();
          if (!(opts && opts.multiple)) await E.closeDropdown(sel);
          return { elegido: hit.texto, ofrecidos: offered };
        }
      }
      await E.closeDropdown(sel);
    }
    const err = new Error('sin coincidencia exacta para «' + list.join(' | ') + '»');
    err.ofrecidos = offered;
    throw err;
  };
  E.readSelect = (sel) => {
    const items = [...sel.querySelectorAll('.ant-select-selection-item')].map((i) => (i.getAttribute('title') || i.textContent).trim());
    return items.length <= 1 ? (items[0] ?? null) : items;
  };

  E.setDate = async (el, text) => {
    const input = el.matches('input') ? el : el.querySelector('input');
    input.focus();
    nativeSet(input, String(text));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await pace();
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
    await pace();
    return { leido: input.value };
  };

  // Files: assign a File to the hidden input; never click the drop zone.
  E.setFile = async (el, file) => {
    const input = el.matches('input[type=file]') ? el : el.querySelector('input[type=file]');
    if (!input) throw new Error('casilla de archivo sin input');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await pace();
    return { leido: file.name };
  };

  // Modals: open with an allowed "+ Agregar" button, fill, save with the modal's own save button.
  E.findButton = (texts, root) => {
    const wants = (Array.isArray(texts) ? texts : [texts]).map(E.norm);
    for (const b of scope(root).querySelectorAll('button, [role=button]')) {
      const t = E.norm(b.textContent).replace(/^[+\-\s]+/, '');
      if (visible(b) && wants.some((w) => t === w || t === '+ ' + w || t.endsWith(w))) return b;
    }
    return null;
  };
  E.openModal = async (buttonText) => {
    const b = E.findButton(buttonText);
    if (!b) throw new Error('botón «' + buttonText + '» no encontrado');
    safeClick(b, 'abrir modal');
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const m = [...document.querySelectorAll('.ant-modal:not(.ant-zoom-leave) .ant-modal-content, [role=dialog]')].find(visible);
      if (m) { await pace(); return m; }
      await SLEEP(100);
    }
    throw new Error('el modal no se abrió');
  };
  E.saveModal = async (modal) => {
    const footer = modal.querySelector('.ant-modal-footer') || modal;
    const b = [...footer.querySelectorAll('button')].find((x) => visible(x) && ALLOWED_MODAL_SAVE.includes(E.norm(x.textContent)) && !x.disabled);
    if (!b) throw new Error('el modal no tiene botón Guardar habilitado');
    safeClick(b, 'guardar modal');
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (!visible(modal) || !document.contains(modal)) { await pace(); return true; }
      const err = modal.querySelector('.ant-form-item-explain-error');
      if (err) throw new Error('validación del modal: ' + err.textContent.trim());
      await SLEEP(120);
    }
    throw new Error('el modal no se cerró al guardar');
  };
  E.cancelModal = async (modal) => {
    const b = [...modal.querySelectorAll('button')].find((x) => E.norm(x.textContent) === 'cancelar') || modal.querySelector('.ant-modal-close');
    if (b) { b.click(); await pace(); }
  };
  E.tableRows = (root) => [...scope(root).querySelectorAll('.ant-table-tbody > tr.ant-table-row, table tbody tr')].filter(visible).map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()));

  // --- current step detection --------------------------------------------------------------
  E.currentHeader = () => {
    const h = [...document.querySelectorAll('h1, h2, h3, .ant-typography, .ant-page-header-heading-title')].map((x) => x.textContent.trim()).find((t) => /NSO.*de Cosm[eé]ticos\s*[-–]\s*/i.test(t));
    return h || null;
  };
  E.currentStep = () => { const h = E.currentHeader(); const m = h && h.match(/[-–]\s*(.+)$/); return m ? m[1].trim() : null; };
  E.requestIdFromUrl = () => { const m = location.pathname.match(/cosmeticNsoRequest\/(\d+)/); return m ? m[1] : null; };

  window.__inyector = E;
})();
