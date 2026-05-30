/*
 * Tujuan: Seed data demo OFF Program Control lintas semua divisi + simulasi workflow penuh.
 * Caller: node scripts/seed-off-demo.mjs (server dev harus jalan di http://localhost:3000).
 * Dependensi: Better Auth (login admin), API OFF Program Control, fetch global Node 18+.
 * Main Functions: login, createBatch, drive workflow (submit/sm/claim/om/finance/final), discount.
 * Side Effects: Menulis batch, item, pembayaran, audit log, dan pengajuan diskon ke SQLite runtime.
 *
 * Catatan: idempotency dijaga via gelombang unik berbasis timestamp agar tidak bentrok noPengajuan.
 */

const BASE = process.env.SEED_BASE_URL || "http://localhost:3000";

const ADMIN = { email: "admin@admin.com", password: "Admin#2026" };
// Supervisor untuk membuat pengajuan diskon (admin read-only di modul diskon).
const SPV = { email: "spv.demo@spv.com", password: "Spv#2026", name: "Supervisor Demo" };

// ---- HTTP helpers dengan cookie jar per-aktor ----
function makeJar() {
  return { cookie: "" };
}
function mergeCookies(jar, res) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  if (!setCookies.length) return;
  const pairs = new Map();
  for (const part of jar.cookie.split(";").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf("=");
    if (idx > 0) pairs.set(part.slice(0, idx), part.slice(idx + 1));
  }
  for (const sc of setCookies) {
    const first = sc.split(";")[0];
    const idx = first.indexOf("=");
    if (idx > 0) pairs.set(first.slice(0, idx), first.slice(idx + 1));
  }
  jar.cookie = Array.from(pairs.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function req(jar, method, path, { json, form } = {}) {
  // Better Auth menolak request tanpa Origin (CSRF guard). Kirim Origin = BASE
  // yang sudah masuk trustedOrigins (localhost).
  const headers = { origin: BASE };
  if (jar.cookie) headers.cookie = jar.cookie;
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    body = form;
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  mergeCookies(jar, res);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, ok: res.ok, data };
}

const results = [];
function record(stage, ok, detail) {
  results.push({ stage, ok, detail });
  const tag = ok ? "OK " : "ERR";
  console.log(`[${tag}] ${stage}${detail ? " :: " + detail : ""}`);
}

async function login(jar, creds, label) {
  const r = await req(jar, "POST", "/api/auth/sign-in/email", {
    json: { email: creds.email, password: creds.password },
  });
  record(`login ${label}`, r.ok && Boolean(r.data?.user), r.ok ? r.data?.user?.role : JSON.stringify(r.data));
  return r.ok;
}

// ---- Data builders ----
const PRINCIPLES = [
  { name: "RECKITT BENCKISER, PT", code: "RB" },
  { name: "FKS FOOD SEJAHTERA, PT", code: "FKS" },
  { name: "FONTERRA BRANDS INDONESIA, PT", code: "FON" },
  { name: "MARKETAMA INDAH, PT", code: "MI" },
  { name: "HEINZ ABC INDONESIA, PT", code: "HEINZ" },
  { name: "KINO INDONESIA. TBK, PT", code: "KINO" },
];

const STORES = ["Toko Makmur", "CV Prima", "UD Maju", "Toko Berkah", "Grosir Sentosa", "Minimart Jaya"];
const GOODS = ["Dettol", "Harpic", "Vanish", "ABC Kecap", "Kino Sachet", "Vape"];
// Sengaja sertakan typo/legacy untuk menguji normalisasi tipe.
const TYPES = ["Display", "Visibilty", "Promo On Store", "Event", "Sampling", "VISIBILITY", "OFF Display"];

let gelombangSeq = Number(String(Date.now()).slice(-5)); // basis unik agar noPengajuan tidak bentrok

function buildItems(count, base) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const nominal = 1_500_000 + ((base + i) % 6) * 750_000;
    items.push({
      noSurat: `SP/OFF/${base}${i}`,
      namaProgram: `Program ${GOODS[(base + i) % GOODS.length]} ${i + 1}`,
      periodeAwal: "2026-05-01",
      periodeAkhir: "2026-05-31",
      toko: STORES[(base + i) % STORES.length],
      barang: GOODS[(base + i) % GOODS.length],
      nominal,
      caraBayar: i % 2 === 0 ? "Tunai" : "Transfer",
      type: TYPES[(base + i) % TYPES.length],
      originalType: TYPES[(base + i) % TYPES.length],
      pphExempt: i % 3 === 0,
      deadline: "2026-06-10",
      kwt: true, skp: i % 2 === 0, fp: true, pc: false, foto: true, rekap: i % 2 === 1,
      others: false, othersText: "",
    });
  }
  return items;
}

