import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    claimPayment,
    claimWorkflow,
    claimWorkflowItem,
    offBatch,
    user,
} from "@/db/schema";
import {
    canActorReadClaimWorkflow,
    claimWorkflowStatuses,
    recalcPaymentTotals,
    requireClaimSession,
} from "@/lib/claim-workflow";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!canActorReadClaimWorkflow(actor)) {
        return NextResponse.json({ ok: false, error: "Role Anda tidak memiliki akses detail Claim Workflow." }, { status: 403 });
    }

    try {
        const { id } = await context.params;
        const [row] = await db
            .select({
                workflow: claimWorkflow,
                offNoPengajuan: offBatch.noPengajuan,
            })
            .from(claimWorkflow)
            .leftJoin(offBatch, eq(claimWorkflow.offBatchId, offBatch.id))
            .where(eq(claimWorkflow.id, id));

        if (!row) {
            return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
        }

        const items = await db
            .select()
            .from(claimWorkflowItem)
            .where(eq(claimWorkflowItem.claimWorkflowId, id));
        const payments = await db
            .select()
            .from(claimPayment)
            .where(eq(claimPayment.claimWorkflowId, id))
            .orderBy(asc(claimPayment.paymentDate), asc(claimPayment.createdAt));
        // Resolve display name untuk No Claim assignor agar UI tidak harus
        // join sendiri. Aman: kalau noClaimAssignedBy NULL, lewati query.
        let noClaimAssignedByName: string | null = null;
        if (row.workflow.noClaimAssignedBy) {
            const [assignor] = await db
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, row.workflow.noClaimAssignedBy));
            noClaimAssignedByName = assignor?.name ?? null;
        }
        const canManageClaim = actor.role === "admin" || actor.role === "claim";
        // Phase R1: Claim Letter PDF dapat di-generate sejak Draft / Need
        // Revision. User wajib generate PDF dulu sebelum Mark Ready, karena
        // mark_ready memvalidasi `claimLetterPdfPath`. Generation tetap
        // tersedia di Ready to Submit / Submitted to Principal untuk
        // mengganti PDF aktif (regenerate skenario kecil).
        // Phase R2: aturan window yang sama dipakai untuk Summary & Receipt.
        const docGenerationAllowed = (
            row.workflow.status === claimWorkflowStatuses.draft ||
            row.workflow.status === claimWorkflowStatuses.needRevision ||
            row.workflow.status === claimWorkflowStatuses.readyToSubmit ||
            row.workflow.status === claimWorkflowStatuses.submittedToPrincipal
        );
        const canGenerateClaimLetter = canManageClaim && docGenerationAllowed;
        const canGenerateSummary = canManageClaim && docGenerationAllowed;
        const canGenerateReceipt = canManageClaim && docGenerationAllowed;
        const canAssignNoClaim = canManageClaim;

        // Phase R3 — Principal Payment + Outstanding:
        // Hitung totals payment dari list aktif/non-voided supaya UI dan
        // gating tombol payment selalu konsisten dengan perhitungan
        // backend (tidak bergantung pada nilai cache di kolom workflow
        // yang mungkin sedikit lag dari list payment terbaru).
        const totalClaim = Number(row.workflow.totalClaim || 0);
        const paymentTotals = recalcPaymentTotals(totalClaim, payments);
        const activePayments = payments.filter((p) => p.voidedAt === null);
        const voidedPayments = payments.filter((p) => p.voidedAt !== null);
        const paymentAllowed = (
            row.workflow.status === claimWorkflowStatuses.submittedToPrincipal ||
            row.workflow.status === claimWorkflowStatuses.partiallyPaid
        );
        const canRecordPayment = canManageClaim && paymentAllowed && paymentTotals.remainingAmount > 0;
        const canVoidPayment = canManageClaim && row.workflow.status !== claimWorkflowStatuses.closed;

        // Phase R4 — Close Claim Workflow:
        // Bangun closeBlockers terurut sesuai prioritas user-facing.
        // canClose hanya true bila tidak ada blocker dan actor admin/claim.
        const closeBlockers: string[] = [];
        if (row.workflow.status === claimWorkflowStatuses.closed) {
            closeBlockers.push("Claim Workflow sudah Closed.");
        } else if (row.workflow.status === claimWorkflowStatuses.cancelled) {
            closeBlockers.push("Claim Workflow sudah Cancelled, tidak dapat di-Close.");
        } else if (row.workflow.status !== claimWorkflowStatuses.paid) {
            closeBlockers.push("Workflow belum berstatus Paid.");
        }
        if (!String(row.workflow.noClaim || "").trim()) {
            closeBlockers.push("No Claim belum diisi.");
        }
        if (!(totalClaim > 0)) {
            closeBlockers.push("Total Claim harus lebih dari 0.");
        }
        if (activePayments.length === 0) {
            closeBlockers.push("Belum ada pembayaran aktif.");
        }
        if (paymentTotals.totalPaid < totalClaim) {
            closeBlockers.push("Total Paid belum mencapai Total Claim.");
        }
        if (paymentTotals.remainingAmount > 0) {
            closeBlockers.push("Outstanding belum 0.");
        }
        if (!row.workflow.claimLetterPdfPath) {
            closeBlockers.push("Claim Letter PDF belum dibuat.");
        }
        if (!row.workflow.summaryPdfPath) {
            closeBlockers.push("Summary PDF belum dibuat.");
        }
        if (!row.workflow.receiptPdfPath) {
            closeBlockers.push("Kwitansi Claim PDF belum dibuat.");
        }
        const canClose = canManageClaim && closeBlockers.length === 0;

        return NextResponse.json({
            ok: true,
            workflow: {
                ...row.workflow,
                offNoPengajuan: row.offNoPengajuan,
                noClaimAssignedByName,
                // Cache totals tetap dibaca oleh UI lama; juga override dengan
                // hasil recalc agar konsisten.
                totalPaid: paymentTotals.totalPaid,
                remainingAmount: paymentTotals.remainingAmount,
            },
            offBatch: {
                id: row.workflow.offBatchId,
                noPengajuan: row.offNoPengajuan,
            },
            items,
            payments,
            activePayments,
            voidedPayments,
            paymentSummary: {
                totalClaim,
                totalPaid: paymentTotals.totalPaid,
                remainingAmount: paymentTotals.remainingAmount,
                paymentStatus: row.workflow.status,
                paymentCount: payments.length,
                activePaymentCount: activePayments.length,
                voidedPaymentCount: voidedPayments.length,
            },
            canEditItems: canManageClaim,
            canGenerateClaimLetter,
            canGenerateSummary,
            canGenerateReceipt,
            canAssignNoClaim,
            canRecordPayment,
            canVoidPayment,
            canClose,
            closeBlockers,
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW DETAIL ERROR]", error);
        return NextResponse.json({ ok: false, error: "Gagal mengambil detail Claim Workflow." }, { status: 500 });
    }
}
