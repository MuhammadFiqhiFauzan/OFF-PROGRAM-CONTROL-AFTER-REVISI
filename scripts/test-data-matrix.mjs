// Tujuan: Test matrix data untuk OFF Program Control + Claim Workflow.
// Mencoba berbagai skala: 1, 10, 100 item; 1, 5, 25 submission; 1, 5, 20 batch.
// Variasi: No Claim kosong, unik, duplikat (merge), campuran;
//          caraBayar Transfer/Tunai dengan no_rekening;
//          banyak workflow paralel.
// Caller: node scripts/test-data-matrix.mjs

import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

function loadEnv() {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("=");
    if (eq <= 0) continue;
    const k = l.slice(0, eq).trim();
    let v = l.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnv();
const db = createClient({ url: process.env.DATABASE_URL || "file:sqlite.db" });
const TAG = "MATRIX-TEST";
const NOW = new Date();
let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail = "") {
  if (cond) { pass++; }
  else { fail++; failures.push(`${label}${detail ? " :: " + detail : ""}`); }
}

// ---------- HELPERS ----------
async function newOffBatch(suffix, opts = {}) {
  const id = `${TAG}-OFF-${suffix}-${randomUUID().slice(0, 6)}`;
  await db.execute({
    sql: `INSERT INTO off_batch (id, no_pengajuan, gelombang, principle_code, principle_name, bulan, tahun, supervisor_name, total_nominal, status, sm_status, claim_status, om_status, finance_status, final_status, locked, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, `${TAG}-NP-${suffix}-${randomUUID().slice(0, 4)}`, "G1", "FON", "FONTERRA", "06", "2026",
      "SPV Test", opts.totalNominal ?? 0, opts.status ?? "Draft", opts.smStatus ?? "Not Started",
      opts.claimStatus ?? "Not Started", opts.omStatus ?? "Not Started", opts.financeStatus ?? "Not Started",
      opts.finalStatus ?? "Not Started", opts.locked ? 1 : 0, NOW.getTime(), NOW.getTime(),
    ],
  });
  return id;
}

async function newOffItems(batchId, count, { caraBayar = "Tunai", noRekening = null, nominalEach = 100000 } = {}) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = `${TAG}-OI-${randomUUID().slice(0, 8)}`;
    await db.execute({
      sql: `INSERT INTO off_batch_item (id, batch_id, item_no, row_no, no_surat, nama_program, periode, toko, barang, nominal, cara_bayar, no_rekening, type, original_type, normalized_type, type_is_legacy, pph_exempt, kwt, skp, fp, pc, foto, rekap, others, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, batchId, i + 1, i + 1, `SR-${id}`, `Program ${i + 1}`,
        "2026-06-01 - 2026-06-30", `Toko ${i + 1}`, "Item", nominalEach,
        caraBayar, caraBayar === "Transfer" ? (noRekening || "1234567890 BCA") : null,
        "Display", "Display", "Display", 0, 0, 0, 0, 0, 0, 0, 0, 0,
        NOW.getTime(), NOW.getTime(),
      ],
    });
    ids.push(id);
  }
  return ids;
}

async function newWorkflow(suffix, offBatchId, opts = {}) {
  const id = `${TAG}-WF-${suffix}-${randomUUID().slice(0, 6)}`;
  await db.execute({
    sql: `INSERT INTO claim_workflow (id, off_batch_id, claim_workflow_no, principle_code, principle_name, source_type, status, total_dpp, total_ppn, total_pph, total_claim, total_paid, remaining_amount, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, offBatchId, `${TAG}-CW-${suffix}-${randomUUID().slice(0, 4)}`, "FON", "FONTERRA",
      "off_program", opts.status ?? "Draft", 0, 0, 0,
      opts.totalClaim ?? 0, 0, opts.totalClaim ?? 0, "test", NOW.getTime(), NOW.getTime(),
    ],
  });
  return id;
}

async function newSubmission(workflowId, noClaim = null, totalClaim = 0) {
  const id = `${TAG}-SUB-${randomUUID().slice(0, 8)}`;
  await db.execute({
    sql: `INSERT INTO claim_submission (id, claim_workflow_id, no_claim, scope, scope_label, status, total_dpp, total_ppn, total_pph, total_claim, total_paid, remaining_amount, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, workflowId, noClaim, "per_item", `lbl-${id}`, "Draft",
      totalClaim, 0, 0, totalClaim, 0, totalClaim, NOW.getTime(), NOW.getTime(),
    ],
  });
  return id;
}

