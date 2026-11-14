// כותב PDF מינימלי: כל עמוד הוא תמונת JPEG בגודל A4.
// העברית מצוירת קודם על canvas בדפדפן (עם RTL נכון), ולכן אין צורך בגופנים מוטמעים.
// מגבלה: הטקסט ב-PDF אינו ניתן לבחירה/חיפוש.

const enc = new TextEncoder();

/**
 * @param {{jpeg: Uint8Array, width: number, height: number}[]} pages  width/height בפיקסלים
 * @param {{title?: string}} meta
 * @returns {Blob}
 */
export function jpegsToPdf(pages, meta = {}) {
  const A4W = 595.28, A4H = 841.89;
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    pos += b.length;
  };
  const obj = (n, body) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // 1: catalog, 2: pages, 3: info, ואז לכל עמוד: page, content, image
  const pageObj = (i) => 4 + i * 3;
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  obj(3, () => push(`<< /Producer (kniyot-pwa) /Title <${utf16hex(meta.title || 'Shopping list')}> /CreationDate (D:${pdfDate()}) >>`));

  pages.forEach((pg, i) => {
    const po = pageObj(i), co = po + 1, io = po + 2;
    // התאמת יחס: רוחב מלא, גובה לפי יחס התמונה (לרוב A4 בדיוק)
    const h = Math.min(A4H, (pg.height / pg.width) * A4W);
    obj(po, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources << /XObject << /Im${i} ${io} 0 R >> >> /Contents ${co} 0 R >>`));
    const content = `q ${A4W} 0 0 ${h.toFixed(2)} 0 ${(A4H - h).toFixed(2)} cm /Im${i} Do Q`;
    obj(co, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(io, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
      push(pg.jpeg);
      push('\nendstream');
    });
  });

  const total = 4 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

function utf16hex(s) {
  let h = 'FEFF';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 0xffff) {
      const v = c - 0x10000;
      h += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else h += c.toString(16).padStart(4, '0');
  }
  return h.toUpperCase();
}

function pdfDate() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`;
}
