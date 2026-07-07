/*
 * Tujuan: Lihat detail 1 report_run + daftar penerima (preview dry-run) sebelum kirim.
 * Caller: UI Laporan Harian (tombol Review sebelum Send).
 * Dependensi: requirePermission, db/schema (reportRun, reportRunRecipient).
 * Main Functions: GET (ringkasan run + penerima).
 * Side Effects: DB read-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reportRun, reportRunRecipient } from "@/db/schema";
import { requirePermission } from "@/lib/rbac/resolve";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
    const gate = await requirePermission(req, "laporan_harian.view");
    if (gate.response) return gate.response;

    const { runId } = await ctx.params;
    const [run] = await db.select().from(reportRun).where(eq(reportRun.id, runId)).limit(1);
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });

    const recipients = await db.select().from(reportRunRecipient).where(eq(reportRunRecipient.runId, runId));
    return NextResponse.json({ run, recipients, totalRecipients: recipients.length });
}
