/**
 * migrate-local.mjs
 * Creates missing R7 tables in local SQLite + resets admin password.
 * Run with: node scripts/migrate-local.mjs
 */
import Database from "better-sqlite3";
import { hashPassword } from "better-auth/crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../sqlite.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF"); // off during migration

console.log("📦 DB:", DB_PATH);

// ── 1. CREATE MISSING TABLES ──────────────────────────────────────────────────

const migrations = [
  {
    name: "claim_workflow",
    sql: `CREATE TABLE IF NOT EXISTS claim_workflow (
      id TEXT PRIMARY KEY,
      off_batch_id TEXT NOT NULL UNIQUE REFERENCES off_batch(id),
      claim_workflow_no TEXT NOT NULL UNIQUE,
      principle_code TEXT NOT NULL,
      principle_name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'off_program',
      source_ref_id TEXT,
      aggregate_status TEXT,
      status TEXT NOT NULL DEFAULT 'Draft',
      total_dpp REAL NOT NULL DEFAULT 0,
      total_ppn REAL NOT NULL DEFAULT 0,
      total_pph REAL NOT NULL DEFAULT 0,
      total_claim REAL NOT NULL DEFAULT 0,
      total_paid REAL NOT NULL DEFAULT 0,
      remaining_amount REAL NOT NULL DEFAULT 0,
      submitted_to_principal_at INTEGER,
      claim_letter_pdf_path TEXT,
      claim_letter_generated_at INTEGER,
      claim_letter_generated_by TEXT,
      summary_pdf_path TEXT,
      summary_generated_at INTEGER,
      summary_generated_by TEXT,
      receipt_pdf_path TEXT,
      receipt_generated_at INTEGER,
      receipt_generated_by TEXT,
      no_claim TEXT,
      no_claim_assigned_at INTEGER,
      no_claim_assigned_by TEXT,
      closed_at INTEGER,
      closed_by TEXT,
      close_note TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  },
  {
    name: "claim_workflow_item",
    sql: `CREATE TABLE IF NOT EXISTS claim_workflow_item (
      id TEXT PRIMARY KEY,
      claim_workflow_id TEXT NOT NULL REFERENCES claim_workflow(id),
      claim_submission_id TEXT,
      off_batch_item_id TEXT REFERENCES off_batch_item(id),
      no_surat TEXT,
      jenis_promosi TEXT,
      periode TEXT,
      outlet TEXT,
      dpp REAL NOT NULL DEFAULT 0,
      ppn_rate REAL NOT NULL DEFAULT 0,
      ppn_amount REAL NOT NULL DEFAULT 0,
      pph_rate REAL NOT NULL DEFAULT 0,
      pph_amount REAL NOT NULL DEFAULT 0,
      nilai_klaim REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft',
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  },
  {
    name: "idx_claim_workflow_item_workflow_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_workflow_item_workflow_id ON claim_workflow_item(claim_workflow_id)`,
  },
  {
    name: "idx_claim_workflow_item_off_batch_item_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_workflow_item_off_batch_item_id ON claim_workflow_item(off_batch_item_id)`,
  },
  {
    name: "idx_claim_workflow_item_submission_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_workflow_item_submission_id ON claim_workflow_item(claim_submission_id)`,
  },
  {
    name: "claim_payment",
    sql: `CREATE TABLE IF NOT EXISTS claim_payment (
      id TEXT PRIMARY KEY,
      claim_workflow_id TEXT NOT NULL REFERENCES claim_workflow(id),
      claim_submission_id TEXT,
      payment_date TEXT NOT NULL,
      payment_amount REAL NOT NULL DEFAULT 0,
      payment_type TEXT,
      payment_note TEXT,
      proof_path TEXT,
      created_by TEXT,
      voided_at INTEGER,
      voided_by TEXT,
      void_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  },
  {
    name: "idx_claim_payment_workflow_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_payment_workflow_id ON claim_payment(claim_workflow_id)`,
  },
  {
    name: "idx_claim_payment_voided_at",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_payment_voided_at ON claim_payment(voided_at)`,
  },
  {
    name: "idx_claim_payment_submission_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_payment_submission_id ON claim_payment(claim_submission_id)`,
  },
  {
    name: "claim_audit_log",
    sql: `CREATE TABLE IF NOT EXISTS claim_audit_log (
      id TEXT PRIMARY KEY,
      claim_workflow_id TEXT NOT NULL REFERENCES claim_workflow(id),
      claim_submission_id TEXT,
      audit_scope TEXT,
      actor_id TEXT,
      actor_name TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      note TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )`,
  },
  {
    name: "idx_claim_audit_log_workflow_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_audit_log_workflow_id ON claim_audit_log(claim_workflow_id)`,
  },
  {
    name: "idx_claim_audit_log_created_at",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_audit_log_created_at ON claim_audit_log(created_at)`,
  },
  {
    name: "idx_claim_audit_log_submission_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_audit_log_submission_id ON claim_audit_log(claim_submission_id)`,
  },
  {
    name: "claim_submission",
    sql: `CREATE TABLE IF NOT EXISTS claim_submission (
      id TEXT PRIMARY KEY,
      claim_workflow_id TEXT NOT NULL REFERENCES claim_workflow(id),
      no_claim TEXT,
      no_claim_assigned_at INTEGER,
      no_claim_assigned_by TEXT,
      scope TEXT NOT NULL DEFAULT 'per_pengajuan',
      scope_label TEXT,
      status TEXT NOT NULL DEFAULT 'Draft',
      total_dpp REAL NOT NULL DEFAULT 0,
      total_ppn REAL NOT NULL DEFAULT 0,
      total_pph REAL NOT NULL DEFAULT 0,
      total_claim REAL NOT NULL DEFAULT 0,
      total_paid REAL NOT NULL DEFAULT 0,
      remaining_amount REAL NOT NULL DEFAULT 0,
      submitted_to_principal_at INTEGER,
      claim_letter_pdf_path TEXT,
      claim_letter_generated_at INTEGER,
      claim_letter_generated_by TEXT,
      summary_pdf_path TEXT,
      summary_generated_at INTEGER,
      summary_generated_by TEXT,
      receipt_pdf_path TEXT,
      receipt_generated_at INTEGER,
      receipt_generated_by TEXT,
      closed_at INTEGER,
      closed_by TEXT,
      close_note TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  },
  {
    name: "idx_claim_submission_workflow_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_submission_workflow_id ON claim_submission(claim_workflow_id)`,
  },
  {
    name: "idx_claim_submission_status",
    sql: `CREATE INDEX IF NOT EXISTS idx_claim_submission_status ON claim_submission(status)`,
  },
];

for (const m of migrations) {
  db.prepare(m.sql).run();
  console.log(`  ✅ ${m.name}`);
}

// ── 2. VERIFY TABLES ─────────────────────────────────────────────────────────
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r) => r.name);
console.log("\n📋 Tables:", tables.join(", "));

// ── 3. RESET ADMIN PASSWORD ───────────────────────────────────────────────────
const NEW_PASSWORD = "Admin123!";
const hashed = await hashPassword(NEW_PASSWORD);

const user = db.prepare("SELECT id, email FROM user WHERE email = ?").get("admin@local.dev");
if (!user) {
  console.error("❌ User admin@local.dev not found. Listing all users:");
  const all = db.prepare("SELECT id, email FROM user").all();
  all.forEach((u) => console.log(" -", u.email));
  process.exit(1);
}

// Better Auth stores password in the `account` table (providerId = 'credential')
const updated = db
  .prepare("UPDATE account SET password = ? WHERE userId = ? AND providerId = 'credential'")
  .run(hashed, user.id);
console.log(`\n🔑 Password reset for ${user.email} → "${NEW_PASSWORD}" (rows updated: ${updated.changes})`);

db.pragma("foreign_keys = ON");
db.close();
console.log("\n✅ Done.");
