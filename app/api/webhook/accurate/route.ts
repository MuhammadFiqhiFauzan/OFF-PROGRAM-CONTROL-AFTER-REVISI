import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_WEBHOOK_IPS = ["202.78.195.250", "163.61.77.2", "127.0.0.1", "::1"];
const ALLOW_UNVERIFIED_IPS = process.env.WEBHOOK_ALLOW_UNVERIFIED_IPS === "1";

const LOG_FILE_PATH = path.join(process.cwd(), 'webhook_events.log');
const LOG_ROTATION_PATH = path.join(process.cwd(), 'webhook_events.log.1');
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function resolveClientIp(request: Request): string {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
        const first = forwardedFor.split(",")[0]?.trim();
        if (first) return first;
    }
    const realIp = request.headers.get("x-real-ip");
    if (realIp && realIp.trim()) return realIp.trim();
    return "unknown";
}

function rotateLogIfNeeded() {
    try {
        const stats = fs.statSync(LOG_FILE_PATH);
        if (stats.size < LOG_MAX_BYTES) return;
        fs.renameSync(LOG_FILE_PATH, LOG_ROTATION_PATH);
    } catch {
        // file belum ada atau rotation gagal; append berikutnya akan membuat ulang
    }
}

export async function POST(request: Request) {
    try {
        // 1. IP Whitelisting (Kebijakan Accurate 26 Feb 2026).
        //    Default: enforce 403. Kalau perlu testing tanpa reverse proxy
        //    (dev/staging lokal), set env WEBHOOK_ALLOW_UNVERIFIED_IPS=1
        //    supaya request dengan IP di luar whitelist hanya di-log warning.
        const clientIp = resolveClientIp(request);
        const ipAllowed = ALLOWED_WEBHOOK_IPS.includes(clientIp);
        if (!ipAllowed) {
            console.warn(`[WEBHOOK BLOCKED] Unauthorized IP: ${clientIp}`);
            if (!ALLOW_UNVERIFIED_IPS) {
                return NextResponse.json({ error: "Unauthorized IP Address" }, { status: 403 });
            }
        }

        // 2. Tangkap Body Webhook dari Accurate
        const payload = await request.json();

        console.log("----------------------------------------");
        console.log("🔔 [WEBHOOK ACCURATE DITERIMA]");

        // 3. Simpan log ke file lokal di root folder project, dengan rotation
        //    sederhana 1 generation supaya log tidak fill disk.
        const timestamp = new Date().toISOString();
        const logEntry = {
            receivedAt: timestamp,
            clientIp,
            ipAllowed,
            payload,
        };

        fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(logEntry) + "\n", 'utf8');
        rotateLogIfNeeded();
        console.log(`[+] Disimpan ke webhook_events.log`);

        // 4. Pembacaan ringkas array event Accurate untuk visibilitas runtime
        if (Array.isArray(payload)) {
            for (const event of payload) {
                if (event && typeof event === "object") {
                    const e = event as Record<string, unknown>;
                    console.log(`>> Event: ${e.eventType ?? 'UNKNOWN'} | Modul: ${e.module ?? 'N/A'}`);
                }
            }
        }

        console.log("----------------------------------------");

        // 5. Wajib balas 200 OK ke Accurate
        return NextResponse.json({ success: true, message: "Webhook processed" }, { status: 200 });

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("❌ [WEBHOOK ERROR]:", message);
        // Jika terjadi error, balas 500. Accurate akan mencatatnya sebagai
        // Failed/Pending dan kemungkinan retry.
        return NextResponse.json({ error: "Gagal memproses webhook" }, { status: 500 });
    }
}