async function newWorkflowItems(workflowId, submissionId, offBatchItemIds, dppEach = 100000) {
  const ids = [];
  for (const offItemId of offBatchItemIds) {
    const id = `${TAG}-CWI-${randomUUID().slice(0, 8)}`;
    await db.execute({
      sql: `INSERT INTO claim_workflow_item (id, claim_workflow_id, claim_submission_id, off_batch_item_id, no_surat, jenis_promosi, periode, outlet, dpp, ppn_rate, ppn_amount, pph_rate, pph_amount, nilai_klaim, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, workflowId, submissionId, offItemId, `SR-${id}`, "Prog",
        "Jun 2026", "Toko", dppEach, 0, 0, 0, 0, dppEach, "active",
        NOW.getTime(), NOW.getTime(),
      ],
    });
    ids.push(id);
  }
  return ids;
}

async function cleanup() {
  const wfs = (await db.execute({ sql: `SELECT id FROM claim_workflow WHERE id LIKE '${TAG}-%'` })).rows;
  for (const r of wfs) {
    await db.execute({ sql: `DELETE FROM claim_audit_log WHERE claim_workflow_id=?`, args: [r.id] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM claim_payment WHERE claim_workflow_id=?`, args: [r.id] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM claim_workflow_item WHERE claim_workflow_id=?`, args: [r.id] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM claim_submission WHERE claim_workflow_id=?`, args: [r.id] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM claim_workflow WHERE id=?`, args: [r.id] }).catch(() => {});
  }
  const offs = (await db.execute({ sql: `SELECT id FROM off_batch WHERE id LIKE '${TAG}-%'` })).rows;
  for (const r of offs) {
    await db.execute({ sql: `DELETE FROM off_audit_log WHERE batch_id=?`, args: [r.id] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM off_payment WHERE batch_id=?`, args: [r.id] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM off_batch_item WHERE batch_id=?`, args: [r.id] }).catch(() => {});
    await db.execute({ sql: `DELETE FROM off_batch WHERE id=?`, args: [r.id] }).catch(() => {});
  }
}

// ---------- SCENARIOS ----------
async function scenarioOffItemsScale() {
  console.log("\n[OFF] Skala item per pengajuan: 1 / 10 / 100 / 500");
  for (const n of [1, 10, 100, 500]) {
    const id = await newOffBatch(`scale${n}`, { totalNominal: n * 100000 });
    await newOffItems(id, n, { caraBayar: "Tunai" });
    const cnt = (await db.execute({ sql: `SELECT COUNT(*) c FROM off_batch_item WHERE batch_id=?`, args: [id] })).rows[0].c;
    const sum = (await db.execute({ sql: `SELECT COALESCE(SUM(nominal),0) s FROM off_batch_item WHERE batch_id=?`, args: [id] })).rows[0].s;
    check(`[OFF] ${n} item — count match`, Number(cnt) === n, `got ${cnt}`);
    check(`[OFF] ${n} item — total nominal match`, Number(sum) === n * 100000, `got ${sum}`);
  }
}

async function scenarioOffManyBatches() {
  console.log("\n[OFF] Banyak pengajuan paralel: 1 / 5 / 25");
  for (const n of [1, 5, 25]) {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(await newOffBatch(`many${n}-${i}`, { totalNominal: 100000 }));
    for (const id of ids) await newOffItems(id, 3, { caraBayar: "Tunai" });
    const cnt = (await db.execute({ sql: `SELECT COUNT(*) c FROM off_batch WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids })).rows[0].c;
    check(`[OFF] ${n} batch — count match`, Number(cnt) === n, `got ${cnt}`);
    const itemCnt = (await db.execute({ sql: `SELECT COUNT(*) c FROM off_batch_item WHERE batch_id IN (${ids.map(() => "?").join(",")})`, args: ids })).rows[0].c;
    check(`[OFF] ${n} batch × 3 item — total ${n * 3} item`, Number(itemCnt) === n * 3, `got ${itemCnt}`);
  }
}

async function scenarioOffPaymentMix() {
  console.log("\n[OFF] Cara Bayar mix + No Rekening rule");
  const id = await newOffBatch("paymix");
  await newOffItems(id, 5, { caraBayar: "Transfer", noRekening: "1111-AA" });
  await newOffItems(id, 5, { caraBayar: "Tunai" });
  const allTransfer = (await db.execute({ sql: `SELECT no_rekening FROM off_batch_item WHERE batch_id=? AND cara_bayar='Transfer'`, args: [id] })).rows;
  const allTunai = (await db.execute({ sql: `SELECT no_rekening FROM off_batch_item WHERE batch_id=? AND cara_bayar='Tunai'`, args: [id] })).rows;
  check("[OFF] Transfer item punya no_rekening", allTransfer.length === 5 && allTransfer.every((r) => r.no_rekening), `${allTransfer.length} rows`);
  check("[OFF] Tunai item no_rekening NULL", allTunai.length === 5 && allTunai.every((r) => r.no_rekening === null), `${allTunai.length} rows`);
}

