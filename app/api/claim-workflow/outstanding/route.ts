/*
 * Tujuan: Endpoint Outstanding — daftar Claim Workflow yang masih punya
 *         saldo `remainingAmount > 0` untuk menggantikan sheet Excel
 *         "MONITOR OUTSTANDING".
 * Caller: UI list Claim Workflow (`/claim-workflow`) dan dashboard
 *         outstanding masa depan.
 * Side Effects: Tidak ada (read-only).
 *
 * Phase R3 — Principal Payment + Outstanding:
 *   - Outstanding tidak butuh PEKA/EC/CN.
 *   - `remainingAmount = max(totalClaim - totalPaid, 0)`. Konvensi tanda
 *     Excel `Sisa = Nilai Bayar - Nilai` tidak di-port ke web — UI selalu
 *     memakai non-negatif.
 *   - Status yang diikutkan ke list outstanding adalah workflow yang
 *     sudah di-submit ke principal tapi belum lunas, plus baris legacy
 *     PEKA agar tidak hilang dari monitoring.
 */
import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimPayment, claimWorkflow, offBatch } from "@/db/schema";
import {
    LEGACY_PEKA_STATUSES,
    canActorAccessClaimData,
    claimWorkflowStatuses,
    recalcPaymentTotals,
    requireClaimSession,
} from "@/lib/claim-workflow";

const OUTSTANDING_STATUSES = [
    claimWorkflowStatuses.submittedToPrincipal,
    claimWorkflowStatuses.partiallyPaid,
    claimWorkflowStatuses.outstanding,
    // Legacy PEKA statuses tetap dimonitor sebagai outstanding agar
    // workflow lama yang belum dinormalisasi tidak hilang dari dashboard.
    ...LEGACY_PEKA_STATUSES,
];

function dayDiff(now: number, ref: Date | null | undefined): number | null {
    if (!ref) return null;
    const refTime = ref instanceof Date ? ref.getTime() : new Date(ref).getTime();
    if (!Number.isFinite(refTime)) return null;
    const diff = now - refTime;
    if (diff < 0) return 0;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export async function GET(request: Request) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!canActorAccessClaimData(actor)) {
        return NextResponse.json({
            ok: false,
            error: "Role Anda tidak memiliki akses Claim Workflow.",
        }, { status: 403 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const principleCode = searchParams.get("principleCode");
        const statusFilter = searchParams.get("status");

        const conditions: SQL[] = [];
        if (statusFilter && OUTSTANDING_STATUSES.includes(statusFilter as typeof OUTSTANDING_STATUSES[number])) {
            conditions.push(eq(claimWorkflow.status, statusFilter));
        } else {
            conditions.push(inArray(claimWorkflow.status, OUTSTANDING_STATUSES as unknown as string[]));
        }
        if (principleCode) {
            conditions.push(eq(claimWorkflow.principleCode, principleCode));
        }

        const baseQuery = db
            .select({
                workflow: claimWorkflow,
                offNoPengajuan: offBatch.noPengajuan,
            })
            .from(claimWorkflow)
            .leftJoin(offBatch, eq(claimWorkflow.offBatchId, offBatch.id));

        const filtered = conditions.length > 0
            ? baseQuery.where(and(...conditions))
            : baseQuery;
        const rows = await filtered.orderBy(desc(claimWorkflow.submittedToPrincipalAt));

        const now = Date.now();
        const items = await Promise.all(rows.map(async (row) => {
            const totalClaim = Number(row.workflow.totalClaim || 0);
            const payments = await db
                .select({
                    paymentDate: claimPayment.paymentDate,
                    paymentAmount: claimPayment.paymentAmount,
                    voidedAt: claimPayment.voidedAt,
                })
                .from(claimPayment)
                .where(eq(claimPayment.claimWorkflowId, row.workflow.id))
                .orderBy(asc(claimPayment.paymentDate));
            const totals = recalcPaymentTotals(totalClaim, payments);
            const activePayments = payments.filter((p) => p.voidedAt === null);
            const latestPaymentDate = activePayments.length > 0
                ? activePayments[activePayments.length - 1].paymentDate
                : null;
            return {
                id: row.workflow.id,
                claimWorkflowNo: row.workflow.claimWorkflowNo,
                noClaim: row.workflow.noClaim,
                principleCode: row.workflow.principleCode,
                principleName: row.workflow.principleName,
                status: row.workflow.status,
                totalClaim,
                totalPaid: totals.totalPaid,
                remainingAmount: totals.remainingAmount,
                submittedToPrincipalAt: row.workflow.submittedToPrincipalAt,
                latestPaymentDate,
                daysOutstanding: dayDiff(now, row.workflow.submittedToPrincipalAt),
                offBatchId: row.workflow.offBatchId,
                offNoPengajuan: row.offNoPengajuan,
            };
        }));

        // Filter strict: outstanding harus benar-benar punya remainingAmount > 0.
        // Workflow yang sudah Paid namun status belum di-recalc tidak akan
        // ikut nongol di dashboard outstanding.
        const outstandingItems = items.filter((row) => row.remainingAmount > 0);

        const summary = outstandingItems.reduce(
            (acc, row) => ({
                workflowCount: acc.workflowCount + 1,
                totalClaim: acc.totalClaim + row.totalClaim,
                totalPaid: acc.totalPaid + row.totalPaid,
                totalOutstanding: acc.totalOutstanding + row.remainingAmount,
            }),
            { workflowCount: 0, totalClaim: 0, totalPaid: 0, totalOutstanding: 0 },
        );

        return NextResponse.json({
            ok: true,
            outstanding: outstandingItems,
            summary,
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW OUTSTANDING ERROR]", error);
        return NextResponse.json({
            ok: false,
            error: "Gagal mengambil daftar outstanding Claim Workflow.",
        }, { status: 500 });
    }
}