async function createBatch(jar, label, itemCount) {
  const principle = PRINCIPLES[gelombangSeq % PRINCIPLES.length];
  const gelombang = String(gelombangSeq).padStart(3, "0");
  gelombangSeq += 1;
  const items = buildItems(itemCount, gelombangSeq);
  const total = items.reduce((s, it) => s + it.nominal, 0);
  const r = await req(jar, "POST", "/api/off-program-control/batches", {
    json: {
      supervisorName: "Supervisor Area Demo",
      gelombang,
      principleCode: principle.code,
      principleName: principle.name,
      bulan: "05",
      tahun: "2026",
      items,
    },
  });
  if (!r.ok || !r.data?.batchId) {
    record(`create ${label}`, false, JSON.stringify(r.data));
    return null;
  }
  record(`create ${label}`, true, `${r.data.noPengajuan} total=${total}`);
  return { id: r.data.batchId, noPengajuan: r.data.noPengajuan, total };
}

async function submit(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/submit`);
  record(`submit ${label}`, r.ok, r.ok ? "Submitted to SM + PDF" : JSON.stringify(r.data));
  return r.ok;
}
async function smApprove(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/sm-approve`, { json: { note: "Disetujui SM (seed)" } });
  record(`sm-approve ${label}`, r.ok, r.ok ? "" : JSON.stringify(r.data));
  return r.ok;
}
async function smReturn(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/sm-return`, { json: { note: "Revisi nominal & dokumen (seed)" } });
  record(`sm-return ${label}`, r.ok, r.ok ? "" : JSON.stringify(r.data));
  return r.ok;
}
async function claimApprove(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/claim-review`, {
    json: { action: "approve", claimSubmittedDate: "2026-05-20", claimDeadline: "2026-06-20", completenessStatus: "Aman", note: "Kelengkapan aman (seed)" },
  });
  record(`claim-approve ${label}`, r.ok, r.ok ? "" : JSON.stringify(r.data));
  return r.ok;
}
async function claimReturn(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/claim-review`, {
    json: { action: "return", note: "Dokumen kurang lengkap (seed)" },
  });
  record(`claim-return ${label}`, r.ok, r.ok ? "" : JSON.stringify(r.data));
  return r.ok;
}
async function omApprove(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/om-decision`, { json: { action: "approve", note: "OM setuju (seed)" } });
  record(`om-approve ${label}`, r.ok, r.ok ? "" : JSON.stringify(r.data));
  return r.ok;
}
async function omCancel(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/om-decision`, { json: { action: "cancel", note: "Dibatalkan OM (seed)" } });
  record(`om-cancel ${label}`, r.ok, r.ok ? "" : JSON.stringify(r.data));
  return r.ok;
}
async function financePay(jar, b, label, amount, method = "Tunai") {
  // Tunai: tanpa bukti (revisi B). Transfer butuh bukti -> pakai Tunai untuk seed.
  const form = new FormData();
  form.append("paymentDate", "2026-05-25");
  form.append("paidAmount", String(amount));
  form.append("paymentMethod", method);
  form.append("senderBank", method === "Transfer" ? "BCA" : "");
  form.append("note", `Pembayaran ${method} (seed)`);
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/finance-payment`, { form });
  record(`finance-pay ${label}`, r.ok, r.ok ? `${method} ${amount}` : JSON.stringify(r.data));
  return r.ok;
}
async function getDetail(jar, b) {
  const r = await req(jar, "GET", `/api/off-program-control/batches/${b.id}`);
  return r.ok ? r.data : null;
}
async function finalComplete(jar, b, label) {
  const detail = await getDetail(jar, b);
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const claimRefs = items.map((it, idx) => ({
    itemId: it.id,
    noSurat: it.noSurat,
    noClaim: `CLM/${b.noPengajuan.replace(/[^\dA-Za-z]/g, "")}/${idx + 1}`,
    finalKwt: true, finalSkp: false, finalFp: true, finalPc: false,
    finalFoto: true, finalRekap: false, finalOthers: false,
    finalOthersText: "", finalCompletenessNote: "Lengkap (seed)",
  }));
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/final-claim`, {
    json: { action: "complete", note: "Verifikasi final selesai (seed)", claimRefs },
  });
  record(`final-complete ${label}`, r.ok, r.ok ? "Completed" : JSON.stringify(r.data));
  return r.ok;
}
async function finalRemind(jar, b, label) {
  const r = await req(jar, "POST", `/api/off-program-control/batches/${b.id}/final-claim`, {
    json: { action: "remind_incomplete_documents", note: "Foto & rekap belum lengkap (seed)" },
  });
  record(`final-remind ${label}`, r.ok, r.ok ? "Incomplete Documents" : JSON.stringify(r.data));
  return r.ok;
}

async function ensureSupervisor(adminJar) {
  // Buat akun supervisor demo via admin plugin (untuk modul diskon).
  const r = await req(adminJar, "POST", "/api/auth/admin/create-user", {
    json: { email: SPV.email, password: SPV.password, name: SPV.name, role: "staff" },
  });
  if (r.ok) { record("create supervisor user", true, SPV.email); return true; }
  // Mungkin sudah ada dari run sebelumnya.
  const msg = JSON.stringify(r.data);
  const alreadyExists = msg.toLowerCase().includes("exist") || r.status === 422 || r.status === 400;
  record("create supervisor user", alreadyExists, alreadyExists ? "sudah ada / lanjut" : msg);
  return alreadyExists;
}

async function seedDiscounts(spvJar) {
  const samples = [
    { toko: "Toko Makmur", principleName: "RECKITT BENCKISER, PT", principleCode: "RB", program: "Diskon Display Akhir Bulan", nominal: 2_500_000, alasan: "Kompensasi display premium", tanggal: "2026-05-12", catatan: "Menunggu konfirmasi principle" },
    { toko: "CV Prima", principleName: "HEINZ ABC INDONESIA, PT", principleCode: "HEINZ", program: "Promo Bundling", nominal: 1_750_000, alasan: "Dorong sell-out slow moving", tanggal: "2026-05-15", catatan: "" },
    { toko: "Grosir Sentosa", principleName: "KINO INDONESIA. TBK, PT", principleCode: "KINO", program: "Diskon Volume", nominal: 4_200_000, alasan: "Pembelian volume besar", tanggal: "2026-05-18", catatan: "Perlu approval atasan nanti" },
    { toko: "UD Maju", principleName: "MARKETAMA INDAH, PT", principleCode: "MI", program: "Cashback Display", nominal: 900_000, alasan: "Refresh planogram", tanggal: "2026-05-21", catatan: "" },
  ];
  for (const [i, s] of samples.entries()) {
    const form = new FormData();
    Object.entries(s).forEach(([k, v]) => form.append(k, String(v)));
    const r = await req(spvJar, "POST", "/api/off-program-control/discount", { form });
    record(`discount #${i + 1}`, r.ok, r.ok ? s.toko : JSON.stringify(r.data));
  }
}

