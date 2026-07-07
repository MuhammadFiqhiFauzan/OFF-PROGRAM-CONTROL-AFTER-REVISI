/**
 * migrate-laporan-harian.mjs
 * Tujuan  : Buat tabel modul Laporan Harian (report_recipient, report_run, report_run_recipient)
 *           secara additive & idempotent, lalu seed report_recipient dari mapping_laporan.csv.
 * Caller  : dijalankan manual sekali. Run: node scripts/migrate-laporan-harian.mjs
 * Depend. : better-sqlite3, sqlite.db lokal. Seed CSV opsional (env MAPPING_CSV atau path default).
 * Efek    : CREATE TABLE IF NOT EXISTS + upsert baris recipient. Tidak menghapus data lain.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../sqlite.db");
const MAPPING_CSV =
    process.env.MAPPING_CSV ||
    "C:\\Users\\Muhar\\Documents\\Laporan\\LaporanAuto\\mapping_laporan.csv";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
console.log("DB:", DB_PATH);

const statements = [
    `CREATE TABLE IF NOT EXISTS report_recipient (
       id          TEXT PRIMARY KEY,
       keyword     TEXT NOT NULL UNIQUE,
       emails      TEXT NOT NULL,
       active      INTEGER NOT NULL DEFAULT 1,
       created_at  INTEGER NOT NULL,
       updated_at  INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS report_run (
       id            TEXT PRIMARY KEY,
       report_date   TEXT NOT NULL,
       status        TEXT NOT NULL DEFAULT 'dry_run',
       file_count    INTEGER NOT NULL DEFAULT 0,
       email_count   INTEGER NOT NULL DEFAULT 0,
       sales_rows    INTEGER NOT NULL DEFAULT 0,
       progress_rows INTEGER NOT NULL DEFAULT 0,
       note          TEXT,
       uploaded_by   TEXT,
       created_at    INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_report_run_date ON report_run(report_date)`,
    `CREATE TABLE IF NOT EXISTS report_run_recipient (
       id           TEXT PRIMARY KEY,
       run_id       TEXT NOT NULL REFERENCES report_run(id),
       keyword      TEXT NOT NULL,
       email        TEXT NOT NULL,
       file_name    TEXT,
       send_status  TEXT NOT NULL DEFAULT 'pending',
       error        TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_rrr_run ON report_run_recipient(run_id)`,
    // Index penunjang ingestion batch salesDailyProgress (hindari N+1 saat dedup)
    `CREATE INDEX IF NOT EXISTS idx_sdp_period_code ON sales_daily_progress(period_month, period_year, sales_code)`,
];

const tx = db.transaction(() => {
    for (const sql of statements) db.prepare(sql).run();
});
tx();
console.log("Tabel & index Laporan Harian siap.");

// --- Seed report_recipient dari mapping_laporan.csv (opsional, idempotent upsert) ---
function parseCsv(text) {
    // parser sederhana: kolom Keyword,Email dengan Email bisa dikutip & berisi koma
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^([^,]+),\s*(?:"([^"]*)"|(.*))$/);
        if (!m) continue;
        const keyword = m[1].trim();
        const emails = (m[2] ?? m[3] ?? "").trim();
        if (keyword && emails) rows.push({ keyword, emails });
    }
    return rows;
}

if (fs.existsSync(MAPPING_CSV)) {
    const rows = parseCsv(fs.readFileSync(MAPPING_CSV, "utf8"));
    // gabung email bila keyword muncul >1 kali
    const merged = new Map();
    for (const r of rows) {
        const key = r.keyword.toUpperCase();
        const set = merged.get(key) || { keyword: r.keyword, emails: new Set() };
        r.emails.split(/[;,]/).map((e) => e.trim()).filter(Boolean).forEach((e) => set.emails.add(e));
        merged.set(key, set);
    }
    const now = Date.now();
    const upsert = db.prepare(`
      INSERT INTO report_recipient (id, keyword, emails, active, created_at, updated_at)
      VALUES (@id, @keyword, @emails, 1, @now, @now)
      ON CONFLICT(keyword) DO UPDATE SET emails = excluded.emails, updated_at = excluded.updated_at
    `);
    const seed = db.transaction((items) => {
        for (const it of items)
            upsert.run({ id: randomUUID(), keyword: it.keyword, emails: [...it.emails].join(", "), now });
    });
    seed([...merged.values()]);
    console.log(`Seed report_recipient: ${merged.size} keyword dari ${MAPPING_CSV}`);
} else {
    console.log(`(lewati seed) mapping CSV tidak ditemukan: ${MAPPING_CSV}`);
}

const cnt = db.prepare("SELECT COUNT(*) c FROM report_recipient").get();
console.log("Total report_recipient:", cnt.c);
db.close();
console.log("Selesai.");
