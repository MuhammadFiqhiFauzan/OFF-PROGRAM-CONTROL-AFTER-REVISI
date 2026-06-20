/**
 * Seed script: isi DB dengan demo data Insentif Sales dari mock constants.
 * Jalankan lokal:    node scripts/seed-insentif-sales.mjs
 * Jalankan di VPS:   docker exec <frontend-container> node scripts/seed-insentif-sales.mjs
 * Akan upsert: sales_targets, sales_daily_progress, incentive_tiers (Juni 2026).
 *
 * Pakai @libsql/client (sama dengan init-db.mjs) supaya jalan di container
 * production yang node_modules-nya standalone bundle (tanpa better-sqlite3).
 */

import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env dari cwd supaya DATABASE_URL lokal kepakai (selaras dengan init-db.mjs).
function loadEnvFile() {
    const envPath = resolve(process.cwd(), ".env");
    if (!existsSync(envPath)) return;
    for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
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
loadEnvFile();

// Default ke repo-root sqlite.db saat dev; di container DATABASE_URL=file:/app/data/sqlite.db.
const databaseUrl = process.env.DATABASE_URL || `file:${resolve(__dirname, "../sqlite.db")}`;
const db = createClient({ url: databaseUrl });

const PERIOD_MONTH = 6;
const PERIOD_YEAR = 2026;
const NOW = Math.floor(Date.now() / 1000);

const SALESMEN = [
    { code: "SLS-001", name: "Andi Pratama",   principle: "NESTLE",   branch: "BANDUNG",  channel: "TT", spv: "Budi Santoso", sm: "Hendra Wijaya", targetValue: 250_000_000, targetEc: 320, targetAo: 180, targetIa: 540, realValue: 168_500_000, realEc: 198, realAo: 142, realIa: 421, splmValue: 142_300_000 },
    { code: "SLS-002", name: "Siti Rahmawati", principle: "NESTLE",   branch: "BANDUNG",  channel: "MT", spv: "Budi Santoso", sm: "Hendra Wijaya", targetValue: 210_000_000, targetEc: 280, targetAo: 160, targetIa: 480, realValue: 205_900_000, realEc: 271, realAo: 158, realIa: 502, splmValue: 188_400_000 },
    { code: "SLS-003", name: "Rudi Hartono",   principle: "UNILEVER", branch: "CIMAHI",   channel: "TT", spv: "Dewi Lestari", sm: "Hendra Wijaya", targetValue: 300_000_000, targetEc: 360, targetAo: 200, targetIa: 600, realValue: 132_700_000, realEc: 158, realAo: 121, realIa: 318, splmValue: 151_900_000 },
    { code: "SLS-004", name: "Maya Anggraini", principle: "UNILEVER", branch: "CIMAHI",   channel: "MT", spv: "Dewi Lestari", sm: "Hendra Wijaya", targetValue: 180_000_000, targetEc: 240, targetAo: 140, targetIa: 420, realValue: 161_400_000, realEc: 219, realAo: 133, realIa: 408, splmValue: 144_600_000 },
    { code: "SLS-005", name: "Fajar Nugroho",  principle: "INDOFOOD", branch: "SUMEDANG", channel: "TT", spv: "Eko Saputra",  sm: "Hendra Wijaya", targetValue: 220_000_000, targetEc: 300, targetAo: 170, targetIa: 510, realValue: 142_800_000, realEc: 174, realAo: 139, realIa: 372, splmValue: 138_100_000 },
    { code: "SLS-006", name: "Lina Marlina",   principle: "INDOFOOD", branch: "SUMEDANG", channel: "MT", spv: "Eko Saputra",  sm: "Hendra Wijaya", targetValue: 195_000_000, targetEc: 260, targetAo: 150, targetIa: 450, realValue: 196_200_000, realEc: 258, realAo: 151, realIa: 471, splmValue: 170_500_000 },
];

const INCENTIVE_TIERS = [
    { kpiType: "value", minPct: 80,  maxPct: 90,     amount: 250_000 },
    { kpiType: "value", minPct: 90,  maxPct: 100,    amount: 500_000 },
    { kpiType: "value", minPct: 100, maxPct: 110,    amount: 850_000 },
    { kpiType: "value", minPct: 110, maxPct: 999999, amount: 1_200_000 },
    { kpiType: "ec",    minPct: 80,  maxPct: 100,    amount: 150_000 },
    { kpiType: "ec",    minPct: 100, maxPct: 999999, amount: 350_000 },
    { kpiType: "ao",    minPct: 80,  maxPct: 100,    amount: 200_000 },
    { kpiType: "ao",    minPct: 100, maxPct: 999999, amount: 450_000 },
    { kpiType: "ia",    minPct: 80,  maxPct: 100,    amount: 175_000 },
    { kpiType: "ia",    minPct: 100, maxPct: 999999, amount: 400_000 },
];

async function upsertTarget(s) {
    const existing = await db.execute({
        sql: "SELECT id FROM sales_targets WHERE sales_code=? AND period_month=? AND period_year=?",
        args: [s.code, PERIOD_MONTH, PERIOD_YEAR],
    });

    if (existing.rows.length) {
        await db.execute({
            sql: `UPDATE sales_targets SET sales_name=?, principle=?, branch=?, channel=?,
                    spv_name=?, sm_name=?, target_value=?, target_ec=?, target_ao=?,
                    target_ia=?, splm_value=?, updated_at=? WHERE id=?`,
            args: [s.name, s.principle, s.branch, s.channel, s.spv, s.sm,
                   s.targetValue, s.targetEc, s.targetAo, s.targetIa, s.splmValue, NOW, existing.rows[0].id],
        });
        return "updated";
    }
    await db.execute({
        sql: `INSERT INTO sales_targets
                (id, sales_code, sales_name, principle, branch, channel, spv_name, sm_name,
                 period_month, period_year, target_value, target_ec, target_ao, target_ia,
                 splm_value, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [randomUUID(), s.code, s.name, s.principle, s.branch, s.channel, s.spv, s.sm,
               PERIOD_MONTH, PERIOD_YEAR, s.targetValue, s.targetEc, s.targetAo, s.targetIa,
               s.splmValue, NOW, NOW],
    });
    return "inserted";
}

async function upsertProgress(s) {
    const date = `${PERIOD_YEAR}-${String(PERIOD_MONTH).padStart(2, "0")}-16`;
    const existing = await db.execute({
        sql: "SELECT id FROM sales_daily_progress WHERE sales_code=? AND period_month=? AND period_year=? AND date=?",
        args: [s.code, PERIOD_MONTH, PERIOD_YEAR, date],
    });

    if (existing.rows.length) {
        await db.execute({
            sql: `UPDATE sales_daily_progress SET
                    achieved_value_dpp=?, achieved_ec=?, achieved_ao=?, achieved_ia=? WHERE id=?`,
            args: [s.realValue, s.realEc, s.realAo, s.realIa, existing.rows[0].id],
        });
        return "updated";
    }
    await db.execute({
        sql: `INSERT INTO sales_daily_progress
                (id, sales_code, principle, branch, date, period_month, period_year,
                 invoice_number, achieved_value_dpp, achieved_ec, achieved_ao, achieved_ia,
                 uploaded_by, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [randomUUID(), s.code, s.principle, s.branch, date,
               PERIOD_MONTH, PERIOD_YEAR, null, s.realValue, s.realEc, s.realAo, s.realIa, "seed", NOW],
    });
    return "inserted";
}

async function seedTiers() {
    await db.execute("DELETE FROM incentive_tiers WHERE principle='ALL' AND branch='ALL'");
    for (const t of INCENTIVE_TIERS) {
        await db.execute({
            sql: `INSERT INTO incentive_tiers
                    (id, principle, branch, kpi_type, min_percentage, max_percentage, incentive_amount, created_at, updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?)`,
            args: [randomUUID(), "ALL", "ALL", t.kpiType, t.minPct, t.maxPct, t.amount, NOW, NOW],
        });
    }
    return INCENTIVE_TIERS.length;
}

async function count(table) {
    const r = await db.execute(`SELECT COUNT(*) as c FROM ${table}`);
    return r.rows[0].c;
}

console.log(`\nSeeding Insentif Sales — ${PERIOD_MONTH}/${PERIOD_YEAR}\nDB: ${databaseUrl}\n`);

console.log("sales_targets:");
for (const s of SALESMEN) {
    console.log(`  ${await upsertTarget(s)}: ${s.code} ${s.name}`);
}

console.log("\nsales_daily_progress:");
for (const s of SALESMEN) {
    console.log(`  ${await upsertProgress(s)}: ${s.code} value=${s.realValue.toLocaleString("id-ID")}`);
}

console.log("\nincentive_tiers:");
console.log(`  inserted ${await seedTiers()} tiers`);

console.log(`\nDB state: targets=${await count("sales_targets")}, progress=${await count("sales_daily_progress")}, tiers=${await count("incentive_tiers")}`);
