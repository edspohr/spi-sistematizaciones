// Engine: deterministic, human-paced driving of Ant Design controls. Isolated world.
// Rules baked in: exact option matches only, whitelist of clickable buttons. The only
// navigation is E.next() ("Siguiente", called by the autopilot); never submits or signs.
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
  const CONTROL = 'input:not([type=hidden]), textarea, .ant-select, .ant-switch, .ant-radio-group, .ant-picker, button[role=switch], [role=radiogroup]';
  const labelText = (lab) => E.norm(lab.textContent).replace(/[:*¿?()]+/g, ' ').replace(/\s+/g, ' ').trim();
  function controlOfLabel(lab, r) {
    const forId = lab.getAttribute && lab.getAttribute('for');
    if (forId) { const t = r.querySelector('#' + CSS.escape(forId)) || document.getElementById(forId); if (t) return t.closest('.ant-select, .ant-picker') || t; }
    const item = lab.closest('.ant-form-item, .ant-row, .form-group') || lab.parentElement;
    return item ? item.querySelector(CONTROL) : null;
  }
  // Ant Design Form ids are "<formName>_<field>" (and "<form>_<list>_<i>_<field>" in lists).
  function byId(r, id) {
    const safe = String(id).replace(/"/g, '');
    const el = r.querySelector('#' + CSS.escape(id)) || r.querySelector(`[id$="_${safe}"]`) || r.querySelector(`[name="${safe}"]`);
    return el ? (el.closest('.ant-select, .ant-picker') || el) : null;
  }
  // Words that carry meaning in a label (accents removed, short words dropped).
  const palabras = (s) => E.norm(s).replace(/[^a-z0-9ñ ]+/g, ' ').split(' ').filter((w) => w.length > 2 && !['del', 'los', 'las', 'que', 'por', 'para', 'con', 'una'].includes(w));
  // Find a control. Returns {el, via}: via is how it was found, so the filler can flag
  // controls located by an approximate label for human review.
  E.findEx = (spec, root) => {
    const r = scope(root);
    if (!spec) return { el: null };
    if (spec.id) { const el = byId(r, spec.id); if (el && visible(el)) return { el, via: 'id' }; }
    if (spec.selector) { const el = r.querySelector(spec.selector); if (el) return { el, via: 'selector' }; }
    const labels = [spec.label, ...(spec.alias || [])].filter(Boolean);
    const labs = [...r.querySelectorAll('.ant-form-item-label label, .ant-form-item-label, label')].filter(visible);
    for (const want of labels) {
      const w = labelText({ textContent: want });
      for (const lab of labs) if (labelText(lab) === w) { const el = controlOfLabel(lab, r); if (el) return { el, via: 'etiqueta' }; }
    }
    for (const want of labels) for (const el of r.querySelectorAll('[aria-label], [placeholder]')) {
      if (E.norm(el.getAttribute('aria-label') || el.getAttribute('placeholder')) === E.norm(want) && visible(el)) return { el: el.closest('.ant-select, .ant-picker') || el, via: 'aria' };
    }
    // Approximate: every meaningful word of the label (or alias) appears in a single label.
    if (spec.aproximado !== false) {
      for (const want of labels) {
        const ws = palabras(want);
        if (!ws.length) continue;
        const hits = labs.filter((lab) => { const t = labelText(lab); return ws.every((x) => t.includes(x)); });
        const ctls = [...new Set(hits.map((lab) => controlOfLabel(lab, r)).filter(Boolean))];
        if (ctls.length === 1) return { el: ctls[0], via: 'etiqueta-aproximada', etiqueta: hits[0].textContent.trim() };
      }
    }
    if (spec.id) { const el = byId(r, spec.id); if (el) return { el, via: 'id-oculto' }; }
    return { el: null };
  };
  E.find = (spec, root) => E.findEx(spec, root).el;

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

  // The planilla stores YYYY-MM-DD; the picker's placeholder tells the display format when it is
  // a pattern (DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD). Ant's default is YYYY-MM-DD.
  E.formatDate = (iso, placeholder) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso ?? '');
    const p = String(placeholder || '').toUpperCase();
    const f = /^(DD|MM|YYYY)([\/.\-])(DD|MM|YYYY)\2(DD|MM|YYYY)$/.exec(p.trim());
    if (!f) return `${m[1]}-${m[2]}-${m[3]}`;
    const parte = { YYYY: m[1], MM: m[2], DD: m[3] };
    return [f[1], f[3], f[4]].map((k) => parte[k]).join(f[2]);
  };
  E.setDate = async (el, text) => {
    const input = el.matches('input') ? el : el.querySelector('input');
    if (!input) throw new Error('el selector de fecha no tiene campo');
    text = E.formatDate(text, input.getAttribute('placeholder'));
    input.focus();
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    nativeSet(input, String(text));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await pace();
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
    await pace();
    return { leido: input.value };
  };

  // Files: assign a File to the hidden input; never click the drop zone. Then wait for the
  // upload list to show the file (Ant Upload) and report an upload error if it shows one.
  E.setFile = async (el, file) => {
    const input = el.matches('input[type=file]') ? el : el.querySelector('input[type=file]');
    if (!input) throw new Error('casilla de archivo sin input');
    const zona = input.closest('.ant-form-item, .ant-upload-wrapper, .ant-card, .ant-row') || input.parentElement;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const items = [...(zona || document).querySelectorAll('.ant-upload-list-item')];
      const mio = items.find((i) => E.norm(i.textContent).includes(E.norm(file.name).slice(0, 25)));
      if (mio && mio.matches('.ant-upload-list-item-error')) throw new Error('la plataforma rechazó el archivo: ' + (mio.getAttribute('title') || mio.textContent.trim()).slice(0, 160));
      if (mio && !mio.matches('.ant-upload-list-item-uploading')) { await pace(); return { leido: file.name }; }
      if (!items.length && Date.now() - t0 > 4000) break; // no Ant list: plain input
      await SLEEP(250);
    }
    await pace();
    return { leido: input.files && input.files[0] ? input.files[0].name : null };
  };
  // Upload slot whose surrounding text contains every keyword group (each group: any of its words).
  E.findUpload = (claves, root) => {
    const grupos = (claves || []).map((g) => (Array.isArray(g) ? g : [g]).map(E.norm));
    const cand = [];
    for (const input of scope(root).querySelectorAll('input[type=file]')) {
      if (input.closest('.ant-modal') && !root) continue;
      let zona = input.parentElement;
      for (let i = 0; i < 6 && zona; i++, zona = zona.parentElement) {
        const t = E.norm(zona.textContent);
        if (t.length > 600) break;
        if (grupos.every((g) => g.some((w) => t.includes(w)))) { cand.push({ input, largo: t.length }); break; }
      }
    }
    cand.sort((a, b) => a.largo - b.largo);
    return cand.length ? cand[0].input : null;
  };

  // Modals: open with an allowed "+ Agregar" button, fill, save with the modal's own save button.
  E.findButton = (texts, root) => {
    const wants = (Array.isArray(texts) ? texts : [texts]).map((w) => E.norm(w).replace(/^[+\-\s]+/, ''));
    const botones = [...scope(root).querySelectorAll('button, [role=button]')].filter((b) => visible(b) && !E.isForbiddenButton(b));
    for (const w of wants) for (const b of botones) { const t = E.norm(b.textContent).replace(/^[+\-\s]+/, ''); if (t === w) return b; }
    for (const w of wants) for (const b of botones) { const t = E.norm(b.textContent).replace(/^[+\-\s]+/, ''); if (t.endsWith(w) || (w.length > 6 && t.includes(w))) return b; }
    return null;
  };
  const modales = () => [...document.querySelectorAll('.ant-modal:not(.ant-zoom-leave) .ant-modal-content, .ant-drawer-content, [role=dialog]')].filter(visible);
  E.openModal = async (buttonText, root) => {
    const b = E.findButton(buttonText, root);
    if (!b) throw new Error('botón «' + [].concat(buttonText).join(' / ') + '» no encontrado');
    const antes = new Set(modales());
    safeClick(b, 'abrir modal');
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const m = modales().find((x) => !antes.has(x) && !x.contains(b));
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

  E.validationErrors = (root) => [...scope(root).querySelectorAll('.ant-form-item-explain-error, .ant-alert-error .ant-alert-message, .ant-message-error, .ant-notification-notice-error .ant-notification-notice-message')]
    .filter(visible).map((x) => {
      const item = x.closest('.ant-form-item');
      const lab = item && item.querySelector('.ant-form-item-label');
      return (lab ? lab.textContent.trim().replace(/[:*]+$/, '') + ': ' : '') + x.textContent.trim();
    });

  // --- navigation: only "Siguiente", only from the autopilot --------------------------------
  E.nextButton = () => [...document.querySelectorAll('button, [role=button]')].find((b) => visible(b) && E.norm(b.textContent) === 'siguiente' && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
  E.next = async () => {
    const b = E.nextButton();
    if (!b) throw new Error('no hay botón «Siguiente» habilitado en la pantalla');
    b.scrollIntoView({ block: 'center' });
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    b.click(); // deliberately not safeClick: "siguiente" stays forbidden everywhere else
  };

  // --- current step detection --------------------------------------------------------------
  E.currentHeader = () => {
    const h = [...document.querySelectorAll('h1, h2, h3, .ant-typography, .ant-page-header-heading-title')].map((x) => x.textContent.trim()).find((t) => /NSO.*de Cosm[eé]ticos\s*[-–]\s*/i.test(t));
    return h || null;
  };
  E.currentStep = () => { const h = E.currentHeader(); const m = h && h.match(/[-–]\s*(.+)$/); return m ? m[1].trim() : null; };
  E.requestIdFromUrl = () => { const m = location.pathname.match(/cosmeticNsoRequest\/(\d+)/); return m ? m[1] : null; };

  window.__inyector = E;
})();
