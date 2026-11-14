// שיתוף רשימה: הודעת טקסט, תמונות (PNG מחולקות לעמודים) ו-PDF.
// השיתוף הוא צילום מצב של הרשימה ברגע השיתוף — לא סנכרון חי.
import { dept } from './categories.js';
import { groupByDept, getImageBlob, cacheImage, UNITS } from './store.js';
import { jpegsToPdf } from './pdf.js';

const FONT = '-apple-system, "SF Hebrew", "Segoe UI", "Noto Sans Hebrew", Arial, sans-serif';

export function itemsForShare(items, includeDone) {
  const open = items.filter((i) => i.status === 'open');
  if (includeDone || !open.length) return items;
  return open;
}

/** "×2" ליחידות, "1.5 ק״ג" ליחידות מידה. */
export function qtyText(it) {
  if (it.unit && it.unit !== 'unit') return `${fmt(it.qty)} ${UNITS[it.unit] || it.unit}`;
  return `×${fmt(it.qty)}`;
}
const fmt = (n) => (Math.round(n * 100) / 100).toString();

export const SUBST = {
  ask: '',
  any: 'אם חסר — אפשר מותג אחר',
  same: 'אם חסר — רק אותו מותג בגודל אחר',
  none: 'בלי תחליף',
};

function dateStr(d = new Date()) {
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

// ---------- טקסט ----------
export function buildText(list, items) {
  const lines = [`🛒 *${list.name}* — ${items.length} פריטים`, ''];
  for (const g of groupByDept(items)) {
    lines.push(`*${g.dept.name}*`);
    for (const it of g.items) {
      const s = it.snapshot;
      const meta = [s.brand, s.sizeText].filter(Boolean).join(' · ');
      const mark = it.status === 'bought' ? '✅ ' : it.status === 'missing' ? '❌ ' : '';
      lines.push(`• ${mark}${s.name}${meta ? ` (${meta})` : ''} — ${qtyText(it)}`);
      const notes = [it.note, SUBST[it.subst]].filter(Boolean).join(' · ');
      if (notes) lines.push(`   ↳ ${notes}`);
    }
    lines.push('');
  }
  lines.push(`_רשימה מ־${dateStr()} · צילום מצב, לא מתעדכן אוטומטית_`);
  return lines.join('\n');
}

// ---------- ציור ----------
const LAYOUTS = {
  // תמונות לטלפון: 1080 רוחב, עד 1920 גובה (יחס 9:16 — נוח לגלילה בוואטסאפ)
  phone: { W: 1080, H: 1920, pad: 44, header: 200, footer: 84, img: 150, name: 42, meta: 32, note: 30, qty: 48, rowGap: 14, deptH: 64 },
  // PDF: A4 ב-150dpi
  a4: { W: 1240, H: 1754, pad: 64, header: 200, footer: 70, img: 116, name: 34, meta: 26, note: 24, qty: 38, rowGap: 12, deptH: 56 },
};

const C = { bg: '#FFFBF5', card: '#FFFFFF', ink: '#2B2620', sub: '#6E655A', accent: '#E0703A', pill: '#FCE6D6', pillInk: '#9A4317', line: '#EFE6DA', note: '#3D6B5A', noteBg: '#E4F1EA' };

function wrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1);
    keep[maxLines - 1] = last + '…';
    return keep;
  }
  return lines;
}