async function scenarioCwSubmissionScale() {
  console.log("\n[CW] Skala submission per workflow: 1 / 5 / 25 / 100");
  for (const n of [1, 5, 25, 100]) {
    const off = await newOffBatch(`cwSubScale${n}`);
    const wf = await newWorkflow(`subScale${n}`, off);
    for (let i = 0; i < n; i++) await newSubmission(wf, `NC${n}-${i.toString().padStart(3, "0")}`, 50000);
    const cnt = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_submission WHERE claim_workflow_id=?`, args: [wf] })).rows[0].c;
    check(`[CW] ${n} submission — count match`, Number(cnt) === n, `got ${cnt}`);
    const distinctNc = (await db.execute({ sql: `SELECT COUNT(DISTINCT no_claim) c FROM claim_submission WHERE claim_workflow_id=?`, args: [wf] })).rows[0].c;
    check(`[CW] ${n} submission — semua No Claim unik`, Number(distinctNc) === n, `got ${distinctNc}`);
  }
}

async function scenarioCwItemsPerSubmission() {
  console.log("\n[CW] Item per submission: 1 / 10 / 100");
  for (const n of [1, 10, 100]) {
    const off = await newOffBatch(`cwItem${n}`);
    const offItems = await newOffItems(off, n, { caraBayar: "Tunai" });
    const wf = await newWorkflow(`item${n}`, off);
    const sub = await newSubmission(wf, `NC-${n}`, n * 100000);
    await newWorkflowItems(wf, sub, offItems, 100000);
    const cnt = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_workflow_item WHERE claim_submission_id=?`, args: [sub] })).rows[0].c;
    check(`[CW] ${n} item dalam 1 submission — count match`, Number(cnt) === n, `got ${cnt}`);
    const sumDpp = (await db.execute({ sql: `SELECT COALESCE(SUM(dpp),0) s FROM claim_workflow_item WHERE claim_submission_id=?`, args: [sub] })).rows[0].s;
    check(`[CW] ${n} item — total DPP match`, Number(sumDpp) === n * 100000, `got ${sumDpp}`);
  }
}

async function scenarioCwNoClaimVariants() {
  console.log("\n[CW] Variasi No Claim: kosong / unik / duplikat / campur");
  // (a) Semua kosong
  {
    const off = await newOffBatch("ncEmpty");
    const wf = await newWorkflow("ncEmpty", off);
    for (let i = 0; i < 5; i++) await newSubmission(wf, null, 10000);
    const empty = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_submission WHERE claim_workflow_id=? AND (no_claim IS NULL OR no_claim='')`, args: [wf] })).rows[0].c;
    check("[CW] 5 submission semua No Claim kosong", Number(empty) === 5, `got ${empty}`);
  }
  // (b) Semua duplikat (skenario merge target)
  {
    const off = await newOffBatch("ncDup");
    const wf = await newWorkflow("ncDup", off);
    for (let i = 0; i < 4; i++) await newSubmission(wf, "NC-DUPLICATE", 10000);
    const distinct = (await db.execute({ sql: `SELECT COUNT(DISTINCT no_claim) c FROM claim_submission WHERE claim_workflow_id=?`, args: [wf] })).rows[0].c;
    check("[CW] 4 submission satu No Claim sama (kandidat merge)", Number(distinct) === 1, `got ${distinct}`);
  }
  // (c) Campuran
  {
    const off = await newOffBatch("ncMix");
    const wf = await newWorkflow("ncMix", off);
    await newSubmission(wf, "NC-A", 10000);
    await newSubmission(wf, "NC-B", 10000);
    await newSubmission(wf, null, 10000);
    await newSubmission(wf, "NC-A", 10000);
    const filled = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_submission WHERE claim_workflow_id=? AND no_claim IS NOT NULL`, args: [wf] })).rows[0].c;
    const distinct = (await db.execute({ sql: `SELECT COUNT(DISTINCT no_claim) c FROM claim_submission WHERE claim_workflow_id=? AND no_claim IS NOT NULL`, args: [wf] })).rows[0].c;
    check("[CW] mix — 3 submission terisi No Claim", Number(filled) === 3, `got ${filled}`);
    check("[CW] mix — 2 No Claim distinct (NC-A, NC-B)", Number(distinct) === 2, `got ${distinct}`);
  }
}