async function main() {
  const adminJar = makeJar();
  if (!(await login(adminJar, ADMIN, "admin"))) {
    console.error("FATAL: gagal login admin. Pastikan server dev jalan & akun admin ada.");
    process.exit(1);
  }

  // ---- Drive batches lintas status (admin punya semua aksi) ----
  // 2 Draft
  await createBatch(adminJar, "draft-1", 3);
  await createBatch(adminJar, "draft-2", 2);

  // Submitted to SM (antrean SM)
  for (const n of ["sm-wait-1", "sm-wait-2"]) {
    const b = await createBatch(adminJar, n, 3);
    if (b) await submit(adminJar, b, n);
  }

  // Returned by SM
  {
    const b = await createBatch(adminJar, "sm-returned", 2);
    if (b && await submit(adminJar, b, "sm-returned")) await smReturn(adminJar, b, "sm-returned");
  }

  // Approved by SM (antrean Claim)
  for (const n of ["claim-wait-1", "claim-wait-2"]) {
    const b = await createBatch(adminJar, n, 3);
    if (b && await submit(adminJar, b, n)) await smApprove(adminJar, b, n);
  }

  // Returned by Claim
  {
    const b = await createBatch(adminJar, "claim-returned", 2);
    if (b && await submit(adminJar, b, "claim-returned") && await smApprove(adminJar, b, "claim-returned"))
      await claimReturn(adminJar, b, "claim-returned");
  }

  // Waiting OM (Claim approved)
  for (const n of ["om-wait-1", "om-wait-2"]) {
    const b = await createBatch(adminJar, n, 3);
    if (b && await submit(adminJar, b, n) && await smApprove(adminJar, b, n)) await claimApprove(adminJar, b, n);
  }

  // Cancelled by OM
  {
    const b = await createBatch(adminJar, "om-cancelled", 2);
    if (b && await submit(adminJar, b, "om-cancelled") && await smApprove(adminJar, b, "om-cancelled") && await claimApprove(adminJar, b, "om-cancelled"))
      await omCancel(adminJar, b, "om-cancelled");
  }

  // Finance Waiting Payment (OM approved)
  for (const n of ["finance-wait-1", "finance-wait-2"]) {
    const b = await createBatch(adminJar, n, 3);
    if (b && await submit(adminJar, b, n) && await smApprove(adminJar, b, n) && await claimApprove(adminJar, b, n))
      await omApprove(adminJar, b, n);
  }

  // Partial Paid
  {
    const b = await createBatch(adminJar, "partial-paid", 3);
    if (b && await submit(adminJar, b, "partial-paid") && await smApprove(adminJar, b, "partial-paid") && await claimApprove(adminJar, b, "partial-paid") && await omApprove(adminJar, b, "partial-paid"))
      await financePay(adminJar, b, "partial-paid", Math.floor(b.total / 2), "Tunai");
  }

  // Paid -> Waiting Final Claim
  {
    const b = await createBatch(adminJar, "final-wait", 3);
    if (b && await submit(adminJar, b, "final-wait") && await smApprove(adminJar, b, "final-wait") && await claimApprove(adminJar, b, "final-wait") && await omApprove(adminJar, b, "final-wait"))
      await financePay(adminJar, b, "final-wait", b.total, "Tunai");
  }

  // Incomplete Documents (final remind)
  {
    const b = await createBatch(adminJar, "incomplete-docs", 3);
    if (b && await submit(adminJar, b, "incomplete-docs") && await smApprove(adminJar, b, "incomplete-docs") && await claimApprove(adminJar, b, "incomplete-docs") && await omApprove(adminJar, b, "incomplete-docs") && await financePay(adminJar, b, "incomplete-docs", b.total, "Tunai"))
      await finalRemind(adminJar, b, "incomplete-docs");
  }

  // Completed (full chain)
  for (const n of ["completed-1", "completed-2"]) {
    const b = await createBatch(adminJar, n, 3);
    if (b && await submit(adminJar, b, n) && await smApprove(adminJar, b, n) && await claimApprove(adminJar, b, n) && await omApprove(adminJar, b, n) && await financePay(adminJar, b, n, b.total, "Tunai"))
      await finalComplete(adminJar, b, n);
  }

  // ---- Diskon SPV (butuh role supervisor) ----
  await ensureSupervisor(adminJar);
  const spvJar = makeJar();
  if (await login(spvJar, SPV, "supervisor")) {
    await seedDiscounts(spvJar);
  } else {
    record("seed discounts", false, "tidak bisa login supervisor; lewati diskon");
  }

  // ---- Verifikasi: hitung status ----
  const list = await req(adminJar, "GET", "/api/off-program-control/batches");
  const batches = Array.isArray(list.data?.batches) ? list.data.batches : [];
  const byStatus = {};
  for (const b of batches) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
  console.log("\n==== RINGKASAN STATUS BATCH ====");
  console.log("Total batch:", batches.length);
  console.log(JSON.stringify(byStatus, null, 2));

  const audit = await req(adminJar, "GET", "/api/off-program-control/audit");
  console.log("Audit log entries:", Array.isArray(audit.data?.audit) ? audit.data.audit.length : "n/a");
  const disc = await req(spvJar.cookie ? spvJar : adminJar, "GET", "/api/off-program-control/discount");
  console.log("Discount submissions:", Array.isArray(disc.data?.submissions) ? disc.data.submissions.length : JSON.stringify(disc.data));

  const errs = results.filter((r) => !r.ok);
  console.log("\n==== HASIL SEED ====");
  console.log("Langkah sukses:", results.filter((r) => r.ok).length, "/ total:", results.length);
  if (errs.length) {
    console.log("Langkah gagal:");
    for (const e of errs) console.log(" -", e.stage, "::", e.detail);
  } else {
    console.log("Semua langkah sukses.");
  }
}

main().catch((e) => {
  console.error("SEED FATAL:", e);
  process.exit(1);
});
