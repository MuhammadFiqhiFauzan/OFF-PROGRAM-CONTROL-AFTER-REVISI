/*
 * Tujuan: Generate dan serve Claim Summary PDF (POST/GET).
 *         Mirroring pattern Claim Letter route.
 * Caller: UI Claim Workflow detail (admin/claim untuk POST, viewer Claim
 *         Workflow untuk GET).
 * Side Effects:
 *   POST: tulis PDF ke runtime/claim-workflow/summaries, update metadata
 *         claim_workflow.summary_pdf_path, audit `claim_summary_generated`.
 *   GET : stream PDF dari path yang sudah di-validate.
 */
import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { claimWorkflow, claimWorkflowItem } from "@/db/schema";
import { db } from "@/lib/db";
import {
    canActorReadClaimWorkflow,
    claimWorkflowStatuses,
    generateClaimSummaryPdf,
    requireClaimSession,
    writeClaimAudit,
} from "@/lib/claim-workflow";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const SUMMARY_DIR = path.resolve(process.cwd(), "runtime", "claim-workflow", "summaries");

function isPathInsideSummaryDir(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return resolved === SUMMARY_DIR || resolved.startsWith(SUMMARY_DIR + path.sep);
}

// Phase R2: Summary boleh di-generate di status yang sama dengan Claim
// Letter (Draft, Need Revision, Ready to Submit, Submitted to Principal).
// Tidak menunggu claim_payment.
function generationAllowed(status: string) {
    return status === claimWorkflowStatuses.draft ||
        status === claimWorkflowStatuses.needRevision ||
        status === claimWorkflowStatuses.readyToSubmit ||
        status === claimWorkflowStatuses.submittedToPrincipal;
}

function validateGeneration(
    workflow: typeof claimWorkflow.$inferSelect,
    items: Array<typeof claimWorkflowItem.$inferSelect>,
) {
    if (!generationAllowed(workflow.status)) {
        return "Claim Summary PDF tidak dapat dibuat pada status workflow saat ini.";
    }
    if (items.length === 0) return "Claim Summary PDF tidak dapat dibuat: workflow belum memiliki item.";
    if (!(Number(workflow.totalClaim || 0) > 0)) return "Claim Summary PDF tidak dapat dibuat: Total Claim harus lebih dari 0.";
    if (items.some((item) => !(Number(item.nilaiKlaim || 0) > 0))) {
        return "Claim Summary PDF tidak dapat dibuat: setiap item harus memiliki Nilai Klaim lebih dari 0.";
    }
    return null;
}

export async function POST(_request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (actor.role !== "admin" && actor.role !== "claim") {
        return NextResponse.json({ ok: false, error: "Hanya role admin atau claim yang dapat membuat Claim Summary PDF." }, { status: 403 });
    }

    try {
        const { id } = await context.params;
        const [workflow] = await db.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
        if (!workflow) return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
        const items = await db.select().from(claimWorkflowItem).where(eq(claimWorkflowItem.claimWorkflowId, id));
        const validationError = validateGeneration(workflow, items);
        if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 409 });

        const generatedAt = new Date();
        const result = await generateClaimSummaryPdf(workflow, items, generatedAt);

        let previousPdfPath: string | null = null;
        try {
            await db.transaction(async (tx) => {
                const [current] = await tx.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
                if (!current || !generationAllowed(current.status)) {
                    throw new Error("Claim Workflow status berubah sebelum Claim Summary PDF tersimpan.");
                }
                previousPdfPath = current.summaryPdfPath ?? null;
                await tx.update(claimWorkflow).set({
                    summaryPdfPath: result.filePath,
                    summaryGeneratedAt: generatedAt,
                    summaryGeneratedBy: actor.id,
                    updatedAt: generatedAt,
                }).where(eq(claimWorkflow.id, id));
                await writeClaimAudit({
                    claimWorkflowId: id,
                    actor,
                    action: "claim_summary_generated",
                    fromStatus: current.status,
                    toStatus: current.status,
                    metadata: {
                        pdfPath: result.filePath,
                        itemCount: items.length,
                        totalClaim: Number(current.totalClaim || 0),
                        noClaim: current.noClaim ?? null,
                        generatedBy: actor.id,
                        ...(previousPdfPath ? { previousPdfPath } : {}),
                    },
                }, tx);
            });
        } catch (transactionError) {
            // Transaction rolled back: hapus PDF yang sudah terlanjur ditulis ke disk.
            await unlink(result.filePath).catch(() => {});
            throw transactionError;
        }

        // Setelah transaksi sukses, hapus PDF lama (kalau ada) untuk
        // mencegah akumulasi file yang sudah tidak direferensikan database.
        if (previousPdfPath && previousPdfPath !== result.filePath && isPathInsideSummaryDir(previousPdfPath)) {
            await unlink(previousPdfPath).catch(() => {});
        }

        return NextResponse.json({
            ok: true,
            success: true,
            pdfPath: result.filePath,
            downloadUrl: `/api/claim-workflow/${id}/summary`,
            summaryGeneratedAt: generatedAt,
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW SUMMARY PDF ERROR]", error);
        return NextResponse.json({ ok: false, error: "Gagal membuat Claim Summary PDF." }, { status: 500 });
    }
}

export async function GET(_request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!canActorReadClaimWorkflow(actor)) {
        return NextResponse.json({ ok: false, error: "Role Anda tidak memiliki akses detail Claim Workflow." }, { status: 403 });
    }

    const { id } = await context.params;
    const [workflow] = await db.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
    if (!workflow) return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
    if (!workflow.summaryPdfPath) {
        return NextResponse.json({ ok: false, error: "Claim Summary PDF belum pernah dibuat." }, { status: 404 });
    }
    if (!isPathInsideSummaryDir(workflow.summaryPdfPath)) {
        console.error("[CLAIM WORKFLOW SUMMARY PDF] Refusing to serve PDF outside summaries dir", {
            workflowId: id,
            path: workflow.summaryPdfPath,
        });
        return NextResponse.json({ ok: false, error: "Path Claim Summary PDF tidak valid." }, { status: 400 });
    }

    try {
        const file = await readFile(workflow.summaryPdfPath);
        const fileName = `${workflow.claimWorkflowNo.replace(/[^a-zA-Z0-9]+/g, "-")}-summary.pdf`;
        return new NextResponse(new Uint8Array(file), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${fileName}"`,
            },
        });
    } catch {
        return NextResponse.json({ ok: false, error: "File Claim Summary PDF tidak ditemukan." }, { status: 404 });
    }
}
