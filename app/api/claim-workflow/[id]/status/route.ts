import path from "node:path";
import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimWorkflow, claimWorkflowItem } from "@/db/schema";
import {
    claimWorkflowStatuses,
    requireClaimSession,
    writeClaimAudit,
} from "@/lib/claim-workflow";

const CLAIM_LETTERS_DIR = path.resolve(process.cwd(), "runtime", "claim-workflow", "letters");

function isPathInsideLettersDir(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return resolved === CLAIM_LETTERS_DIR || resolved.startsWith(CLAIM_LETTERS_DIR + path.sep);
}

type Context = { params: Promise<{ id: string }> };

type TransitionAction =
    | "mark_ready"
    | "return_to_draft"
    | "submit_to_principal";

const ACTIONS: ReadonlyArray<TransitionAction> = [
    "mark_ready",
    "return_to_draft",
    "submit_to_principal",
];

function isTransitionAction(value: unknown): value is TransitionAction {
    return typeof value === "string" && (ACTIONS as ReadonlyArray<string>).includes(value);
}

function buildSummary(workflow: typeof claimWorkflow.$inferSelect, itemCount: number) {
    return {
        id: workflow.id,
        claimWorkflowNo: workflow.claimWorkflowNo,
        status: workflow.status,
        totalDpp: Number(workflow.totalDpp || 0),
        totalPpn: Number(workflow.totalPpn || 0),
        totalPph: Number(workflow.totalPph || 0),
        totalClaim: Number(workflow.totalClaim || 0),
        totalPaid: Number(workflow.totalPaid || 0),
        remainingAmount: Number(workflow.remainingAmount || 0),
        submittedToPrincipalAt: workflow.submittedToPrincipalAt,
        updatedAt: workflow.updatedAt,
        itemCount,
    };
}

