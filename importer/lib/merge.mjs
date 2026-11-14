// איחוד מוצרים לקטלוג אב (data/catalog-db.json) שנשמר בין הרצות.
// כללים:
//  • מוצר עם ברקוד תקין — מפתח לפי ברקוד; אותו ברקוד מרשתות שונות = אותו מוצר.
//  • ברקוד שונה = מוצר שונה, גם אם השם דומה (גדלים/וריאציות שונים מקבלים ברקודים שונים).
//  • בלי ברקוד — איחוד רק אם השם (בלי הגודל), המותג והגודל הקנוני זהים לגמרי. אחרת נשאר נפרד.
import { looseSignature } from './normalize.mjs';

export function emptyDB() {
  return { version: 1, products: {}, loose: {}, aliases: {} };
}

export function mergeProducts(db, items) {
  const st = { added: 0, updated: 0, unchanged: 0, mergedByBarcode: 0, mergedLoose: 0 };
  const seenInRun = new Set();
  for (const it of items) {
    let key = db.aliases[it.key] || it.key;
    let existing = db.products[key];

    if (!existing && !it.barcode) {
      const sig = looseSignature(it);
      const target = sig && db.loose[sig];
      if (target && db.products[target] && !db.products[target].chains.includes(it.chain)) {
        key = target;
        existing = db.products[target];
        db.aliases[it.key] = target;
        st.mergedLoose++;
      }
    }

    if (!existing) {
      db.products[key] = {
        id: key,
        barcode: it.barcode,
        name: it.name,
        brand: it.brand,
        size: it.size,
        pack: it.pack,
        weighted: it.weighted || undefined,
        cat: it.cat,
        sub: it.sub,
        chains: [it.chain],
        sources: [{ chain: it.chain, url: it.sourceUrl, updated: it.fetchedAt, code: it.chainCode }],
        nameBy: it.chain,
        firstSeen: it.fetchedAt,
        lastSeen: it.fetchedAt,
        updated: it.fetchedAt,
      };
      if (!it.barcode) {
        const sig = looseSignature(it);
        if (sig && !db.loose[sig]) db.loose[sig] = key;
      }
      st.added++;
      seenInRun.add(key);
      continue;
    }

    if (seenInRun.has(key) && existing.chains.includes(it.chain)) {
      // אותו מוצר מסניף נוסף של אותה רשת — רק מעדכנים זמן
      existing.lastSeen = it.fetchedAt;
      continue;
    }
    if (existing.chains.length && !existing.chains.includes(it.chain) && it.barcode) st.mergedByBarcode++;
    seenInRun.add(key);

    const before = JSON.stringify([existing.name, existing.brand, existing.size, existing.cat, existing.chains]);
    if (!existing.chains.includes(it.chain)) existing.chains.push(it.chain);
    const src = existing.sources.find((s) => s.chain === it.chain);
    if (src) Object.assign(src, { url: it.sourceUrl, updated: it.fetchedAt, code: it.chainCode });
    else existing.sources.push({ chain: it.chain, url: it.sourceUrl, updated: it.fetchedAt, code: it.chainCode });

    // השם מתעדכן רק מאותה רשת שסיפקה אותו (כדי שהשם לא "יקפוץ" בין רשתות בכל הרצה)
    if (existing.nameBy === it.chain && existing.name !== it.name && !existing.lockedName) {
      (existing.altNames ||= []).includes(existing.name) || existing.altNames.push(existing.name);
      existing.name = it.name;
    } else if (existing.name !== it.name) {
      (existing.altNames ||= []).includes(it.name) || existing.altNames.push(it.name);
      if (existing.altNames.length > 5) existing.altNames.shift();
    }
    if (!existing.brand && it.brand) existing.brand = it.brand;
    if (!existing.size && it.size) existing.size = it.size;
    if (existing.cat === 'other' && it.cat !== 'other' && !existing.lockedCat) { existing.cat = it.cat; existing.sub = it.sub; }
    existing.lastSeen = it.fetchedAt;

    const after = JSON.stringify([existing.name, existing.brand, existing.size, existing.cat, existing.chains]);
    if (before !== after) { existing.updated = it.fetchedAt; st.updated++; }
    else st.unchanged++;
  }
  return st;
}

/** דריסות ידניות: { "<key>": { "name": "...", "cat": "dairy", ... } } */
export function applyOverrides(db, overrides = {}) {
  let n = 0;
  for (const [key, patch] of Object.entries(overrides)) {
    const p = db.products[key];
    if (!p) continue;
    Object.assign(p, patch);
    if (patch.name) p.lockedName = true;
    if (patch.cat) p.lockedCat = true;
    n++;
  }
  return n;
}
