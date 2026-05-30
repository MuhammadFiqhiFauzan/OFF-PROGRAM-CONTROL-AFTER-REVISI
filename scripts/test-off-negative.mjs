/*
 * Tujuan: Uji negatif/guard OFF Program Control (error enumeration).
 * Caller: node scripts/test-off-negative.mjs (server dev jalan).
 * Main: cek Transfer tanpa bukti, kwitansi nonaktif, transisi invalid, search typo/partial,
 *        filter periode, dan audit correction non-destruktif.
 */
const BASE = process.env.SEED_BASE_URL || "http://localhost:3000";
const jar = { cookie: "" };

function merge(res) {
  const sc = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const m = new Map();
  for (const p of jar.cookie.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = p.indexOf("="); if (i > 0) m.set(p.slice(0, i), p.slice(i + 1));
  }
  for (const s of sc) {
    const f = s.split(";")[0]; const i = f.indexOf("="); if (i > 0) m.set(f.slice(0, i), f.slice(i + 1));
  }
  jar.cookie = [...m].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function req(method, path, opt = {}) {
  const h = { origin: BASE };
  if (jar.cookie) h.cookie = jar.cookie;
  let body;
  if (opt.json) { h["content-type"] = "application/json"; body = JSON.stringify(opt.json); }
  else if (opt.form) body = opt.form;
  const r = await fetch(BASE + path, { method, headers: h, body });
  merge(r);
  const t = await r.text();
  let d; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t.slice(0, 150) }; }
  return { ok: r.ok, status: r.status, data: d };
}
let pass = 0, fail = 0;
function chk(name, cond, extra) {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "PASS" : "FAIL"} :: ${name}${extra ? " :: " + extra : ""}`);
}

(async () => {
  await req("POST", "/api/auth/sign-in/email", { json: { email: "admin@admin.com", password: "Admin#2026" } });

  const principle = { name: "URC INDONESIA, PT", code: "URC" };
  const g = String(Date.now()).slice(-5);
  const items = [{ noSurat: "SP/NEG/1", namaProgram: "Neg test", periodeAwal: "2026-05-01", periodeAkhir: "2026-05-31", toko: "Toko Neg", barang: "X", nominal: 2000000, caraBayar: "Transfer", type: "Display", originalType: "Display", deadline: "2026-06-10", kwt: true, fp: true, foto: true }];
  const cb = await req("POST", "/api/off-program-control/batches", { json: { supervisorName: "Neg", gelombang: g, principleCode: principle.code, principleName: principle.name, bulan: "05", tahun: "2026", items } });
  const id = cb.data.batchId;
  await req("POST", `/api/off-program-control/batches/${id}/submit`);
  await req("POST", `/api/off-program-control/batches/${id}/sm-approve`, { json: { note: "x" } });
  await req("POST", `/api/off-program-control/batches/${id}/claim-review`, { json: { action: "approve", claimSubmittedDate: "2026-05-20", claimDeadline: "2026-06-20", completenessStatus: "Aman", note: "x" } });
  await req("POST", `/api/off-program-control/batches/${id}/om-decision`, { json: { action: "approve", note: "x" } });

  const f = new FormData();
  f.append("paymentDate", "2026-05-25"); f.append("paidAmount", "2000000"); f.append("paymentMethod", "Transfer"); f.append("senderBank", "BCA"); f.append("note", "no proof");
  const pay = await req("POST", `/api/off-program-control/batches/${id}/finance-payment`, { form: f });
  chk("E1 Transfer tanpa bukti ditolak (400)", pay.status === 400, pay.data.error);

  const kw = await req("POST", `/api/off-program-control/batches/${id}/kwitansi`);
  chk("E2 Kwitansi nonaktif (503/KWITANSI_DISABLED)", kw.status === 503 || kw.data.code === "KWITANSI_DISABLED", kw.data.code || String(kw.status));

  const cb2 = await req("POST", "/api/off-program-control/batches", { json: { supervisorName: "Neg2", gelombang: String(Date.now()).slice(-5), principleCode: principle.code, principleName: principle.name, bulan: "05", tahun: "2026", items: [{ noSurat: "SP/NEG/2", namaProgram: "N", periodeAwal: "2026-05-01", periodeAkhir: "2026-05-31", toko: "T", barang: "X", nominal: 1000000, caraBayar: "Tunai", type: "Event", originalType: "Event", deadline: "2026-06-10", kwt: true }] } });
  const id2 = cb2.data.batchId;
  const smOnDraft = await req("POST", `/api/off-program-control/batches/${id2}/sm-approve`, { json: { note: "x" } });
  chk("E3 SM approve di Draft ditolak (409)", smOnDraft.status === 409, smOnDraft.data.error);

  const s1 = await req("GET", "/api/off-program-control/batches?search=visibilty");
  chk("E4 Search typo visibilty dapat hasil", Array.isArray(s1.data.batches) && s1.data.batches.length > 0, "count=" + (s1.data.batches || []).length);
  const s2 = await req("GET", "/api/off-program-control/batches?search=makmur");
  chk("E5 Search partial toko makmur", Array.isArray(s2.data.batches) && s2.data.batches.length > 0, "count=" + (s2.data.batches || []).length);

  const s3 = await req("GET", "/api/off-program-control/batches?periodType=bayar&month=05&year=2026");
  chk("E6 Filter periode bayar 05/2026", Array.isArray(s3.data.batches), "count=" + (s3.data.batches || []).length);

  const au = await req("GET", "/api/off-program-control/audit");
  const first = (au.data.audit || [])[0];
  if (first) {
    const before = (au.data.audit || []).length;
    const cor = await req("POST", `/api/off-program-control/audit/${first.id}/correction`, { json: { correctionReason: "uji koreksi", note: "catatan baru" } });
    const au2 = await req("GET", "/api/off-program-control/audit");
    const after = (au2.data.audit || []).length;
    chk("E7 Correction membuat log baru (count +1)", cor.ok && after === before + 1, `before=${before} after=${after}`);
  } else chk("E7 Correction test", false, "no audit row");

  // E8: correction tanpa alasan ditolak
  if (first) {
    const corBad = await req("POST", `/api/off-program-control/audit/${first.id}/correction`, { json: { note: "tanpa alasan" } });
    chk("E8 Correction tanpa alasan ditolak (400)", corBad.status === 400, corBad.data.error);
  }

  console.log(`\n==== NEGATIVE TESTS: ${pass} PASS / ${fail} FAIL ====`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
