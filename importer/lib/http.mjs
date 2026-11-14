// fetch עם זמן קצוב, ניסיונות חוזרים מתונים, User-Agent מזהה וקוקיז פשוטים.
// אין כאן עקיפת חסימות: 401/403/429 מדווחים כשגיאה ולא מנסים לעקוף.
export const UA = 'kniyot-catalog-importer/1.0 (personal shopping-list app; contact: see README)';

export class CookieJar {
  constructor() { this.c = new Map(); }
  take(res) {
    const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const line of all) {
      const [kv] = line.split(';');
      const i = kv.indexOf('=');
      if (i > 0) this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}

export async function http(url, { method = 'GET', headers = {}, body, jar, timeout = 60000, retries = 2, delayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const h = { 'user-agent': UA, ...headers };
      if (jar && jar.c.size) h.cookie = jar.header();
      // הפניות מטופלות ידנית כדי לשמור קוקיז שנקבעים בתשובת ההפניה (למשל אחרי כניסה)
      let res = await fetch(url, { method, headers: h, body, signal: ctl.signal, redirect: 'manual' });
      jar?.take(res);
      for (let hop = 0; hop < 6 && res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
        const next = new URL(res.headers.get('location'), url).href;
        const h2 = { 'user-agent': UA };
        if (jar && jar.c.size) h2.cookie = jar.header();
        res = await fetch(next, { headers: h2, signal: ctl.signal, redirect: 'manual' });
        jar?.take(res);
      }
      if ([401, 403, 429].includes(res.status)) {
        const e = new Error(`HTTP ${res.status} — הגישה נדחתה/הוגבלה על ידי האתר; לא מנסים לעקוף`);
        e.fatal = true;
        throw e;
      }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.fatal = true; throw e; }
      return res;
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error(`זמן קצוב (${timeout / 1000} שניות)`) : e;
      if (lastErr.fatal || attempt === retries) break;
      await sleep(delayMs * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  const msg = lastErr?.cause?.code ? `${lastErr.message} (${lastErr.cause.code})` : lastErr?.message;
  throw new Error(`${url.split('?')[0]}: ${msg}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
