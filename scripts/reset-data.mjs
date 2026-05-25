// Tujuan: Reset data transaksional (OFF batch + Claim Workflow + audit log) di SQLite lokal.
// Caller: Operator dev lokal via `node scripts/reset-data.mjs`.
// Side Effects: Mengosongkan tabel data, TIDAK menghapus user/session/account.
//
// Catatan: Hanya jalankan untuk database lokal. Script akan refuse non-local DATABASE_URL.

import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const filePath = databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : "";
if (!filePath || filePath.startsWith("/app/")) {
    console.error(`[reset-data] REFUSED: DATABASE_URL terlihat non-lokal (${databaseUrl}).`);
    process.exit(2);
}

// Tabel data transaksional yang akan dikosongkan.
// Order penting karena ada foreign key (child dulu baru parent).
const tables = [
    "claim_audit_log",
    "claim_payment",
    "claim_peka_report",
    "claim_workflow_item",
    "claim_workflow",
    "off_audit_log",
    "off_notification",
    "off_payment",
    "off_batch_item",
    "off_batch",
    "idempotency_log",
];

const db = createClient({ url: databaseUrl });

async function main() {
    console.log(`Database: ${databaseUrl}`);
    console.log("");
    console.log("Tabel yang akan dikosongkan (user/session/account TIDAK dihapus):");
    for (const table of tables) console.log(`  - ${table}`);
    console.log("");

    let totalDeleted = 0;
    for (const table of tables) {
        const before = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
        const count = Number(before.rows[0]?.n || 0);
        if (count === 0) {
            console.log(`  [skip] ${table.padEnd(22)} sudah kosong`);
            continue;
        }
        await db.execute(`DELETE FROM ${table}`);
        console.log(`  [done] ${table.padEnd(22)} ${count} baris dihapus`);
        totalDeleted += count;
    }

    console.log("");
    console.log(`Selesai. Total ${totalDeleted} baris dihapus.`);
    console.log("Akun login (user/session/account) tetap utuh.");
}

main().catch((error) => {
    console.error("[reset-data] FAILED:", error);
    process.exit(1);
});