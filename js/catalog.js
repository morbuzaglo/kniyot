// טעינת הקטלוג הציבורי (קבצים סטטיים שנוצרו בתהליך הייבוא) וחיפוש בו.
import { norm, tokens, tokenScore, stripSize } from './hebrew.js';
import { dept } from './categories.js';

const state = {
  manifest: null,
  products: [],          // מוצרי הקטלוג
  custom: [],            // מוצרים אישיים (מ-IndexedDB), מוזרקים מבחוץ
  byKey: new Map(),
  index: [],             // [{p, name:[tokens], brand:[tokens], cat:[tokens], groupKey}]
  groups: new Map(),     // groupKey → מספר וריאציות
  loading: null,
  error: null,
};

export const catalog = state;

export async function loadCatalog({ force = false } = {}) {
  if (state.loading && !force) return state.loading;
  state.error = null;
  state.loading = (async () => {
    const res = await fetch('catalog/manifest.json', { cache: force ? 'reload' : 'default' });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const manifest = await res.json();
    const shards = await Promise.all(
      manifest.shards.map(async (f) => {
        const r = await fetch('catalog/' + f);
        if (!r.ok) throw new Error(`${f} ${r.status}`);
        return r.json();
      }),
    );
    state.manifest = manifest;
    state.products = shards.flat();
    rebuild();
    return state;
  })().catch((e) => {
    state.error = e;
    state.loading = null;
    throw e;
  });
  return state.loading;
}

export function setCustomProducts(list) {
  state.custom = list.map((c) => ({ ...c, key: 'u:' + c.id, custom: true }));
  rebuild();
}

function groupKeyOf(p) {
  return norm(p.brand) + '|' + norm(stripSize(p.name)).replace(/\d+(\.\d+)?%?/g, '').replace(/\s+/g, ' ').trim();
}

function rebuild() {
  state.byKey.clear();
  state.groups.clear();
  const all = [...state.custom, ...state.products];
  state.index = all.map((p) => {
    if (!p.key) p.key = p.id;
    state.byKey.set(p.key, p);
    const d = dept(p.cat);
    const g = groupKeyOf(p);
    state.groups.set(g, (state.groups.get(g) || 0) + 1);
    return {
      p,
      name: tokens(p.name),
      brand: tokens(p.brand),
      cat: tokens(d.name + ' ' + (p.sub || '')),
      size: tokens(p.size?.text || ''),
      barcode: p.barcode || '',
      groupKey: g,
    };
  });
}

export function getProduct(key) {
  return state.byKey.get(key);
}

/** כמה וריאציות (גדלים/אחוזי שומן/טעמים) יש לאותו שם בסיס ומותג. */
export function variantCount(p) {
  return state.groups.get(groupKeyOf(p)) || 1;
}

export function variantsOf(p) {
  const g = groupKeyOf(p);
  return state.index.filter((e) => e.groupKey === g && e.p.key !== p.key).map((e) => e.p);
}

/**
 * חיפוש: כל מילה בשאילתה חייבת להתאים לשם, מותג, קטגוריה או גודל.
 * ברקוד: רצף ספרות של 4 ומעלה מחפש גם בברקודים.
 */
export function search(query, { cat = null, brand = null, limit = 80 } = {}) {
  const qt = tokens(query);
  const digits = String(query || '').replace(/\D/g, '');
  const out = [];
  for (const e of state.index) {
    if (cat && e.p.cat !== cat) continue;
    if (brand && norm(e.p.brand) !== norm(brand)) continue;
    let score = 0;
    if (qt.length) {
      if (digits.length >= 4 && /^\d+$/.test(query.trim()) && e.barcode) {
        if (e.barcode === digits) score = 100;
        else if (e.barcode.includes(digits)) score = 40;
        if (!score) continue;
      } else {
        let ok = true;
        for (const q of qt) {
          let best = 0;
          for (const t of e.name) best = Math.max(best, tokenScore(q, t));
          for (const t of e.brand) best = Math.max(best, tokenScore(q, t) * 0.85);
          for (const t of e.size) best = Math.max(best, tokenScore(q, t) * 0.7);
          for (const t of e.cat) best = Math.max(best, tokenScore(q, t) * 0.5);
          if (!best) { ok = false; break; }
          score += best;
        }
        if (!ok) continue;
        // עדיפות למוצר שהשם שלו מתחיל במילה הראשונה שחיפשו
        if (e.name[0] && tokenScore(qt[0], e.name[0]) > 0) score += 3;
        if (e.p.custom) score += 1;
      }
    } else {
      score = 1;
    }
    out.push({ p: e.p, score });
  }
  out.sort((a, b) => b.score - a.score || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name, 'he'));
  return out.slice(0, limit).map((r) => r.p);
}

export function brandsFor(cat) {
  const m = new Map();
  for (const e of state.index) {
    if (cat && e.p.cat !== cat) continue;
    if (!e.p.brand) continue;
    m.set(e.p.brand, (m.get(e.p.brand) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
}
