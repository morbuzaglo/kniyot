// נרמול טקסט עברי, פירוק גדלי אריזה והתאמה עמומה (fuzzy) לחיפוש.
// משותף לאפליקציה ולתהליך הייבוא.

const NIQQUD = /[֑-ׇ]/g;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** נרמול לצורך השוואה: בלי ניקוד, אותיות סופיות → רגילות, בלי גרשיים ופיסוק, אותיות קטנות. */
export function norm(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKC')
    .replace(NIQQUD, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .toLowerCase()
    .replace(/(\d)[.,](\d)/g, '$1d$2')        // 1.5 → 1d5 כדי לא לפרק מספרים עשרוניים
    .replace(/["'`׳״“”‘’]/g, '')               // מ"ל → מל, ג' → ג
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/(\d)d(\d)/g, '$1.$2')
    .trim();
}

export function tokens(s) {
  const n = norm(s);
  return n ? n.split(' ') : [];
}

// ---------- גודל אריזה ----------

const UNIT_ALIASES = [
  // [regex על טקסט מנורמל, יחידה קנונית, מכפיל]
  [/^(ק\s?ג|קג|קילו|קילוגרמ|קילוגרם|kg)$/, 'g', 1000],
  [/^(ג|גר|גרמ|גרם|גרמימ|גרמים|g|gr)$/, 'g', 1],
  [/^(מל|מיליליטר|ml|מ\s?ל)$/, 'ml', 1],
  [/^(ל|ליטר|ליטרימ|ליטרים|l|lt|ltr)$/, 'ml', 1000],
  [/^(יח|יחידה|יחידות|יחידות|יחי|יחידת|units?|pcs)$/, 'unit', 1],
  [/^(גלילימ|גלילים|גליל)$/, 'roll', 1],
  [/^(מטר|מ|m)$/, 'm', 1],
];

function canonicalUnit(u) {
  const n = norm(u).replace(/\s+/g, '');
  for (const [re, unit, mul] of UNIT_ALIASES) if (re.test(n)) return { unit, mul };
  return null;
}

/** בונה אובייקט גודל קנוני: amount ביחידת בסיס (גרם/מ"ל/יחידה), וטקסט תצוגה בעברית. */
export function makeSize(amount, unitRaw) {
  const a = Number(String(amount).replace(',', '.'));
  if (!isFinite(a) || a <= 0) return null;
  const cu = canonicalUnit(unitRaw);
  if (!cu) return null;
  const base = Math.round(a * cu.mul * 1000) / 1000;
  return { amount: base, unit: cu.unit, text: sizeText(base, cu.unit) };
}

export function sizeText(amount, unit) {
  const f = (x) => (Math.round(x * 100) / 100).toString();
  switch (unit) {
    case 'g': return amount >= 1000 ? `${f(amount / 1000)} ק״ג` : `${f(amount)} גרם`;
    case 'ml': return amount >= 1000 ? `${f(amount / 1000)} ליטר` : `${f(amount)} מ״ל`;
    case 'unit': return `${f(amount)} יח׳`;
    case 'roll': return `${f(amount)} גלילים`;
    case 'm': return `${f(amount)} מטר`;
    default: return `${f(amount)}`;
  }
}

/** מחפש גודל בתוך שם מוצר, למשל "קוטג' 5% 250 גרם" או "שמן קנולה 1 ל". */
export function parseSizeFromName(name) {
  if (!name) return null;
  const s = String(name).replace(/[״"]/g, '"').replace(/׳/g, "'");
  const re = /(\d+(?:[.,]\d+)?)\s*(ק"ג|קג|קילו(?:גרם)?|גר(?:ם|מים)?|ג'|ג(?=\s|$)|מ"ל|מל|ליטר|ל'|ל(?=\s|$)|יח'|יחידות|יחידה|גלילים|kg|ml|gr|g|l)(?=[\s,)\-]|$)/gi;
  let m, last = null;
  while ((m = re.exec(s))) last = m;               // הגודל בדרך כלל בסוף השם
  return last ? makeSize(last[1], last[2]) : null;
}

/** מסיר מהשם את טקסט הגודל, כדי לקבל "שם בסיס" לקיבוץ וריאציות. */
export function stripSize(name) {
  return String(name || '')
    .replace(/(\d+(?:[.,]\d+)?)\s*(ק"ג|ק״ג|קג|קילו(?:גרם)?|גר(?:ם|מים)?|ג'|ג׳|ג(?=\s|$)|מ"ל|מ״ל|מל|ליטר|ל'|ל(?=\s|$)|יח'|יח׳|יחידות|יחידה|גלילים|kg|ml|gr|g|l)(?=[\s,)\-]|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- התאמה עמומה ----------

/** מרחק לוונשטיין עם עצירה מוקדמת כשהמרחק עולה על max. */
export function lev(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (la === lb && isSwap(a, b)) return 1;           // החלפת שתי אותיות סמוכות = טעות אחת
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

function isSwap(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

const PREFIXES =['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'];

/** ציון התאמה בין מילת חיפוש אחת למילה במוצר. 0 = אין התאמה. */
export function tokenScore(q, t) {
  if (!q || !t) return 0;
  if (t === q) return 10;
  if (t.startsWith(q)) return q.length >= 2 ? 8 : 5;
  if (q.length >= 3) {
    // "וחלב" / "החלב" — תחילית דקדוקית
    if (PREFIXES.includes(t[0]) && t.slice(1).startsWith(q)) return 6;
    if (PREFIXES.includes(q[0]) && t.startsWith(q.slice(1)) && q.length >= 4) return 6;
    if (t.includes(q)) return 4;
    if (q.length < 4) return 0; // במילים קצרות טעות של אות אחת משנה מילה (חלב/חלה) — לא מנחשים
    // טעות כתיב: משווים למילה כולה או לתחילתה באותו אורך (הקלדה חלקית)
    const max = q.length >= 6 ? 2 : 1;
    if (lev(q, t, max) <= max) return 3;
    if (t.length > q.length && lev(q, t.slice(0, q.length), max) <= max && q.length >= 4) return 2.5;
  }
  return 0;
}