async function loadBitmap(snapshot) {
  try {
    let blob = await getImageBlob(snapshot.imgKey);
    if (!blob && snapshot.img) {
      const k = await cacheImage(snapshot.img);
      blob = k && (await getImageBlob(k));
    }
    if (!blob) return null;
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawImageBox(ctx, bmp, snap, x, y, s) {
  ctx.save();
  roundRect(ctx, x, y, s, s, 22);
  ctx.fillStyle = '#F6F1EA';
  ctx.fill();
  ctx.clip();
  if (bmp) {
    // contain בתוך ריבוע
    const r = Math.min(s / bmp.width, s / bmp.height) * 0.92;
    const w = bmp.width * r, h = bmp.height * r;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, s, s);
    ctx.drawImage(bmp, x + (s - w) / 2, y + (s - h) / 2, w, h);
  } else {
    const d = dept(snap.cat);
    ctx.fillStyle = d.color + '55';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = d.color;
    ctx.font = `700 ${Math.round(s * 0.42)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillText((snap.name || '?').trim()[0] || '?', x + s / 2, y + s / 2 + 4);
    ctx.font = `500 ${Math.round(s * 0.11)}px ${FONT}`;
    ctx.fillStyle = C.sub;
    ctx.fillText('אין תמונה', x + s / 2, y + s - s * 0.12);
  }
  ctx.restore();
}

/** מודד ומחזיר את גובה השורה ואת השורות העטופות. */
function measureRow(ctx, L, it) {
  const textW = L.W - L.pad * 2 - L.img - 36 - 220; // מקום לכמות משמאל
  ctx.font = `700 ${L.name}px ${FONT}`;
  const nameLines = wrap(ctx, it.snapshot.name, textW, 2);
  const notes = [it.note, SUBST[it.subst]].filter(Boolean).join(' · ');
  ctx.font = `600 ${L.note}px ${FONT}`;
  const noteLines = notes ? wrap(ctx, notes, textW - 30, 2) : [];
  const textH = nameLines.length * L.name * 1.25 + L.meta * 1.6 + (noteLines.length ? noteLines.length * L.note * 1.35 + 18 : 0);
  return { nameLines, noteLines, h: Math.max(L.img, textH) + 28 };
}

/** מחלק את הפריטים לעמודים לפי גובה אמיתי של כל שורה — במקום להקטין הכול לתמונה אחת. */
export function paginate(items, kind = 'phone') {
  const L = LAYOUTS[kind];
  const ctx = new OffscreenCanvasOr(10, 10).getContext('2d');
  ctx.direction = 'rtl';
  const pages = [[]];
  let y = L.header;
  const limit = L.H - L.footer;
  for (const g of groupByDept(items)) {
    let first = true;
    for (const it of g.items) {
      const m = measureRow(ctx, L, it);
      const need = (first ? L.deptH : 0) + m.h + L.rowGap;
      if (y + need > limit && pages[pages.length - 1].length) {
        pages.push([]);
        y = L.header;
        first = true; // כותרת המחלקה חוזרת בעמוד החדש
      }
      const add = (first ? L.deptH : 0) + m.h + L.rowGap;
      pages[pages.length - 1].push({ it, m, dept: first ? g.dept : null });
      y += add;
      first = false;
    }
  }
  return pages;
}

function OffscreenCanvasOr(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function renderPage(page, idx, total, list, count, kind, bitmaps) {
  const L = LAYOUTS[kind];
  const canvas = document.createElement('canvas');
  // גובה בפועל: בטלפון — לפי התוכן (לא משאירים לבן מיותר), ב-A4 — קבוע
  let contentH = L.header;
  for (const r of page) contentH += (r.dept ? L.deptH : 0) + r.m.h + L.rowGap;
  const H = kind === 'a4' ? L.H : Math.min(L.H, Math.max(900, contentH + L.footer + 10));
  canvas.width = L.W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, L.W, H);

  const R = L.W - L.pad; // קצה ימני
  // כותרת
  ctx.fillStyle = C.accent;
  roundRect(ctx, L.pad, L.pad - 8, L.W - L.pad * 2, 12, 6);
  ctx.fill();
  ctx.textAlign = 'right';
  ctx.fillStyle = C.ink;
  const ty0 = L.pad + Math.round(L.name * 1.55);
  ctx.font = `800 ${Math.round(L.name * 1.35)}px ${FONT}`;
  ctx.fillText(list.name, R, ty0);
  ctx.font = `500 ${L.meta}px ${FONT}`;
  ctx.fillStyle = C.sub;
  ctx.fillText(`${count} פריטים · ${dateStr()}`, R, ty0 + L.meta * 1.6);
  ctx.textAlign = 'left';
  ctx.font = `700 ${L.meta}px ${FONT}`;
  ctx.fillStyle = C.accent;
  if (total > 1) ctx.fillText(`עמוד ${idx + 1} מתוך ${total}`, L.pad, ty0);

  let y = L.header;
  for (const r of page) {
    if (r.dept) {
      ctx.textAlign = 'right';
      ctx.font = `800 ${L.meta * 1.1}px ${FONT}`;
      ctx.fillStyle = r.dept.color;
      roundRect(ctx, R - 10, y + 14, 10, L.deptH - 34, 5);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.fillText(r.dept.name, R - 24, y + L.deptH - 26);
      y += L.deptH;
    }
    const { it, m } = r;
    // כרטיס
    ctx.fillStyle = C.card;
    roundRect(ctx, L.pad, y, L.W - L.pad * 2, m.h, 26);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    const ix = R - 14 - L.img, iy = y + 14;
    drawImageBox(ctx, bitmaps.get(it.id), it.snapshot, ix, iy, L.img);
    if (it.status !== 'open') {
      ctx.fillStyle = it.status === 'bought' ? '#3C8D5A' : '#B5473A';
      ctx.font = `800 ${L.meta}px ${FONT}`;
      ctx.textAlign = 'center';
      roundRect(ctx, ix + 8, iy + L.img - 50, L.img - 16, 42, 14); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(it.status === 'bought' ? 'נקנה' : 'לא נמצא', ix + L.img / 2, iy + L.img - 18);
    }
    // טקסטים
    const tx = ix - 28;
    let ty = y + 14 + L.name;
    ctx.textAlign = 'right';
    ctx.fillStyle = C.ink;
    ctx.font = `700 ${L.name}px ${FONT}`;
    for (const ln of m.nameLines) { ctx.fillText(ln, tx, ty); ty += L.name * 1.25; }
    ty += L.meta * 0.25;
    // מותג + גודל (הגודל בולט בתוך "גלולה" כדי להבחין בין אריזות)
    let cx = tx;
    const s = it.snapshot;
    if (s.sizeText) {
      ctx.font = `800 ${L.meta}px ${FONT}`;
      const w = ctx.measureText(s.sizeText).width + 28;
      ctx.fillStyle = C.pill;
      roundRect(ctx, cx - w, ty - L.meta * 0.95, w, L.meta * 1.35, L.meta * 0.6);
      ctx.fill();
      ctx.fillStyle = C.pillInk;
      ctx.fillText(s.sizeText, cx - 14, ty);
      cx -= w + 16;
    }
    if (s.brand) {
      ctx.font = `500 ${L.meta}px ${FONT}`;
      ctx.fillStyle = C.sub;
      ctx.fillText(s.brand, cx, ty);
    }
    ty += L.meta * 0.6;
    if (m.noteLines.length) {
      const nh = m.noteLines.length * L.note * 1.35 + 14;
      ctx.font = `600 ${L.note}px ${FONT}`;
      let maxw = 0;
      for (const ln of m.noteLines) maxw = Math.max(maxw, ctx.measureText(ln).width);
      ctx.fillStyle = C.noteBg;
      roundRect(ctx, tx - maxw - 30, ty, maxw + 30, nh, 14);
      ctx.fill();
      ctx.fillStyle = C.note;
      let ny = ty + L.note * 1.1;
      for (const ln of m.noteLines) { ctx.fillText(ln, tx - 15, ny); ny += L.note * 1.35; }
    }
    // כמות — בצד שמאל, גדולה
    const qt = qtyText(it);
    const qf = qt.startsWith('×') ? L.qty : Math.round(L.qty * 0.72);
    ctx.font = `800 ${qf}px ${FONT}`;
    ctx.textAlign = 'center';
    const qw = Math.max(L.qty * 2.3, ctx.measureText(qt).width + 40);
    ctx.fillStyle = C.accent;
    roundRect(ctx, L.pad + 20, y + m.h / 2 - L.qty * 0.85, qw, L.qty * 1.7, 22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.direction = qt.startsWith('×') ? 'ltr' : 'rtl';
    ctx.fillText(qt, L.pad + 20 + qw / 2, y + m.h / 2 + qf * 0.36);
    ctx.direction = 'rtl';
    y += m.h + L.rowGap;
  }
  // תחתית
  ctx.textAlign = 'center';
  ctx.font = `500 ${L.note}px ${FONT}`;
  ctx.fillStyle = C.sub;
  ctx.fillText('צילום מצב של הרשימה — לא מתעדכן אוטומטית', L.W / 2, H - L.footer / 2);
  return canvas;
}

async function bitmapsFor(items) {
  const m = new Map();
  await Promise.all(items.map(async (it) => m.set(it.id, await loadBitmap(it.snapshot))));
  return m;
}

const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, q));

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '').trim() || 'רשימה';
}

/** מחזיר File[] של תמונות PNG, עמוד לכל קבוצת פריטים. */
export async function buildImages(list, items) {
  const pages = paginate(items, 'phone');
  const bmps = await bitmapsFor(items);
  const files = [];
  for (let i = 0; i < pages.length; i++) {
    const c = await renderPage(pages[i], i, pages.length, list, items.length, 'phone', bmps);
    const blob = await toBlob(c, 'image/png');
    const suffix = pages.length > 1 ? `-${i + 1}` : '';
    files.push(new File([blob], `${safeName(list.name)}${suffix}.png`, { type: 'image/png' }));
  }
  return files;
}

export async function buildPdf(list, items) {
  const pages = paginate(items, 'a4');
  const bmps = await bitmapsFor(items);
  const jpgs = [];
  for (let i = 0; i < pages.length; i++) {
    const c = await renderPage(pages[i], i, pages.length, list, items.length, 'a4', bmps);
    const b = await toBlob(c, 'image/jpeg', 0.86);
    jpgs.push({ jpeg: new Uint8Array(await b.arrayBuffer()), width: c.width, height: c.height });
  }
  const pdf = jpegsToPdf(jpgs, { title: list.name });
  return new File([pdf], `${safeName(list.name)}.pdf`, { type: 'application/pdf' });
}

// ---------- שיתוף בפועל ----------
export function canShareFiles(files) {
  try { return !!(navigator.canShare && navigator.canShare({ files })); } catch { return false; }
}
export function canShareText() {
  return typeof navigator.share === 'function';
}

/**
 * חייב להיקרא ישירות מתוך לחיצה (user activation). לכן הקבצים מוכנים מראש,
 * ורק הקריאה ל-navigator.share מתבצעת בלחיצה.
 * מחזיר 'shared' | 'cancelled' | 'unsupported' | 'error:<msg>'
 */
export async function shareFiles(files, title) {
  if (!canShareFiles(files)) return 'unsupported';
  try {
    await navigator.share({ files, title });
    return 'shared';
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
    if (e && e.name === 'NotAllowedError') return 'blocked'; // פג תוקף הלחיצה בזמן ההכנה — צריך לחיצה נוספת
    return 'error:' + (e?.message || e);
  }
}

export async function shareText(text, title) {
  if (!canShareText()) return 'unsupported';
  try { await navigator.share({ text, title }); return 'shared'; }
  catch (e) { return e?.name === 'AbortError' ? 'cancelled' : 'error:' + (e?.message || e); }
}

export function whatsappTextURL(text) {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}
