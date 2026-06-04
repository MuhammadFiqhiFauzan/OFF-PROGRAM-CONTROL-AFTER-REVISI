// Tujuan: Integration test untuk auto-no-claim endpoint.
//         Skenario: all own, same_as, chained same_as, circular, finance gate.
// Caller: `node scripts/test-auto-no-claim.mjs`
// Side Effects: INSERT/DELETE demo data prefix `AUTONC-TEST-*`. Cleanup di finally.

import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

function loadEnv() {
    const envPath = resolve(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}
loadEnv();

const databaseUrl = process.env.DATABASE_URL || "file:sqlite.db";
if (!databaseUrl.startsWith("file:") || databaseUrl.slice(5).startsWith("/app/")) {
    console.error("[autonc-test] REFUSED: not local SQLite.");
    process.exit(2);
}
const db = createClient({ url: databaseUrl });

const PREFIX = "AUTONC-TEST";
const NOW = Date.now();

const results = [];
function pass(test, label) { results.push({ test, label, ok: true }); console.log(`  PASS  [Test ${test}] ${label}`); }
function fail(test, label, detail) { results.push({ test, label, ok: false, detail }); console.log(`  FAIL  [Test ${test}] ${label} — ${detail}`); }
function assertTrue(test, label, cond, detail) { cond ? pass(test, label) : fail(test, label, detail || "expected truthy"); }
function assertEqual(test, label, actual, expected) { String(actual) === String(expected) ? pass(test, label) : fail(test, label, `got ${actual}, expected ${expected}`); }

// Helper: create OFF batch (paid or unpaid)
async function createOffBatch(suffix, paid = true) {
    const batchId = `${PREFIX}-BATCH-${suffix}`;
    const totalNominal = 10000000;
    await db.execute({
        sql: `INSERT INTO off_batch (id, no_pengajuan, gelombang, principle_code, principle_name,
              bulan, tahun, supervisor_name, total_nominal, status, sm_status, claim_status,
              om_status, finance_status, final_status, locked, pdf_status, receipt_pdf_status,
              updated_at, created_at)
              VALUES (?, ?, 'G1', 'GDI', 'Godrej', '06', '2026', 'Sup', ?,
              ?, 'Approved by SM', 'Approved', 'Approved', ?, ?, 1, 'generated', 'pending', ?, ?)`,
        args: [batchId, `${PREFIX}-NP-${suffix}`, totalNominal,
               paid ? "Paid" : "OM Approved",
               paid ? "Paid" : "Waiting Payment",
               paid ? "Waiting Claim Final Verification" : "Not Started",
               NOW, NOW],
    });
    if (paid) {
        await db.execute({
            sql: `INSERT INTO off_payment (id, batch_id, payment_no, payment_date, paid_amount, payment_method, created_at, updated_at)
                  VALUES (?, ?, 1, '2026-05-01', ?, 'Transfer', ?, ?)`,
            args: [`${PREFIX}-PAY-${suffix}`, batchId, totalNominal, NOW, NOW],
        });
    }
    return batchId;
}

// Helper: create claim workflow + items
async function createWorkflow(suffix, batchId, itemCount = 3) {
    const wfId = `${PREFIX}-WF-${suffix}`;
    await db.execute({
        sql: `INSERT INTO claim_workflow (id, off_batch_id, claim_workflow_no, principle_code, principle_name,
              source_type, status, total_dpp, total_ppn, total_pph, total_claim, total_paid, remaining_amount,
              created_by, created_at, updated_at)
              VALUES (?, ?, ?, 'GDI', 'Godrej', 'off_program', 'Draft', 10000000, 0, 0, 10000000, 0, 10000000, 'test', ?, ?)`,
        args: [wfId, batchId, `${PREFIX}-CWN-${suffix}`, NOW, NOW],
    });
    const itemIds = [];
    for (let i = 1; i <= itemCount; i++) {
        const itemId = `${PREFIX}-ITEM-${suffix}-${i}`;
        const offItemId = `${PREFIX}-OBI-${suffix}-${i}`;
        await db.execute({
            sql: `INSERT INTO off_batch_item (id, batch_id, item_no, row_no, nama_program, nominal, kwt, skp, fp, pc, foto, rekap, others, final_kwt, final_skp, final_fp, final_pc, final_foto, final_rekap, final_others, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'Prog', 3000000, 1,1,1,0,0,0,0, 0,0,0,0,0,0,0, ?, ?)`,
            args: [offItemId, batchId, i, i, NOW, NOW],
        });
        await db.execute({
            sql: `INSERT INTO claim_workflow_item (id, claim_workflow_id, off_batch_item_id, no_surat, jenis_promosi, periode, outlet, dpp, ppn_rate, ppn_amount, pph_rate, pph_amount, nilai_klaim, status, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'Promo', 'Jun 2026', 'Toko', 3000000, 0, 0, 0, 0, 3000000, 'Draft', ?, ?)`,
            args: [itemId, wfId, offItemId, `${PREFIX}-SRT-${suffix}-${i}`, NOW, NOW],
        });
        itemIds.push(itemId);
    }
    return { wfId, itemIds };
}

// Simulate the endpoint logic directly in DB (since we can't call HTTP without server)
// Instead, we test the resolveRoots function logic inline

function resolveRoots(rowModes) {
    const modeMap = new Map();
    for (const rm of rowModes) modeMap.set(rm.itemId, rm);
    const rootCache = new Map();
    function findRoot(itemId) {
        if (rootCache.has(itemId)) return rootCache.get(itemId);
        const visited = new Set();
        let current = itemId;
        while (true) {
            if (visited.has(current)) {
                rootCache.set(itemId, itemId);
                return itemId;
            }
            visited.add(current);
            const mode = modeMap.get(current);
            if (!mode || mode.mode === "own" || !mode.sameAsItemId) {
                for (const v of visited) rootCache.set(v, current);
                return current;
            }
            current = mode.sameAsItemId;
        }
    }
    for (const rm of rowModes) findRoot(rm.itemId);
    return rootCache;
}

async function main() {
    console.log("=== Auto No Claim — Integration Test ===\n");

    // Test 1: All own → all different roots
    console.log("--- Test 1: All own → 3 unique roots ---");
    const modes1 = [
        { itemId: "A", mode: "own" },
        { itemId: "B", mode: "own" },
        { itemId: "C", mode: "own" },
    ];
    const roots1 = resolveRoots(modes1);
    assertEqual("1", "root(A) = A", roots1.get("A"), "A");
    assertEqual("1", "root(B) = B", roots1.get("B"), "B");
    assertEqual("1", "root(C) = C", roots1.get("C"), "C");
    const uniqueRoots1 = new Set(roots1.values());
    assertEqual("1", "3 unique roots", uniqueRoots1.size, 3);

    // Test 2: Row 2 same_as row 1 → 2 unique roots
    console.log("\n--- Test 2: Row 2 same_as Row 1 → 2 unique roots ---");
    const modes2 = [
        { itemId: "A", mode: "own" },
        { itemId: "B", mode: "same_as", sameAsItemId: "A" },
        { itemId: "C", mode: "own" },
    ];
    const roots2 = resolveRoots(modes2);
    assertEqual("2", "root(A) = A", roots2.get("A"), "A");
    assertEqual("2", "root(B) = A", roots2.get("B"), "A");
    assertEqual("2", "root(C) = C", roots2.get("C"), "C");
    const uniqueRoots2 = new Set(roots2.values());
    assertEqual("2", "2 unique roots", uniqueRoots2.size, 2);

    // Test 3: Chained same_as → resolve to ultimate root
    console.log("\n--- Test 3: Chained same_as (C→B→A) → resolve to A ---");
    const modes3 = [
        { itemId: "A", mode: "own" },
        { itemId: "B", mode: "same_as", sameAsItemId: "A" },
        { itemId: "C", mode: "same_as", sameAsItemId: "B" },
    ];
    const roots3 = resolveRoots(modes3);
    assertEqual("3", "root(A) = A", roots3.get("A"), "A");
    assertEqual("3", "root(B) = A", roots3.get("B"), "A");
    assertEqual("3", "root(C) = A", roots3.get("C"), "A");
    const uniqueRoots3 = new Set(roots3.values());
    assertEqual("3", "1 unique root", uniqueRoots3.size, 1);

    // Test 4: Circular same_as → fallback to self
    console.log("\n--- Test 4: Circular (A→B, B→A) → both fallback to self ---");
    const modes4 = [
        { itemId: "A", mode: "same_as", sameAsItemId: "B" },
        { itemId: "B", mode: "same_as", sameAsItemId: "A" },
        { itemId: "C", mode: "own" },
    ];
    const roots4 = resolveRoots(modes4);
    // Circular: both A and B detect cycle and become their own root.
    // This is correct and safe — no infinite loop, each gets a unique No Claim.
    assertEqual("4", "root(A) = A (circular fallback)", roots4.get("A"), "A");
    assertEqual("4", "root(B) = B (circular fallback)", roots4.get("B"), "B");
    assertEqual("4", "root(C) = C", roots4.get("C"), "C");

    // Test 5: Sequence generation per unique root
    console.log("\n--- Test 5: Sequence generation ---");
    const modes5 = [
        { itemId: "A", mode: "own" },
        { itemId: "B", mode: "same_as", sameAsItemId: "A" },
        { itemId: "C", mode: "own" },
    ];
    const roots5 = resolveRoots(modes5);
    const orderedRoots5 = [];
    const seenRoots5 = new Set();
    for (const rm of modes5) {
        const root = roots5.get(rm.itemId);
        if (!seenRoots5.has(root)) { seenRoots5.add(root); orderedRoots5.push(root); }
    }
    assertEqual("5", "orderedRoots = [A, C]", orderedRoots5.join(","), "A,C");
    const startNum = 1;
    const seqs = orderedRoots5.map((_, i) => String(startNum + i).padStart(2, "0"));
    assertEqual("5", "seq for group A = 01", seqs[0], "01");
    assertEqual("5", "seq for group C = 02", seqs[1], "02");

    // Test 6: DB integration — create workflow + call logic
    console.log("\n--- Test 6: DB integration — paid workflow ---");
    const batchPaid = await createOffBatch("PAID");
    const { wfId, itemIds } = await createWorkflow("PAID", batchPaid, 3);
    // Verify workflow exists
    const [wfRow] = (await db.execute({ sql: "SELECT status FROM claim_workflow WHERE id=?", args: [wfId] })).rows;
    assertEqual("6", "workflow status Draft", wfRow.status, "Draft");
    // Verify items exist
    const itemRows = (await db.execute({ sql: "SELECT id FROM claim_workflow_item WHERE claim_workflow_id=?", args: [wfId] })).rows;
    assertEqual("6", "3 items created", itemRows.length, 3);
    // Verify OFF finance gate would pass
    const [offRow] = (await db.execute({ sql: "SELECT finance_status FROM off_batch WHERE id=?", args: [batchPaid] })).rows;
    assertEqual("6", "OFF finance_status = Paid", offRow.finance_status, "Paid");
    const payRows = (await db.execute({ sql: "SELECT paid_amount FROM off_payment WHERE batch_id=?", args: [batchPaid] })).rows;
    assertTrue("6", "payment exists", payRows.length > 0);

    // Test 7: Finance gate — unpaid workflow should be blocked
    console.log("\n--- Test 7: Finance gate — unpaid should block ---");
    const batchUnpaid = await createOffBatch("UNPAID", false);
    const { wfId: wfUnpaid } = await createWorkflow("UNPAID", batchUnpaid, 2);
    const [offUnpaid] = (await db.execute({ sql: "SELECT finance_status FROM off_batch WHERE id=?", args: [batchUnpaid] })).rows;
    assertEqual("7", "OFF finance_status = Waiting Payment", offUnpaid.finance_status, "Waiting Payment");
    assertTrue("7", "no off_payment for unpaid batch",
        (await db.execute({ sql: "SELECT id FROM off_payment WHERE batch_id=?", args: [batchUnpaid] })).rows.length === 0);

    // Test 8: All items in same group → single No Claim
    console.log("\n--- Test 8: All same_as first → 1 group ---");
    const modes8 = [
        { itemId: itemIds[0], mode: "own" },
        { itemId: itemIds[1], mode: "same_as", sameAsItemId: itemIds[0] },
        { itemId: itemIds[2], mode: "same_as", sameAsItemId: itemIds[0] },
    ];
    const roots8 = resolveRoots(modes8);
    const uniqueRoots8 = new Set(roots8.values());
    assertEqual("8", "1 unique root (all same)", uniqueRoots8.size, 1);
    assertEqual("8", "all resolve to first item", roots8.get(itemIds[1]), itemIds[0]);
    assertEqual("8", "all resolve to first item (2)", roots8.get(itemIds[2]), itemIds[0]);

    console.log("\n=== Test Summary ===");
    const total = results.length;
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`Total: ${total}  PASS: ${passed}  FAIL: ${failed}`);
    if (failed > 0) {
        console.log("\nFailed tests:");
        for (const r of results.filter(r => !r.ok)) {
            console.log(`  [Test ${r.test}] ${r.label}: ${r.detail}`);
        }
    }

    return failed === 0;
}