export async function POST(request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (actor.role !== "admin" && actor.role !== "claim") {
        return NextResponse.json({
            ok: false,
            code: "CLAIM_WORKFLOW_FORBIDDEN",
            error: "Hanya role admin atau claim yang dapat mengubah status Claim Workflow.",
        }, { status: 403 });
    }

    let body: { action?: unknown; note?: unknown } = {};
    if (request.headers.get("content-type")?.includes("application/json")) {
        body = await request.json().catch(() => ({}));
    }
    if (!isTransitionAction(body.action)) {
        return NextResponse.json({
            ok: false,
            code: "CLAIM_WORKFLOW_INVALID_ACTION",
            error: "Action harus salah satu dari: mark_ready, return_to_draft, submit_to_principal.",
        }, { status: 400 });
    }
    const action = body.action;
    if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
        return NextResponse.json({
            ok: false,
            code: "CLAIM_WORKFLOW_INVALID_NOTE",
            error: "Catatan harus berupa teks.",
        }, { status: 400 });
    }
    const note = typeof body.note === "string" && body.note.trim() !== "" ? body.note : null;

    try {
        const { id } = await context.params;
        const [workflow] = await db.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
        if (!workflow) {
            return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
        }

        const fromStatus = workflow.status;
        let toStatus: string;

        if (action === "mark_ready") {
            if (
                fromStatus !== claimWorkflowStatuses.draft &&
                fromStatus !== claimWorkflowStatuses.needRevision
            ) {
                return NextResponse.json({
                    ok: false,
                    code: "CLAIM_WORKFLOW_INVALID_STATE",
                    error: "Mark Ready hanya tersedia saat status Draft atau Need Revision.",
                }, { status: 409 });
            }
            toStatus = claimWorkflowStatuses.readyToSubmit;
        } else if (action === "return_to_draft") {
            if (fromStatus !== claimWorkflowStatuses.readyToSubmit) {
                return NextResponse.json({
                    ok: false,
                    code: "CLAIM_WORKFLOW_INVALID_STATE",
                    error: "Return to Draft hanya tersedia saat status Ready to Submit.",
                }, { status: 409 });
            }
            toStatus = claimWorkflowStatuses.draft;
        } else {
            // submit_to_principal
            if (fromStatus !== claimWorkflowStatuses.readyToSubmit) {
                return NextResponse.json({
                    ok: false,
                    code: "CLAIM_WORKFLOW_INVALID_STATE",
                    error: "Submit to Principal hanya tersedia saat status Ready to Submit.",
                }, { status: 409 });
            }
            toStatus = claimWorkflowStatuses.submittedToPrincipal;
        }

        // Validation untuk mark_ready: workflow harus memiliki item dan
        // total/komponen pajak per item harus konsisten > 0 sebelum dilock.
        const items = await db
            .select()
            .from(claimWorkflowItem)
            .where(eq(claimWorkflowItem.claimWorkflowId, id));
        if (action === "mark_ready") {
            if (items.length === 0) {
                return NextResponse.json({
                    ok: false,
                    code: "CLAIM_WORKFLOW_EMPTY_ITEMS",
                    error: "Claim Workflow harus memiliki minimal satu item sebelum Ready to Submit.",
                }, { status: 422 });
            }
            const totalClaim = Number(workflow.totalClaim || 0);
            if (!(totalClaim > 0)) {
                return NextResponse.json({
                    ok: false,
                    code: "CLAIM_WORKFLOW_TOTAL_ZERO",
                    error: "Total Claim harus lebih dari 0 sebelum Ready to Submit.",
                }, { status: 422 });
            }
            const invalidItem = items.find(
                (row) => !(Number(row.dpp || 0) > 0) || !(Number(row.nilaiKlaim || 0) > 0),
            );
            if (invalidItem) {
                return NextResponse.json({
                    ok: false,
                    code: "CLAIM_WORKFLOW_ITEM_INVALID",
                    error: "Setiap item harus memiliki DPP dan Nilai Klaim lebih dari 0 sebelum Ready to Submit.",
                    itemId: invalidItem.id,
                }, { status: 422 });
            }
        }

        const now = new Date();
        const updatePayload: Partial<typeof claimWorkflow.$inferInsert> = {
            status: toStatus,
            updatedAt: now,
        };
        if (action === "submit_to_principal") {
            updatePayload.submittedToPrincipalAt = now;
        }
        const invalidatedClaimLetterPdfPath = action === "return_to_draft"
            ? workflow.claimLetterPdfPath
            : null;
        if (action === "return_to_draft") {
            updatePayload.claimLetterPdfPath = null;
            updatePayload.claimLetterGeneratedAt = null;
            updatePayload.claimLetterGeneratedBy = null;
        }

        const auditMetadata = {
            totalDpp: Number(workflow.totalDpp || 0),
            totalPpn: Number(workflow.totalPpn || 0),
            totalPph: Number(workflow.totalPph || 0),
            totalClaim: Number(workflow.totalClaim || 0),
            totalPaid: Number(workflow.totalPaid || 0),
            remainingAmount: Number(workflow.remainingAmount || 0),
            itemCount: items.length,
            ...(invalidatedClaimLetterPdfPath ? { invalidatedClaimLetterPdfPath } : {}),
        };

        // Status transition + audit ditulis atomic agar tidak pernah ada
        // pergeseran status tanpa jejak audit.
        await db.transaction(async (tx) => {
            await tx
                .update(claimWorkflow)
                .set(updatePayload)
                .where(eq(claimWorkflow.id, id));
            await writeClaimAudit({
                claimWorkflowId: id,
                actor,
                action,
                fromStatus,
                toStatus,
                note,
                metadata: auditMetadata,
            }, tx);
        });

        // Setelah transaksi sukses, hapus PDF yang sudah di-invalidate supaya
        // file di disk tidak menumpuk. Audit log tetap menyimpan path lama
        // di field `invalidatedClaimLetterPdfPath` untuk kebutuhan trace.
        if (
            invalidatedClaimLetterPdfPath &&
            isPathInsideLettersDir(invalidatedClaimLetterPdfPath)
        ) {
            await unlink(invalidatedClaimLetterPdfPath).catch(() => {});
        }

        const [updated] = await db
            .select()
            .from(claimWorkflow)
            .where(eq(claimWorkflow.id, id));

        return NextResponse.json({
            ok: true,
            success: true,
            workflow: buildSummary(updated, items.length),
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW STATUS TRANSITION ERROR]", error);
        return NextResponse.json({
            ok: false,
            error: "Gagal mengubah status Claim Workflow.",
        }, { status: 500 });
    }
}
