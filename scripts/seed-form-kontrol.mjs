/**
 * Seed script: isi DB dengan demo data Form Kontrol.
 * Jalankan lokal:  node scripts/seed-form-kontrol.mjs
 * Jalankan VPS:    docker exec <frontend-container> node scripts/seed-form-kontrol.mjs
 *
 * Isi:
 *   - jks_master       : ~30 toko per salesman × 6 salesman
 *   - ao_control_daily : kunjungan Juni 2026 minggu 1-3 (mix ordered/not_order/not_visited)
 *
 * Tab Frekuensi tidak punya tabel sendiri — dihitung dari dua tabel di atas.
 * Salesmen selaras dengan seed-insentif-sales.mjs (SLS-001..SLS-006).
 */

import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const databaseUrl = process.env.DATABASE_URL || `file:${resolve(__dirname, "../sqlite.db")}`;
const db = createClient({ url: databaseUrl });
const NOW_ISO = new Date().toISOString();

// ── Salesmen — selaras dengan seed-insentif-sales.mjs ───────────────────────
const SALESMEN = [
    { code: "SLS-001", name: "Andi Pratama",   principle: "NESTLE",   branch: "BANDUNG",  channel: "TT" },
    { code: "SLS-002", name: "Siti Rahmawati", principle: "NESTLE",   branch: "BANDUNG",  channel: "MT" },
    { code: "SLS-003", name: "Rudi Hartono",   principle: "UNILEVER", branch: "CIMAHI",   channel: "TT" },
    { code: "SLS-004", name: "Maya Anggraini", principle: "UNILEVER", branch: "CIMAHI",   channel: "MT" },
    { code: "SLS-005", name: "Fajar Nugroho",  principle: "INDOFOOD", branch: "SUMEDANG", channel: "TT" },
    { code: "SLS-006", name: "Lina Marlina",   principle: "INDOFOOD", branch: "SUMEDANG", channel: "MT" },
];

const HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];
const STORE_NAMES = [
    "Toko Maju", "Warung Jaya", "Minimart Berkah", "Toko Makmur", "Warung Sejahtera",
    "Toko Barokah", "Kios Mandiri", "Toko Harapan", "Warung Rezeki", "Toko Abadi",
];
const KOTA_MAP  = { BANDUNG: "Bandung", CIMAHI: "Cimahi", SUMEDANG: "Sumedang" };
const RAYON_MAP = { BANDUNG: ["Rayon A", "Rayon B"], CIMAHI: ["Rayon C"], SUMEDANG: ["Rayon D"] };

// ── Build toko per salesman ──────────────────────────────────────────────────
// 5 toko/hari × 5 hari = 25 toko pattern "all" 4x/bulan
// + 3 toko Senin ganjil + 2 toko Senin genap (2x/bulan) → kandidat over-visit
function buildJksRows(s) {
    const rows = [];
    let idx = 1;
    for (const hari of HARI) {
        for (let i = 0; i < 5; i++, idx++) {
            rows.push({
                custCode:      `${s.code}-T${String(idx).padStart(3, "0")}`,
                custName:      `${STORE_NAMES[idx % STORE_NAMES.length]} ${idx}`,
                market:        idx % 4 === 0 ? "MT" : "TT",
                alamat:        `Jl. Demo No.${idx * 7}, ${KOTA_MAP[s.branch]}`,
                kota:          KOTA_MAP[s.branch],
                hariKunjungan: hari,
                mingguPattern: "all",
                area:          s.branch,
                rayon:         RAYON_MAP[s.branch][idx % RAYON_MAP[s.branch].length],
                visitFrequency: 4,
            });
        }
    }
    // Toko 2x/bulan — ganjil
    for (let i = 0; i < 3; i++, idx++) {
        rows.push({
            custCode: `${s.code}-T${String(idx).padStart(3, "0")}`,
            custName: `${STORE_NAMES[idx % STORE_NAMES.length]} ${idx}`,
            market: "TT", alamat: `Jl. Demo No.${idx * 7}, ${KOTA_MAP[s.branch]}`,
            kota: KOTA_MAP[s.branch], hariKunjungan: "Senin",
            mingguPattern: "ganjil", area: s.branch,
            rayon: RAYON_MAP[s.branch][0], visitFrequency: 2,
        });
    }
    // Toko 2x/bulan — genap
    for (let i = 0; i < 2; i++, idx++) {
        rows.push({
            custCode: `${s.code}-T${String(idx).padStart(3, "0")}`,
            custName: `${STORE_NAMES[idx % STORE_NAMES.length]} ${idx}`,
            market: "TT", alamat: `Jl. Demo No.${idx * 7}, ${KOTA_MAP[s.branch]}`,
            kota: KOTA_MAP[s.branch], hariKunjungan: "Senin",
            mingguPattern: "genap", area: s.branch,
            rayon: RAYON_MAP[s.branch][0], visitFrequency: 2,
        });
    }
    return rows;
}