async function scenarioCwManyWorkflowsParallel() {
  console.log("\n[CW] Banyak workflow paralel: 10 workflow × 5 submission × 3 item");
  const wfIds = [];
  for (let i = 0; i < 10; i++) {
    const off = await newOffBatch(`par${i}`);
    const offItems = await newOffItems(off, 3);
    const wf = await newWorkflow(`par${i}`, off, { totalClaim: 300000 });
    wfIds.push(wf);
    for (let s = 0; s < 5; s++) {
      const sub = await newSubmission(wf, `NC-P${i}-S${s}`, 60000);
      await newWorkflowItems(wf, sub, offItems.slice(0, 1), 100000);
    }
  }
  const totalSubs = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_submission WHERE claim_workflow_id IN (${wfIds.map(() => "?").join(",")})`, args: wfIds })).rows[0].c;
  check("[CW] 10 wf × 5 submission = 50", Number(totalSubs) === 50, `got ${totalSubs}`);
  const totalItems = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_workflow_item WHERE claim_workflow_id IN (${wfIds.map(() => "?").join(",")})`, args: wfIds })).rows[0].c;
  check("[CW] 10 wf × 5 submission × 1 item = 50 wf item", Number(totalItems) === 50, `got ${totalItems}`);
}

async function scenarioCwAggregateConsistency() {
  console.log("\n[CW] Konsistensi agregat workflow ↔ submission ↔ item");
  const off = await newOffBatch("agg");
  const offItems = await newOffItems(off, 6);
  const wf = await newWorkflow("agg", off, { totalClaim: 600000 });
  const subA = await newSubmission(wf, "NC-A", 300000);
  const subB = await newSubmission(wf, "NC-B", 300000);
  await newWorkflowItems(wf, subA, offItems.slice(0, 3));
  await newWorkflowItems(wf, subB, offItems.slice(3, 6));
  const sumPerSub = (await db.execute({ sql: `SELECT cs.id, COUNT(cwi.id) c FROM claim_submission cs LEFT JOIN claim_workflow_item cwi ON cwi.claim_submission_id=cs.id WHERE cs.claim_workflow_id=? GROUP BY cs.id`, args: [wf] })).rows;
  check("[CW] tiap submission punya 3 item", sumPerSub.length === 2 && sumPerSub.every((r) => Number(r.c) === 3), JSON.stringify(sumPerSub.map((r) => r.c)));
  const totalItems = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_workflow_item WHERE claim_workflow_id=?`, args: [wf] })).rows[0].c;
  check("[CW] total item workflow = 6", Number(totalItems) === 6, `got ${totalItems}`);
  const orphan = (await db.execute({ sql: `SELECT COUNT(*) c FROM claim_workflow_item cwi WHERE cwi.claim_workflow_id=? AND cwi.claim_submission_id NOT IN (SELECT id FROM claim_submission WHERE claim_workflow_id=?)`, args: [wf, wf] })).rows[0].c;
  check("[CW] tidak ada item orphan (submission_id valid)", Number(orphan) === 0, `got ${orphan}`);
}

async function scenarioOffSchemaIntegrity() {
  console.log("\n[INT] Integritas skema");
  const r = await db.execute({ sql: `PRAGMA table_info('off_batch_item')` });
  const cols = r.rows.map((x) => x.name);
  check("[INT] kolom no_rekening ada di off_batch_item", cols.includes("no_rekening"));
  check("[INT] kolom cara_bayar ada di off_batch_item", cols.includes("cara_bayar"));
  const r2 = await db.execute({ sql: `PRAGMA table_info('claim_submission')` });
  const cols2 = r2.rows.map((x) => x.name);
  check("[INT] kolom no_claim ada di claim_submission", cols2.includes("no_claim"));
  check("[INT] kolom claim_workflow_id ada di claim_submission", cols2.includes("claim_workflow_id"));
}

// ---------- MAIN ----------
async function main() {
  const t0 = Date.now();
  console.log("=== DATA INPUT MATRIX TEST ===");
  await cleanup();
  try {
    await scenarioOffSchemaIntegrity();
    await scenarioOffItemsScale();
    await scenarioOffManyBatches();
    await scenarioOffPaymentMix();
    await scenarioCwSubmissionScale();
    await scenarioCwItemsPerSubmission();
    await scenarioCwNoClaimVariants();
    await scenarioCwManyWorkflowsParallel();
    await scenarioCwAggregateConsistency();
  } finally {
    await cleanup();
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n=== SUMMARY ===");
  console.log(`Total: ${pass + fail}  PASS: ${pass}  FAIL: ${fail}  duration: ${dt}s`);
  if (failures.length) {
    console.log("\nFAILURES:");
    failures.forEach((f) => console.log("  - " + f));
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
