/**
 * TEMP SCRIPT — hapus setelah selesai testing.
 *
 * Tujuan:
 *   Seed 3 akun lokal sekaligus untuk validasi guardrail Phase 2B Claim Workflow:
 *     - admin@local.test  (role: admin)
 *     - claim@local.test  (role: claim)
 *     - staff@local.test  (role: staff)
 *   Semua password: Password123!
 *
 * Kenapa script terpisah:
 *   `scripts/create-user.mjs` sudah ada, tetapi default-nya hanya membuat
 *   admin@local.test. Untuk test guardrail kita butuh role `claim` dan `staff`
 *   juga di satu run, dan emailVerified harus true supaya bisa langsung login.
 *
 * Cara pakai (PowerShell, dari root project):
 *   node scripts/temp-seed-admin.mjs
 *
 * Setelah testing selesai, HAPUS file ini:
 *   rm scripts/temp-seed-admin.mjs
 *
 * Guards:
 *   - Menolak NODE_ENV=production kecuali --force.
 *   - Menolak DATABASE_URL non-lokal kecuali --force.
 */

import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
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

const force = process.argv.includes("--force");

function isLocalDatabaseUrl(url) {
    if (url.startsWith("file:")) {
        const filePath = url.slice("file:".length);
        if (filePath.startsWith("/app/")) return false;
        return true;
    }
    if (
        url.startsWith("libsql://localhost") ||
        url.startsWith("http://localhost") ||
        url.startsWith("https://localhost") ||
        url.startsWith("libsql://127.0.0.1") ||
        url.startsWith("http://127.0.0.1") ||
        url.startsWith("https://127.0.0.1")
    ) {
        return true;
    }
    return false;
}

if (process.env.NODE_ENV === "production" && !force) {
    console.error("[temp-seed-admin] REFUSED: NODE_ENV=production. Re-run dengan --force jika yakin.");
    process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL || "file:sqlite.db";
if (!isLocalDatabaseUrl(databaseUrl) && !force) {
    console.error(`[temp-seed-admin] REFUSED: DATABASE_URL terlihat non-lokal (${databaseUrl}). Pakai --force jika sengaja.`);
    process.exit(2);
}

const targets = [
    {
        email: "admin@local.test",
        password: "Password123!",
        role: "admin",
        name: "Local Admin",
    },
    {
        email: "claim@local.test",
        password: "Password123!",
        role: "claim",
        name: "Local Claim User",
    },
    {
        email: "staff@local.test",
        password: "Password123!",
        role: "staff",
        name: "Local Staff",
    },
];

const db = createClient({ url: databaseUrl });

async function getRowByEmail(email) {
    const result = await db.execute({
        sql: "SELECT id FROM user WHERE email = ? LIMIT 1",
        args: [email],
    });
    return result.rows[0] || null;
}

async function getCredentialAccount(userId) {
    const result = await db.execute({
        sql: "SELECT id FROM account WHERE userId = ? AND providerId = 'credential' LIMIT 1",
        args: [userId],
    });
    return result.rows[0] || null;
}

async function upsert(target) {
    const now = Date.now();
    const passwordHash = await hashPassword(target.password);
    const existing = await getRowByEmail(target.email);

    if (existing) {
        const userId = String(existing.id);
        const account = await getCredentialAccount(userId);
        const accountStatement = account
            ? {
                  sql: `UPDATE account SET password = ?, updatedAt = ? WHERE id = ?`,
                  args: [passwordHash, now, String(account.id)],
              }
            : {
                  sql: `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
                        VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
                  args: [randomUUID(), userId, userId, passwordHash, now, now],
              };

        // Reset permissions ke '{}' supaya preset role yang dipakai (penting:
        // staff harus benar-benar pakai preset baru claim_workflow=["view"]).
        await db.batch(
            [
                {
                    sql: `UPDATE user
                          SET name = ?, role = ?, emailVerified = 1, banned = 0, banReason = NULL, banExpires = NULL,
                              permissions = '{}', updatedAt = ?
                          WHERE id = ?`,
                    args: [target.name, target.role, now, userId],
                },
                accountStatement,
            ],
            "write",
        );

        return { action: "updated", userId };
    }

    const userId = randomUUID();
    await db.batch(
        [
            {
                sql: `INSERT INTO user (id, name, email, emailVerified, role, permissions, banned, createdAt, updatedAt)
                      VALUES (?, ?, ?, 1, ?, '{}', 0, ?, ?)`,
                args: [userId, target.name, target.email, target.role, now, now],
            },
            {
                sql: `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
                      VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
                args: [randomUUID(), userId, userId, passwordHash, now, now],
            },
        ],
        "write",
    );
    return { action: "created", userId };
}

async function main() {
    const summary = [];
    for (const target of targets) {
        const result = await upsert(target);
        summary.push({ email: target.email, role: target.role, ...result });
    }
    console.log("DATABASE_URL:", databaseUrl);
    console.table(summary);
    console.log("\nLogin di http://localhost:3000/login dengan kredensial berikut:");
    console.log("");
    for (const target of targets) {
        console.log(`  ${target.role.padEnd(6)} | email: ${target.email.padEnd(22)} | password: ${target.password}`);
    }
    console.log("");
    console.log("Skenario test guardrail Phase 2B:");
    console.log("  1. Login admin   -> bisa Create Claim Workflow + Mark Ready + Submit to Principal.");
    console.log("  2. Login claim   -> sama seperti admin (full transisi Phase 2B).");
    console.log("  3. Login staff   -> sidebar Claim Workflow boleh tampil (view), tapi:");
    console.log("       - tombol Create Claim Workflow di OFF detail HARUS 403 dari endpoint.");
    console.log("       - PATCH item tax HARUS 403.");
    console.log("       - POST /status (mark_ready / submit_to_principal) HARUS 403.");
    console.log("");
    console.log("HAPUS file ini setelah testing selesai: rm scripts/temp-seed-admin.mjs");
}

main().catch((error) => {
    console.error("[temp-seed-admin] FAILED:", error);
    process.exit(1);
});
