/*
 * Tujuan: Generate dan serve Kwitansi Claim PDF (POST/GET).
 *         Mirroring pattern Claim Letter route.
 * Caller: UI Claim Workflow detail (admin/claim untuk POST, viewer Claim
 *         Workflow untuk GET).
 * Side Effects:
 *   POST: tulis PDF ke runtime/claim-workflow/receipts, update metadata
 *         claim_workflow.receipt_pdf_path, audit `claim_receipt_generated`.
 *   GET : stream PDF dari path yang sudah di-validate.
 *
 * PENTING: Kwitansi Claim adalah dokumen klaim PRE-submission ke
 * principal. Tidak butuh claim_payment dan tidak menandakan pembayaran
 * dari principal sudah masuk.
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
    generateClaimReceiptPdf,
    requireClaimSession,
    writeClaimAudit,
} from "@/lib/claim-workflow";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const RECEIPT_DIR = path.resolve(process.cwd(), "runtime", "claim-workflow", "receipts");

function isPathInsideReceiptDir(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return resolved === RECEIPT_DIR || resolved.startsWith(RECEIPT_DIR + path.sep);
}

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
        return "Kwitansi Claim PDF tidak dapat dibuat pada status workflow saat ini.";
    }
    if (items.length === 0) return "Kwitansi Claim PDF tidak dapat dibuat: workflow belum memiliki item.";
    if (!(Number(workflow.totalClaim || 0) > 0)) return "Kwitansi Claim PDF tidak dapat dibuat: Total Claim harus lebih dari 0.";
    if (items.some((item) => !(Number(item.nilaiKlaim || 0) > 0))) {
        return "Kwitansi Claim PDF tidak dapat dibuat: setiap item harus memiliki Nilai Klaim lebih dari 0.";
    }
    return null;
}

export async function POST(_request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (actor.role !== "admin" && actor.role !== "claim") {
        return NextResponse.json({ ok: false, error: "Hanya role admin atau claim yang dapat membuat Kwitansi Claim PDF." }, { status: 403 });
    }

    try {
        const { id } = await context.params;
        const [workflow] = await db.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
        if (!workflow) return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
        const items = await db.select().from(claimWorkflowItem).where(eq(claimWorkflowItem.claimWorkflowId, id));
        const validationError = validateGeneration(workflow, items);
        if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 409 });

        const generatedAt = new Date();
        const result = await generateClaimReceiptPdf(workflow, items, generatedAt);

        let previousPdfPath: string | null = null;
        try {
            await db.transaction(async (tx) => {
                const [current] = await tx.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
                if (!current || !generationAllowed(current.status)) {
                    throw new Error("Claim Workflow status berubah sebelum Kwitansi Claim PDF tersimpan.");
                }
                previousPdfPath = current.receiptPdfPath ?? null;
                await tx.update(claimWorkflow).set({
                    receiptPdfPath: result.filePath,
                    receiptGeneratedAt: generatedAt,
                    receiptGeneratedBy: actor.id,
                    updatedAt: generatedAt,
                }).where(eq(claimWorkflow.id, id));
                await writeClaimAudit({
                    claimWorkflowId: id,
                    actor,
                    action: "claim_receipt_generated",
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
            await unlink(result.filePath).catch(() => {});
            throw transactionError;
        }

        if (previousPdfPath && previousPdfPath !== result.filePath && isPathInsideReceiptDir(previousPdfPath)) {
            await unlink(previousPdfPath).catch(() => {});
        }

        return NextResponse.json({
            ok: true,
            success: true,
            pdfPath: result.filePath,
            downloadUrl: `/api/claim-workflow/${id}/receipt`,
            receiptGeneratedAt: generatedAt,
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW RECEIPT PDF ERROR]", error);
        return NextResponse.json({ ok: false, error: "Gagal membuat Kwitansi Claim PDF." }, { status: 500 });
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
    if (!workflow.receiptPdfPath) {
        return NextResponse.json({ ok: false, error: "Kwitansi Claim PDF belum pernah dibuat." }, { status: 404 });
    }
    if (!isPathInsideReceiptDir(workflow.receiptPdfPath)) {
        console.error("[CLAIM WORKFLOW RECEIPT PDF] Refusing to serve PDF outside receipts dir", {
            workflowId: id,
            path: workflow.receiptPdfPath,
        });
        return NextResponse.json({ ok: false, error: "Path Kwitansi Claim PDF tidak valid." }, { status: 400 });
    }

    try {
        const file = await readFile(workflow.receiptPdfPath);
        const fileName = `${workflow.claimWorkflowNo.replace(/[^a-zA-Z0-9]+/g, "-")}-receipt.pdf`;
        return new NextResponse(new Uint8Array(file), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${fileName}"`,
            },
        });
    } catch {
        return NextResponse.json({ ok: false, error: "File Kwitansi Claim PDF tidak ditemukan." }, { status: 404 });
    }
}
