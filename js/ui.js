// עזרי ממשק: יצירת אלמנטים, הודעות עם "בטל", גיליון תחתון ודיאלוגים.
import { dept } from './categories.js';
import { imageURL } from './store.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** מחליף את תוכן האלמנט, ומדלג על null/false (כדי שלא יוצג "null" כטקסט). */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

/** תמונת מוצר עם מצב טעינה ותחליף כשאין תמונה או שהטעינה נכשלה. */
export function thumb(snap, size = 'm') {
  const d = dept(snap.cat);
  const box = h('div', { class: `thumb thumb-${size}`, style: { '--dept': d.color } });
  const ph = () => {
    box.classList.remove('loading');
    box.replaceChildren(h('span', { class: 'ph-icon', 'aria-hidden': 'true' }, d.icon), h('span', { class: 'ph-text' }, 'אין תמונה'));
    box.classList.add('noimg');
  };
  if (!snap.img && !snap.imgKey) { ph(); return box; }
  box.classList.add('loading');
  imageURL(snap).then((src) => {
    if (!src) return ph();
    // בתצוגה גדולה — גרסה ברזולוציה גבוהה יותר של תמונת רמי לוי
    if (size === 'xl' && /img\.rami-levy\.co\.il\/.*\/small\.jpg$/.test(src)) src = src.replace(/small\.jpg$/, 'large.jpg');
    const img = h('img', { alt: snap.name || '', loading: size === 'xl' ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.onload = () => box.classList.remove('loading');
    img.onerror = ph;
    img.src = src;
    box.replaceChildren(img);
  }, ph);
  return box;
}

export function sizePill(text) {
  return text ? h('span', { class: 'size-pill' }, text) : null;
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, { action, onAction, ms = 4500 } = {}) {
  const root = $('#toast');
  clearTimeout(toastTimer);
  root.replaceChildren(
    h('span', {}, msg),
    action ? h('button', { class: 'toast-btn', onclick: () => { root.classList.remove('show'); onAction?.(); } }, action) : null,
  );
  root.classList.add('show');
  toastTimer = setTimeout(() => root.classList.remove('show'), ms);
}

// ---------- גיליון תחתון ----------
const stack = [];
export function sheet(content, { title, onClose, full = false } = {}) {
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h('div', { class: 'sheet' + (full ? ' sheet-full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
    h('div', { class: 'sheet-head' },
      h('div', { class: 'grabber', 'aria-hidden': 'true' }),
      title ? h('h2', { class: 'sheet-title' }, title) : null,
      h('button', { class: 'icon-btn sheet-close', 'aria-label': 'סגור', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'sheet-body' }, content),
  );
  const wrap = h('div', { class: 'sheet-wrap' }, backdrop, panel);
  backdrop.addEventListener('click', () => close());
  document.body.append(wrap);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    setTimeout(() => { wrap.remove(); if (!document.querySelector('.sheet-wrap')) document.body.classList.remove('has-sheet'); }, 220);
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
    onClose?.();
  }
  stack.push(close);
  return { close, panel, body: panel.querySelector('.sheet-body') };
}
export function closeAllSheets() { [...stack].reverse().forEach((c) => c()); }

/** דיאלוג אישור מותאם (window.confirm חסום בחלק מהסביבות ואינו נוח). */
export function confirmDialog(message, { ok = 'אישור', cancel = 'ביטול', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet(
      h('div', { class: 'dialog' },
        h('p', { class: 'dialog-msg' }, message),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { answered = true; s.close(); resolve(true); } }, ok),
          h('button', { class: 'btn btn-ghost', onclick: () => { answered = true; s.close(); resolve(false); } }, cancel),
        ),
      ),
      { onClose: () => { if (!answered) resolve(false); } },
    );
  });
}

export function promptDialog(title, value = '', { ok = 'שמירה', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input', { class: 'input', value, placeholder, enterkeyhint: 'done', autocomplete: 'off' });
    const submit = () => { answered = true; s.close(); resolve(input.value.trim() || null); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const s = sheet(
      h('div', { class: 'dialog' }, input, h('button', { class: 'btn btn-primary btn-block', onclick: submit }, ok)),
      { title, onClose: () => { if (!answered) resolve(null); } },
    );
    setTimeout(() => input.focus(), 60);
  });
}

export function stepper(value, onChange, { min = 0.25, step = 1, big = false } = {}) {
  const out = h('span', { class: 'qty', 'aria-live': 'polite' }, fmt(value));
  const set = (v) => { v = Math.max(min, Math.round(v * 100) / 100); out.textContent = fmt(v); onChange(v); };
  let cur = value;
  return h('div', { class: 'stepper' + (big ? ' stepper-big' : '') },
    h('button', { class: 'step-btn', 'aria-label': 'הוסף אחד', onclick: (e) => { e.stopPropagation(); cur += step; set(cur); } }, '+'),
    out,
    h('button', { class: 'step-btn', 'aria-label': 'הפחת אחד', onclick: (e) => { e.stopPropagation(); if (cur - step < min) return onChange(0); cur -= step; set(cur); } }, '−'),
  );
}
export const fmt = (n) => (Math.round(n * 100) / 100).toString();

export function emptyState(icon, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon), h('h3', {}, title), text ? h('p', {}, text) : null, action || null);
}

export function errorState(text, onRetry) {
  return h('div', { class: 'empty error' }, h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '⚠️'), h('h3', {}, 'משהו השתבש'), h('p', {}, text), onRetry ? h('button', { class: 'btn btn-primary', onclick: onRetry }, 'נסה שוב') : null);
}

export function relTime(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'עכשיו';
  if (d < 3600) return `לפני ${Math.round(d / 60)} דק׳`;
  if (d < 86400) return `לפני ${Math.round(d / 3600)} שעות`;
  if (d < 86400 * 7) return `לפני ${Math.round(d / 86400)} ימים`;
  return new Date(ts).toLocaleDateString('he-IL');
}
