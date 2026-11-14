// פענוח קובצי המחירים (PriceFull / Price) בפורמט XML שהרשתות מפרסמות לפי חוק המזון (שקיפות מחירים).
// אין תלות בספריות: הפורמט שטוח (פריט = אלמנט עם שדות טקסט), ולכן פענוח בביטויים רגולריים מספיק.
import { gunzipSync } from 'node:zlib';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Buffer (gz או xml) → מחרוזת. מזהה gzip, BOM של UTF-16 ו-UTF-8. */
export function bufferToText(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  if (buf[0] === 0x50 && buf[1] === 0x4b) throw new Error('קובץ ZIP אינו נתמך — יש לחלץ אותו קודם');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const head = buf.subarray(0, 200).toString('latin1');
  if (/encoding=["']windows-1255["']/i.test(head)) return new TextDecoder('windows-1255').decode(buf);
  return buf.toString('utf8').replace(/^﻿/, '');
}

/** מחזיר את שדות הכותרת (ChainId, StoreId…) ואת רשימת הפריטים כאובייקטים פשוטים. */
export function parsePriceXml(text) {
  const header = {};
  for (const tag of ['ChainId', 'ChainID', 'SubChainId', 'StoreId', 'StoreID', 'BikoretNo']) {
    const m = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
    if (m) header[tag.toLowerCase()] = m[1].trim();
  }
  const items = [];
  const blockRe = /<(Item|Product)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const fieldRe = /<([A-Za-z_][\w]*)\b[^>]*>([^<]*)<\/\1>/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const obj = {};
    let f;
    fieldRe.lastIndex = 0;
    while ((f = fieldRe.exec(m[2]))) obj[f[1].toLowerCase()] = decodeEntities(f[2]).trim();
    if (Object.keys(obj).length) items.push(obj);
  }
  return { header, items };
}