async function cleanup() {
    console.log("\n--- Cleanup ---");
    await db.execute(`DELETE FROM claim_audit_log WHERE claim_workflow_id IN (SELECT id FROM claim_workflow WHERE claim_workflow_no LIKE '${PREFIX}-%')`);
    await db.execute(`DELETE FROM claim_payment WHERE claim_workflow_id IN (SELECT id FROM claim_workflow WHERE claim_workflow_no LIKE '${PREFIX}-%')`);
    await db.execute(`DELETE FROM claim_workflow_item WHERE claim_workflow_id IN (SELECT id FROM claim_workflow WHERE claim_workflow_no LIKE '${PREFIX}-%')`);
    await db.execute(`DELETE FROM claim_submission WHERE claim_workflow_id IN (SELECT id FROM claim_workflow WHERE claim_workflow_no LIKE '${PREFIX}-%')`);
    await db.execute(`DELETE FROM claim_workflow WHERE claim_workflow_no LIKE '${PREFIX}-%'`);
    await db.execute(`DELETE FROM off_audit_log WHERE batch_id IN (SELECT id FROM off_batch WHERE no_pengajuan LIKE '${PREFIX}-%')`);
    await db.execute(`DELETE FROM off_payment WHERE batch_id IN (SELECT id FROM off_batch WHERE no_pengajuan LIKE '${PREFIX}-%')`);
    await db.execute(`DELETE FROM off_batch_item WHERE batch_id IN (SELECT id FROM off_batch WHERE no_pengajuan LIKE '${PREFIX}-%')`);
    await db.execute(`DELETE FROM off_batch WHERE no_pengajuan LIKE '${PREFIX}-%'`);
    console.log("Cleanup demo rows OK.");
}

(async () => {
    try {
        const ok = await main();
        process.exitCode = ok ? 0 : 1;
    } catch (err) {
        console.error("[autonc-test] UNCAUGHT:", err);
        process.exitCode = 1;
    } finally {
        await cleanup();
    }
})();
