/**
 * migrate-opc-columns.mjs
 * Menambah kolom baru OFF Program Control ke SQLite lokal secara IDEMPOTEN:
 *   - off_batch.no_rekening      (#8) No Rekening yang diinput SPV, hanya tampil ke Keuangan.
 *   - off_batch.created_by_role  (#1-3) Penanda asal pengajuan: "supervisor" | "claim".
 * Aman dijalankan berulang (cek dulu via PRAGMA table_info).
 * Run: node scripts/migrate-opc-columns.mjs
 */
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../sqlite.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

console.log("📦 DB:", DB_PATH);

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

const additions = [
  { table: "off_batch", column: "no_rekening", ddl: "ALTER TABLE off_batch ADD COLUMN no_rekening TEXT" },
  { table: "off_batch", column: "created_by_role", ddl: "ALTER TABLE off_batch ADD COLUMN created_by_role TEXT" },
];

for (const { table, column, ddl } of additions) {
  if (hasColumn(table, column)) {
    console.log(`✓ ${table}.${column} sudah ada — lewati.`);
    continue;
  }
  db.prepare(ddl).run();
  console.log(`＋ Menambah kolom ${table}.${column}`);
}

console.log("✅ Migrasi kolom OPC selesai.");
db.close();
