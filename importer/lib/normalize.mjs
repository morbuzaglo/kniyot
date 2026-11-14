// המרת פריט גולמי מקובץ מחירים למוצר קטלוג אחיד.
import { makeSize, parseSizeFromName, norm, stripSize } from '../../app/js/hebrew.js';
import { categorize } from './categorize.mjs';

/** בדיקת ספרת ביקורת GTIN (EAN-8/12/13/14). */
export function validGTIN(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((x, i) => { sum += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

const UNKNOWN_BRAND = /^(לא ידוע|כללי|ללא|unknown|none|-|\.|0)$/i;

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/^[\s\-*.]+|[\s\-*]+$/g, '').trim();
}

/**
 * @param raw   אובייקט שדות מה-XML (שמות שדות באותיות קטנות)
 * @param chain מזהה רשת: shufersal | ramilevy | osherad
 * @returns מוצר מנורמל או null אם אין שם/קוד
 */
export function normalizeItem(raw, chain, { sourceUrl = null, fetchedAt = new Date().toISOString() } = {}) {
  const code = String(raw.itemcode || raw.itemid || '').replace(/\D/g, '');
  const name = cleanText(raw.itemname || raw.itemnm || raw.manufactureritemdescription);
  if (!code || !name) return null;

  // ItemType=0 = קוד פנימי של הרשת (מוצרי שקילה וכו'), לא ברקוד אוניברסלי
  const internal = raw.itemtype === '0';
  const barcode = !internal && validGTIN(code) ? code : null;

  let brand = cleanText(raw.manufacturername || raw.manufacturename);
  if (UNKNOWN_BRAND.test(brand)) brand = '';

  const weighted = raw.bisweighted === '1' || /^(1|true)$/i.test(raw.bisweighted || '');
  let size = null;
  if (raw.quantity && raw.unitqty && !weighted) size = makeSize(raw.quantity, raw.unitqty);
  if (!size && raw.quantity && raw.unitofmeasure && !weighted) size = makeSize(raw.quantity, raw.unitofmeasure.replace(/^\d+\s*/, ''));
  const fromName = parseSizeFromName(name);
  // השם בדרך כלל אמין יותר מהשדה (שדה Quantity לפעמים 1 או 0 בטעות)
  if (fromName && (!size || size.amount <= 1)) size = fromName;
  const pack = Number(raw.qtyinpackage) > 1 ? Number(raw.qtyinpackage) : null;

  const { cat, sub } = categorize(name);
  return {
    key: barcode ? 'b:' + barcode : `c:${chain}:${code}`,
    barcode,
    chainCode: code,
    name,
    brand,
    size,
    pack,
    weighted,
    cat,
    sub,
    chain,
    sourceUrl,
    fetchedAt,
    country: cleanText(raw.manufacturecountry) || null,
  };
}

/** חתימה להתאמה זהירה של מוצרים ללא ברקוד: שם בסיס + מותג + גודל קנוני. */
export function looseSignature(p) {
  if (!p.brand || !p.size) return null; // בלי מותג וגודל — לא מאחדים כלל
  const base = norm(stripSize(p.name)).split(' ').filter(Boolean).sort().join(' ');
  return `${base}|${norm(p.brand)}|${p.size.unit}:${p.size.amount}`;
}
