import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { claimWorkflow, claimWorkflowItem } from "@/db/schema";
import { db } from "@/lib/db";
import {
    canActorReadClaimWorkflow,
    claimWorkflowStatuses,
    generateClaimLetterPdf,
    requireClaimSession,
    writeClaimAudit,
} from "@/lib/claim-workflow";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const CLAIM_LETTERS_DIR = path.resolve(process.cwd(), "runtime", "claim-workflow", "letters");

function isPathInsideLettersDir(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return resolved === CLAIM_LETTERS_DIR || resolved.startsWith(CLAIM_LETTERS_DIR + path.sep);
}

function generationAllowed(status: string) {
    return status === claimWorkflowStatuses.readyToSubmit ||
        status === claimWorkflowStatuses.submittedToPrincipal;
}

function validateGeneration(
    workflow: typeof claimWorkflow.$inferSelect,
    items: Array<typeof claimWorkflowItem.$inferSelect>,
) {
    if (!generationAllowed(workflow.status)) {
        return "Claim Letter PDF hanya dapat dibuat saat status Ready to Submit atau Submitted to Principal.";
    }
    if (items.length === 0) return "Claim Letter PDF tidak dapat dibuat: workflow belum memiliki item.";
    if (!(Number(workflow.totalClaim || 0) > 0)) return "Claim Letter PDF tidak dapat dibuat: Total Claim harus lebih dari 0.";
    if (items.some((item) => !(Number(item.nilaiKlaim || 0) > 0))) {
        return "Claim Letter PDF tidak dapat dibuat: setiap item harus memiliki Nilai Klaim lebih dari 0.";
    }
    return null;
}

export async function POST(_request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (actor.role !== "admin" && actor.role !== "claim") {
        return NextResponse.json({ ok: false, error: "Hanya role admin atau claim yang dapat membuat Claim Letter PDF." }, { status: 403 });
    }

    try {
        const { id } = await context.params;
        const [workflow] = await db.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
        if (!workflow) return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
        const items = await db.select().from(claimWorkflowItem).where(eq(claimWorkflowItem.claimWorkflowId, id));
        const validationError = validateGeneration(workflow, items);
        if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 409 });

        const generatedAt = new Date();
        const result = await generateClaimLetterPdf(workflow, items, generatedAt);

        let previousPdfPath: string | null = null;
        try {
            await db.transaction(async (tx) => {
                const [current] = await tx.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
                if (!current || !generationAllowed(current.status)) {
                    throw new Error("Claim Workflow status berubah sebelum Claim Letter PDF tersimpan.");
                }
                previousPdfPath = current.claimLetterPdfPath ?? null;
                await tx.update(claimWorkflow).set({
                    claimLetterPdfPath: result.filePath,
                    claimLetterGeneratedAt: generatedAt,
                    claimLetterGeneratedBy: actor.id,
                    updatedAt: generatedAt,
                }).where(eq(claimWorkflow.id, id));
                await writeClaimAudit({
                    claimWorkflowId: id,
                    actor,
                    action: "claim_letter_generated",
                    fromStatus: current.status,
                    toStatus: current.status,
                    metadata: {
                        claimLetterPdfPath: result.filePath,
                        itemCount: items.length,
                        totalClaim: Number(current.totalClaim || 0),
                        ...(previousPdfPath ? { previousClaimLetterPdfPath: previousPdfPath } : {}),
                    },
                }, tx);
            });
        } catch (transactionError) {
            // Transaction rolled back: hapus PDF yang sudah terlanjur ditulis ke disk
            // supaya tidak meninggalkan orphan file di runtime/claim-workflow/letters.
            await unlink(result.filePath).catch(() => {});
            throw transactionError;
        }

        // Setelah transaksi sukses, hapus PDF lama (kalau ada) untuk
        // mencegah akumulasi file yang sudah tidak direferensikan database.
        if (previousPdfPath && previousPdfPath !== result.filePath && isPathInsideLettersDir(previousPdfPath)) {
            await unlink(previousPdfPath).catch(() => {});
        }

        return NextResponse.json({
            ok: true,
            success: true,
            pdfPath: result.filePath,
            downloadUrl: `/api/claim-workflow/${id}/claim-letter`,
            claimLetterGeneratedAt: generatedAt,
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW CLAIM LETTER PDF ERROR]", error);
        return NextResponse.json({ ok: false, error: "Gagal membuat Claim Letter PDF." }, { status: 500 });
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
    if (!workflow.claimLetterPdfPath) {
        return NextResponse.json({ ok: false, error: "Claim Letter PDF belum pernah dibuat." }, { status: 404 });
    }
    if (!isPathInsideLettersDir(workflow.claimLetterPdfPath)) {
        console.error("[CLAIM WORKFLOW CLAIM LETTER PDF] Refusing to serve PDF outside letters dir", {
            workflowId: id,
            path: workflow.claimLetterPdfPath,
        });
        return NextResponse.json({ ok: false, error: "Path Claim Letter PDF tidak valid." }, { status: 400 });
    }

    try {
        const file = await readFile(workflow.claimLetterPdfPath);
        const fileName = `${workflow.claimWorkflowNo.replace(/[^a-zA-Z0-9]+/g, "-")}-claim-letter.pdf`;
        return new NextResponse(new Uint8Array(file), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${fileName}"`,
            },
        });
    } catch {
        return NextResponse.json({ ok: false, error: "File Claim Letter PDF tidak ditemukan." }, { status: 404 });
    }
}
