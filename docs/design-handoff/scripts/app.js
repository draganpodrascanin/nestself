/* Local, framework-neutral interactions. No network calls, analytics or submitted data. */
(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('design-data').textContent);
  const root = document.documentElement;
  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
  const validViews = ['home', 'system', 'handoff'];
  const preferenceKey = 'nestself-design-reference-v03';
  let toastTimer;
  let selectedTime = '';
  let chatPending = false;
  const openers = new WeakMap();

  function luminance(hex) {
    const c = hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255)
      .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function current() {
    return { palette: root.dataset.palette, mode: root.dataset.mode, font: root.dataset.font };
  }
  function currentColours() { return data.themes[root.dataset.palette][root.dataset.mode]; }
  function announce(message) { $('#announcer').textContent = message; }
  function toast(message) {
    const node = $('#toast');
    clearTimeout(toastTimer);
    node.hidden = false;
    node.textContent = message;
    toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
  }
  function savePreferences() {
    try { localStorage.setItem(preferenceKey, JSON.stringify(current())); } catch (_) { /* file:// and private mode may deny storage */ }
  }
  function briefForSelection() {
    const theme = data.themes[root.dataset.palette].name;
    const font = data.fonts.find(x => x.id === root.dataset.font).name;
    return data.prompt.replace('Forest & Mint, light mode, Onest', `${theme}, ${root.dataset.mode} mode, ${font}`);
  }
  function paletteCSS(all = false) {
    if (all) return $('#all-theme-css').textContent;
    const c = current();
    const font = data.fonts.find(x => x.id === c.font).name;
    return `/* NestSelf 0.3 · ${data.themes[c.palette].name} · ${c.mode} */\n` +
      `:root, html[data-palette="${c.palette}"][data-mode="${c.mode}"] {\n` +
      `  color-scheme: ${c.mode};\n  --font-body: "${font}", system-ui, sans-serif;\n  --font-heading: var(--font-body);\n` +
      Object.entries(currentColours()).map(([k, v]) => `  --color-${k}: ${v};`).join('\n') + '\n}\n';
  }
  function renderTokenGrid() {
    const keys = ['canvas', 'surface', 'primary', 'primary-hover', 'text', 'text-secondary', 'tint', 'accent', 'on-accent', 'border-control', 'focus', 'danger'];
    const colours = currentColours();
    const grid = $('#token-grid');
    grid.replaceChildren();
    keys.forEach(key => {
      const token = document.createElement('div'); token.className = 'token';
      const swatch = document.createElement('div'); swatch.className = 'token-color'; swatch.style.background = colours[key];
      const label = document.createElement('div'); label.className = 'token-label';
      const code = document.createElement('code'); code.textContent = `--color-${key}`;
      const value = document.createElement('span'); value.textContent = colours[key];
      label.append(code, value); token.append(swatch, label); grid.append(token);
    });
    const pairs = [
      ['Body text / surface', 'text', 'surface', 4.5],
      ['Secondary text / surface', 'text-secondary', 'surface', 4.5],
      ['Button text / primary', 'on-primary', 'primary', 4.5],
      ['Accent text / accent', 'on-accent', 'accent', 4.5],
      ['Input boundary / surface', 'border-control', 'surface', 3],
      ['Focus / canvas', 'focus', 'canvas', 3]
    ];
    const region = document.createElement('div'); region.className = 'table-scroll';
    region.setAttribute('role', 'region'); region.setAttribute('aria-label', 'Current palette contrast'); region.tabIndex = 0;
    const table = document.createElement('table');
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th scope="col">Pair</th><th scope="col">Ratio</th><th scope="col">Minimum</th><th scope="col">Result</th></tr>';
    const body = document.createElement('tbody');
    pairs.forEach(([name, fg, bg, minimum]) => {
      const tr = document.createElement('tr'); const ratio = contrast(colours[fg], colours[bg]);
      [name, `${ratio.toFixed(2)}:1`, `${minimum}:1`, ratio >= minimum ? 'Pass' : 'Review'].forEach(value => {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }); body.append(tr);
    });
    table.append(head, body); region.append(table); $('#live-contrast').replaceChildren(region);
  }
  function applySelection(next = {}, speak = false) {
    if (next.palette && data.themes[next.palette]) root.dataset.palette = next.palette;
    if (next.mode && ['light', 'dark'].includes(next.mode)) root.dataset.mode = next.mode;
    if (next.font && data.fonts.some(x => x.id === next.font)) root.dataset.font = next.font;
    const c = current();
    $('#palette-select').value = c.palette;
    $('#font-select').value = c.font;
    $('#mode-toggle').setAttribute('aria-pressed', String(c.mode === 'dark'));
    $$('[data-current-palette]').forEach(el => { el.textContent = data.themes[c.palette].name; });
    $$('[data-current-mode]').forEach(el => { el.textContent = c.mode; });
    $$('[data-palette-card]').forEach(el => { el.dataset.selected = String(el.dataset.paletteCard === c.palette); });
    $$('[data-choose-palette]').forEach(btn => {
      const active = btn.dataset.choosePalette === c.palette;
      btn.setAttribute('aria-pressed', String(active));
      btn.textContent = active ? 'Selected palette' : `Use ${data.themes[btn.dataset.choosePalette].name}`;
    });
    $$('[data-choose-font]').forEach(btn => {
      const active = btn.dataset.chooseFont === c.font;
      btn.setAttribute('aria-pressed', String(active));
      btn.textContent = active ? 'Selected typeface' : 'Try everywhere';
    });
    $('#claude-prompt').textContent = briefForSelection();
    renderTokenGrid();
    savePreferences();
    if (speak) announce(`${data.themes[c.palette].name}, ${c.mode} mode, ${data.fonts.find(x => x.id === c.font).name}.`);
  }
  function closeSiteMenu() {
    $('#site-nav').dataset.open = 'false'; $('#menu-toggle').setAttribute('aria-expanded', 'false');
  }
  function renderRoute(scroll = true) {
    const parts = location.hash.slice(1).split('/');
    const view = parts[0] || 'home';
    if (!validViews.includes(view)) return; // Native same-page targets, including Skip to content.
    $$('[data-view-panel]').forEach(panel => { panel.hidden = panel.dataset.viewPanel !== view; });
    $$('[data-view]').forEach(btn => {
      if (btn.dataset.view === view) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    closeSiteMenu();
    if (scroll) requestAnimationFrame(() => {
      const id = parts[1] ? (view === 'home' ? `home-${parts[1]}` : parts[1]) : null;
      const destination = id ? document.getElementById(id) : $('#main');
      if (destination) {
        destination.scrollIntoView({ block: 'start', behavior: 'auto' });
        const heading = destination.querySelector('h1,h2,h3');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }
    });
  }
  function navigate(view, section = '') {
    const hash = `${view}${section ? '/' + section : ''}`;
    if (location.hash === '#' + hash) renderRoute(true);
    else location.hash = hash;
  }
  async function copyText(text, label) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const textarea = document.createElement('textarea'); textarea.value = text;
      textarea.style.position = 'fixed'; textarea.style.left = '-9999px';
      document.body.append(textarea); textarea.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      textarea.remove();
      if (!ok) { toast('Clipboard is unavailable here. Use the download button or select the displayed text.'); return false; }
    }
    toast(label); return true;
  }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${filename} is ready.`);
  }
  function openDialog(id, opener = document.activeElement) {
    const dialog = document.getElementById(id);
    if (!dialog || dialog.open) return;
    openers.set(dialog, opener);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { toast('This browser does not support the native dialog example. Use a current browser.'); }
  }
  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }
  $$('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => {
      const opener = openers.get(dialog);
      if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog(dialog);
    });
  });
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close-dialog], [data-close-link]');
    if (close) { closeDialog(close.closest('dialog')); return; }
    const trigger = event.target.closest('[data-dialog]');
    if (trigger) { openDialog(trigger.dataset.dialog, trigger); return; }
    const palette = event.target.closest('[data-choose-palette]');
    if (palette) { applySelection({ palette: palette.dataset.choosePalette }, true); return; }
    const font = event.target.closest('[data-choose-font]');
    if (font) { applySelection({ font: font.dataset.chooseFont }, true); return; }
    const view = event.target.closest('[data-view]');
    if (view) { navigate(view.dataset.view); return; }
    const device = event.target.closest('[data-device]');
    if (device) {
      $('#site-stage').classList.toggle('mobile', device.dataset.device === 'mobile');
      $$('[data-device]').forEach(b => b.setAttribute('aria-pressed', String(b === device)));
      announce(device.dataset.device === 'mobile' ? 'Homepage preview constrained to 390 pixels.' : 'Homepage preview at full width.');
      return;
    }
    const support = event.target.closest('[data-support]');
    if (support) {
      $('#booking-area').textContent = support.dataset.support;
      // Other support branches use their own real provider list. Do not relabel a psychological advisor as legal/financial.
      if (support.dataset.support !== 'Psychological support') {
        $('#booking-area').textContent = 'Psychological support';
        toast('The booking example shows psychological support. Legal and financial guidance use the same component rules with their own qualified providers.');
      }
    }
  });
  $('#palette-select').addEventListener('change', e => applySelection({ palette: e.target.value }, true));
  $('#font-select').addEventListener('change', e => applySelection({ font: e.target.value }, true));
  $('#mode-toggle').addEventListener('click', () => applySelection({ mode: root.dataset.mode === 'light' ? 'dark' : 'light' }, true));
  $('#menu-toggle').addEventListener('click', () => {
    const open = $('#menu-toggle').getAttribute('aria-expanded') !== 'true';
    $('#menu-toggle').setAttribute('aria-expanded', String(open)); $('#site-nav').dataset.open = String(open);
  });
  window.addEventListener('hashchange', () => renderRoute(true));
  $('#copy-current-css').addEventListener('click', () => copyText(paletteCSS(), 'Current palette CSS copied.'));
  $('#copy-brief').addEventListener('click', () => copyText(briefForSelection(), 'Project setup brief copied.'));
  $('#download-css').addEventListener('click', () => download(paletteCSS(true), 'NestSelf_All_Themes.css', 'text/css;charset=utf-8'));
  $('#download-current-css').addEventListener('click', () => download(paletteCSS(), `NestSelf_${root.dataset.palette}_${root.dataset.mode}.css`, 'text/css;charset=utf-8'));
  $('#download-tokens').addEventListener('click', () => download(JSON.stringify({ ...data.tokens, default: current() }, null, 2), 'NestSelf_Tokens_v0.3.json', 'application/json'));

  // Meaningful local state examples.
  $('#loading-demo').addEventListener('click', () => {
    const button = $('#loading-demo'); button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Confirming…';
    setTimeout(() => { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = 'Preview loading'; toast('Loading example complete. The button kept its dimensions and a readable label.'); }, 1000);
  });
  $$('#filter-chips .chip').forEach(chip => chip.addEventListener('click', () => chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))));
  $('#notification-switch').addEventListener('click', () => {
    const button = $('#notification-switch'); const checked = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(checked)); $('#switch-feedback').textContent = `Notification example is ${checked ? 'on' : 'off'}.`;
  });
  const email = $('#example-email');
  function validateEmail() {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    email.setAttribute('aria-invalid', String(!valid)); $('#email-error').hidden = valid;
    email.setAttribute('aria-describedby', valid ? 'email-help' : 'email-help email-error');
    return valid;
  }
  email.addEventListener('blur', () => { if (email.value) validateEmail(); });
  $('#example-form').addEventListener('submit', event => {
    event.preventDefault();
    let summary = $('#form-errors');
    if (!summary) {
      summary = document.createElement('div'); summary.id = 'form-errors'; summary.className = 'alert danger full'; summary.tabIndex = -1; summary.setAttribute('role', 'alert');
      const p = document.createElement('p'); p.innerHTML = '<strong>Check the email address.</strong> <a href="#example-email">Go to the work email field</a>.'; summary.append(p);
      $('#example-form').prepend(summary);
      $('a', summary).addEventListener('click', event => { event.preventDefault(); email.focus(); });
    }
    const valid = validateEmail(); summary.hidden = valid;
    $('#form-feedback').textContent = valid ? 'Example validated. No information was sent.' : '';
    if (!valid) summary.focus();
  });
  $('#confirm-cancel').addEventListener('click', () => { closeDialog($('#cancel-dialog')); toast('Cancellation state previewed. No appointment was changed.'); });

  function bookingStep(step, focus = true) {
    const names = ['advisor', 'time', 'confirm', 'done'];
    names.forEach(name => { $(`#booking-${name}`).hidden = name !== step; });
    $('#booking-step-label').textContent = step === 'done' ? 'Demonstration complete' : `Step ${names.indexOf(step) + 1} of 3`;
    if (focus) { const heading = $(`#booking-${step} h3`); heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  $('#booking-to-time').addEventListener('click', () => bookingStep('time'));
  $('#booking-back-advisor').addEventListener('click', () => bookingStep('advisor'));
  $('#booking-back-time').addEventListener('click', () => bookingStep('time'));
  $$('#time-grid .chip').forEach(button => button.addEventListener('click', () => {
    selectedTime = button.textContent.trim();
    $$('#time-grid .chip').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    $('#selected-time').textContent = selectedTime; $('#booking-to-confirm').disabled = false;
    announce(`${selectedTime} selected, Europe/Belgrade.`);
  }));
  $('#booking-to-confirm').addEventListener('click', () => { if (selectedTime) bookingStep('confirm'); });
  $('#booking-submit').addEventListener('click', () => { bookingStep('done'); announce('Example confirmed. No payment or appointment was created.'); });
  $('#booking-reset').addEventListener('click', () => {
    selectedTime = ''; $$('#time-grid .chip').forEach(b => b.setAttribute('aria-pressed', 'false')); $('#booking-to-confirm').disabled = true; bookingStep('advisor');
  });
  $('#chat-form').addEventListener('submit', event => {
    event.preventDefault(); if (chatPending) return;
    const input = $('#chat-input'); const text = input.value.trim(); if (!text) { input.focus(); return; }
    const bubble = document.createElement('p'); bubble.className = 'message mine'; bubble.textContent = text;
    $('#chat-messages').append(bubble);
    $('#chat-state').textContent = 'Not sent. Your draft is still here. Use Retry to preview recovery.';
    $('#chat-retry').hidden = false; input.readOnly = true; $('#chat-form button[type="submit"]').disabled = true; chatPending = true;
    $('#chat-retry').focus();
  });
  $('#chat-retry').addEventListener('click', () => {
    $('#chat-state').textContent = 'Sent in the local example. No real message was delivered.';
    $('#chat-retry').hidden = true; $('#chat-input').value = ''; $('#chat-input').readOnly = false; $('#chat-form button[type="submit"]').disabled = false; chatPending = false; $('#chat-input').focus();
  });
  function renderState() {
    const [key, title, body, action] = data.resilience.find(row => row[0] === $('#state-select').value);
    const target = $('#state-preview'); target.replaceChildren();
    if (key === 'loading') {
      const skeleton = document.createElement('div'); skeleton.className = 'skeleton'; skeleton.setAttribute('aria-hidden', 'true'); skeleton.innerHTML = '<span></span><span></span><span></span>'; target.append(skeleton);
    }
    const heading = document.createElement('h3'); heading.textContent = title;
    const p = document.createElement('p'); p.textContent = body; target.append(heading, p);
    if (action) {
      const button = document.createElement('button'); button.className = 'btn secondary'; button.textContent = action;
      button.addEventListener('click', () => {
        if (['empty', 'results', 'stale', 'expired'].includes(key)) navigate('system', 'patterns');
        else if (key === 'protected' || key === 'permission') navigate('system', 'hr');
        else toast('Retry is demonstrated in the chat example. No network operation was made.');
      }); target.append(button);
    }
  }
  $('#state-select').addEventListener('change', renderState);
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(preferenceKey) || '{}'); } catch (_) {}
  applySelection(preferences);
  renderState();
  renderRoute(Boolean(location.hash));
  // Pure helpers exposed only for handoff checks; no service API.
  window.NestSelfReference = { contrast, luminance, current, paletteCSS, briefForSelection, dataVersion: data.tokens.version };
})();
