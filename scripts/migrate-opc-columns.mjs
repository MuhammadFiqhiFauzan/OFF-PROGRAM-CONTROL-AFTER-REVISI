/**
 * migrate-opc-columns.mjs
 * Menambah kolom baru OFF Program Control ke SQLite lokal secara idempotent.
 * Run: node scripts/migrate-opc-columns.mjs
 */
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../sqlite.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

console.log("DB:", DB_PATH);

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}

const additions = [
  { table: "off_batch", column: "no_rekening", ddl: "ALTER TABLE off_batch ADD COLUMN no_rekening TEXT" },
  { table: "off_batch", column: "created_by_role", ddl: "ALTER TABLE off_batch ADD COLUMN created_by_role TEXT" },
  { table: "off_batch_item", column: "no_rekening", ddl: "ALTER TABLE off_batch_item ADD COLUMN no_rekening TEXT" },
];

for (const { table, column, ddl } of additions) {
  if (hasColumn(table, column)) {
    console.log(`${table}.${column} sudah ada - lewati.`);
    continue;
  }
  db.prepare(ddl).run();
  console.log(`Menambah kolom ${table}.${column}`);
}

db.prepare(`
  UPDATE off_batch_item
     SET no_rekening = (
       SELECT off_batch.no_rekening
         FROM off_batch
        WHERE off_batch.id = off_batch_item.batch_id
     )
   WHERE (no_rekening IS NULL OR no_rekening = '')
     AND LOWER(COALESCE(cara_bayar, '')) = 'transfer'
     AND batch_id IN (
       SELECT id FROM off_batch WHERE no_rekening IS NOT NULL AND no_rekening <> ''
     )
`).run();
console.log("Backfill off_batch_item.no_rekening dari off_batch.no_rekening selesai.");

console.log("Migrasi kolom OPC selesai.");
db.close();