// ── Hari kerja Juni 2026 minggu 1-3 ─────────────────────────────────────────
const JUNI_WORKDAYS = [
    { date: "2026-06-02", hari: "Senin",  parity: "genap"  },
    { date: "2026-06-03", hari: "Selasa", parity: "genap"  },
    { date: "2026-06-04", hari: "Rabu",   parity: "genap"  },
    { date: "2026-06-05", hari: "Kamis",  parity: "genap"  },
    { date: "2026-06-06", hari: "Jumat",  parity: "genap"  },
    { date: "2026-06-09", hari: "Senin",  parity: "ganjil" },
    { date: "2026-06-10", hari: "Selasa", parity: "ganjil" },
    { date: "2026-06-11", hari: "Rabu",   parity: "ganjil" },
    { date: "2026-06-12", hari: "Kamis",  parity: "ganjil" },
    { date: "2026-06-13", hari: "Jumat",  parity: "ganjil" },
    { date: "2026-06-16", hari: "Senin",  parity: "genap"  },
    { date: "2026-06-17", hari: "Selasa", parity: "genap"  },
    { date: "2026-06-18", hari: "Rabu",   parity: "genap"  },
    { date: "2026-06-19", hari: "Kamis",  parity: "genap"  },
    { date: "2026-06-20", hari: "Jumat",  parity: "genap"  },
];

const STATUSES         = ["ordered","ordered","ordered","active","not_order","not_order","not_visited"];
const NO_ORDER_REASONS = ["HRGA001", "HRGA002", "STOK001", "KOMP001", null];

async function seedJks() {
    let inserted = 0, updated = 0;
    for (const s of SALESMEN) {
        for (const t of buildJksRows(s)) {
            const ex = await db.execute({
                sql: "SELECT id FROM jks_master WHERE sales_code=? AND cust_code=? AND principle=?",
                args: [s.code, t.custCode, s.principle],
            });
            if (ex.rows.length) {
                await db.execute({
                    sql: `UPDATE jks_master SET sales_name=?, cust_name=?, market=?, alamat=?, kota=?,
                            hari_kunjungan=?, minggu_pattern=?, area=?, rayon=?, visit_frequency=?,
                            is_active=1, updated_at=? WHERE id=?`,
                    args: [s.name, t.custName, t.market, t.alamat, t.kota,
                           t.hariKunjungan, t.mingguPattern, t.area, t.rayon,
                           t.visitFrequency, NOW_ISO, ex.rows[0].id],
                });
                updated++;
            } else {
                await db.execute({
                    sql: `INSERT INTO jks_master
                            (id, sales_code, sales_name, cust_code, cust_name, market, alamat, kota,
                             hari_kunjungan, minggu_pattern, area, rayon, principle, channel,
                             visit_frequency, is_active, created_at, updated_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
                    args: [randomUUID(), s.code, s.name, t.custCode, t.custName,
                           t.market, t.alamat, t.kota, t.hariKunjungan, t.mingguPattern,
                           t.area, t.rayon, s.principle, s.channel,
                           t.visitFrequency, NOW_ISO, NOW_ISO],
                });
                inserted++;
            }
        }
    }
    return { inserted, updated };
}

async function seedAo() {
    let inserted = 0, skipped = 0;
    for (const s of SALESMEN) {
        const allToko = buildJksRows(s);
        for (let di = 0; di < JUNI_WORKDAYS.length; di++) {
            const { date, hari, parity } = JUNI_WORKDAYS[di];
            const tokoHariIni = allToko.filter(t =>
                t.hariKunjungan === hari &&
                (t.mingguPattern === "all" || t.mingguPattern === parity)
            );
            for (let i = 0; i < tokoHariIni.length; i++) {
                const t = tokoHariIni[i];
                const ex = await db.execute({
                    sql: "SELECT id FROM ao_control_daily WHERE sales_code=? AND cust_code=? AND principle=? AND date=?",
                    args: [s.code, t.custCode, s.principle, date],
                });
                if (ex.rows.length) { skipped++; continue; }

                const status = STATUSES[(di + i) % STATUSES.length];
                const reason = status === "not_order"
                    ? NO_ORDER_REASONS[i % NO_ORDER_REASONS.length]
                    : null;
                const isVisited = status !== "not_visited" ? 1 : 0;

                await db.execute({
                    sql: `INSERT INTO ao_control_daily
                            (id, sales_code, cust_code, principle, date, period_month, period_year,
                             status, is_visited, no_order_reason_code, no_order_note,
                             checkin_at, checkout_at, checkin_photo_url, checkout_photo_url,
                             auto_matched, source, created_at, updated_at)
                          VALUES (?,?,?,?,?,6,2026,?,?,?,?,?,?,null,null,0,'seed',?,?)`,
                    args: [
                        randomUUID(), s.code, t.custCode, s.principle, date,
                        status, isVisited,
                        reason, reason ? "Demo data" : null,
                        isVisited ? `${date}T08:30:00.000Z` : null,
                        (status === "ordered" || status === "active") ? `${date}T09:00:00.000Z` : null,
                        NOW_ISO, NOW_ISO,
                    ],
                });
                inserted++;
            }
        }
    }
    return { inserted, skipped };
}

async function count(table) {
    const r = await db.execute(`SELECT COUNT(*) as c FROM ${table}`);
    return r.rows[0].c;
}

console.log(`\nSeeding Form Kontrol\nDB: ${databaseUrl}\n`);

process.stdout.write("jks_master        ... ");
const jks = await seedJks();
console.log(`inserted=${jks.inserted}, updated=${jks.updated}`);

process.stdout.write("ao_control_daily  ... ");
const ao = await seedAo();
console.log(`inserted=${ao.inserted}, skipped=${ao.skipped}`);

console.log(`\nDB state: jks_master=${await count("jks_master")}, ao_control_daily=${await count("ao_control_daily")}`);
console.log("\nTab coverage:");
console.log("  JKS        — filter principle/hari/salesCode aktif");
console.log("  AO Harian  — Juni 2026 minggu 1-3, mix ordered/not_order/not_visited");
console.log("  Frekuensi  — computed dari jks+ao, Senin 2x/bln ada potensi over-visit");
