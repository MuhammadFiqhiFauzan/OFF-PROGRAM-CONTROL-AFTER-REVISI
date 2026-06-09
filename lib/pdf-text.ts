/*
 * Tujuan: Helper agar SELURUH teks yang digambar ke halaman PDF otomatis UPPERCASE (CapsLock).
 * Caller: generator PDF OFF Program Control & Claim Workflow (pdf.ts, reconciliation-pdf.ts,
 *         pdf-receipt.ts, pdf-summary.ts).
 * Cara pakai: bungkus hasil pdfDoc.addPage([...]) -> uppercasePageText(pdfDoc.addPage([...])).
 * Dependensi: pdf-lib (tipe PDFPage). Tidak ada side effect lain.
 *
 * Catatan: Hanya argumen teks (string) pada page.drawText yang di-uppercase. drawRectangle,
 * drawImage, dsb. tidak terpengaruh. Aman dipanggil berulang (idempoten via penanda).
 */
import type { PDFPage } from "pdf-lib";

const PATCHED = Symbol.for("accapi.pdf.uppercase.patched");

export function uppercasePageText<T extends PDFPage>(page: T): T {
  const target = page as unknown as Record<PropertyKey, unknown>;
  if (target[PATCHED]) return page;

  const original = page.drawText.bind(page);
  page.drawText = ((text: string, options?: Parameters<PDFPage["drawText"]>[1]) => {
    const upper = typeof text === "string" ? text.toUpperCase() : text;
    return original(upper as string, options);
  }) as PDFPage["drawText"];

  target[PATCHED] = true;
  return page;
}
