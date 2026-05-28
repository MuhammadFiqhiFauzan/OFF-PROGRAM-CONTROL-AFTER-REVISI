/*
 * Tujuan: Helper untuk Phase R7a/R7b — Multi No Claim + Direct Claim
 *         Source. R7a hanya pure mapping helper (backfill); R7b menambah
 *         DB-aware helper untuk submission CRUD dan recalc aggregate.
 * Caller:
 *   - scripts/migrate-r7a-default-submission.mjs (R7a, via duplicated
 *     plain JS — file ini tetap source of truth secara konsep).
 *   - app/api/claim-workflow/[id]/submissions/* (R7b dan ke depan).
 *   - app/api/claim-workflow/[id]/items/[itemId]/route.ts (R7b — recalc
 *     submission setelah edit pajak item).
 *   - app/api/claim-workflow/[id]/no-claim/route.ts (R7b — sync ke
 *     default submission saat single-submission compatibility flow).
 * Dependensi: drizzle-orm, db schema. Helper tetap aman dipanggil baik
 *             di luar maupun di dalam transaksi.
 * Side Effects:
 *   - Pure mapping (`buildDefaultSubmissionFromWorkflow`,
 *     `getDefaultSubmissionScopeLabel`) → tidak ada.
 *   - DB-aware helpers menulis ke `claim_submission`,
 *     `claim_workflow_item.claim_submission_id`,
 *     `claim_payment.claim_submission_id`, dan
 *     `claim_workflow.{totalDpp,totalPpn,totalPph,totalClaim,totalPaid,
 *     remainingAmount,aggregateStatus}`.
 *
 * Catatan kunci:
 * - Recalc selalu memakai data fresh dari DB (bukan cache cross-call).
 * - Helper TIDAK mengubah `claim_workflow.status`. Status workflow tetap
 *   menjadi source-of-truth display sampai R7e. `aggregate_status` boleh
 *   dimirror dari `status` workflow saat ini.
 * - Helper TIDAK menyentuh PDF / payment route behavior — itu R7c/R7d.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    claimPayment,
    claimSubmission,
    claimWorkflow,
    claimWorkflowItem,
} from "@/db/schema";
import { calculateRemainingAmount } from "./calculations";
import {
    claimSubmissionScopes,
    claimSubmissionStatuses,
} from "./constants";
import type { ClaimSubmissionRow, ClaimWorkflowRow } from "./types";

/**
 * Tipe minimal untuk executor yang dipakai helper. Pick subset metode
 * drizzle-orm yang sama-sama tersedia di `db` global maupun transaksi
 * yang dihasilkan oleh `db.transaction(async (tx) => …)`. Hindari pakai
 * `typeof db` langsung karena transaksi tidak punya properti `$client`/
 * `batch`, sehingga TypeScript akan complain saat helper dipanggil
 * dengan `tx`.
 */
type DbExecutor = Pick<typeof db, "select" | "update" | "insert">;

// =============================================================================
// Pure helpers (R7a, dipertahankan)
// =============================================================================

/**
 * Hasilkan label scope default untuk submission backfill.
 */
export function getDefaultSubmissionScopeLabel(workflow: Pick<ClaimWorkflowRow, "claimWorkflowNo">): string {
    const trimmed = String(workflow.claimWorkflowNo ?? "").trim();
    return trimmed.length > 0 ? trimmed : "Pengajuan utama";
}

export type DefaultSubmissionDraft = Omit<ClaimSubmissionRow, "id" | "claimWorkflowId">;

/**
 * Bentuk satu draft `claim_submission` dari row `claim_workflow` lama.
 * Lihat dokumentasi lengkap di header file.
 */
export function buildDefaultSubmissionFromWorkflow(
    workflow: ClaimWorkflowRow,
    now: Date,
): DefaultSubmissionDraft {
    return {
        noClaim: workflow.noClaim ?? null,
        noClaimAssignedAt: workflow.noClaimAssignedAt ?? null,
        noClaimAssignedBy: workflow.noClaimAssignedBy ?? null,
        scope: claimSubmissionScopes.perPengajuan,
        scopeLabel: getDefaultSubmissionScopeLabel(workflow),
        status: workflow.status,
        totalDpp: Number(workflow.totalDpp || 0),
        totalPpn: Number(workflow.totalPpn || 0),
        totalPph: Number(workflow.totalPph || 0),
        totalClaim: Number(workflow.totalClaim || 0),
        totalPaid: Number(workflow.totalPaid || 0),
        remainingAmount: Number(workflow.remainingAmount || 0),
        submittedToPrincipalAt: workflow.submittedToPrincipalAt ?? null,
        claimLetterPdfPath: workflow.claimLetterPdfPath ?? null,
        claimLetterGeneratedAt: workflow.claimLetterGeneratedAt ?? null,
        claimLetterGeneratedBy: workflow.claimLetterGeneratedBy ?? null,
        summaryPdfPath: workflow.summaryPdfPath ?? null,
        summaryGeneratedAt: workflow.summaryGeneratedAt ?? null,
        summaryGeneratedBy: workflow.summaryGeneratedBy ?? null,
        receiptPdfPath: workflow.receiptPdfPath ?? null,
        receiptGeneratedAt: workflow.receiptGeneratedAt ?? null,
        receiptGeneratedBy: workflow.receiptGeneratedBy ?? null,
        closedAt: workflow.closedAt ?? null,
        closedBy: workflow.closedBy ?? null,
        closeNote: workflow.closeNote ?? null,
        createdBy: workflow.createdBy ?? null,
        createdAt: workflow.createdAt ?? now,
        updatedAt: now,
    };
}

// =============================================================================
// DB-aware helpers (R7b)
// =============================================================================

/**
 * Ambil semua submission untuk satu workflow, urut createdAt asc.
 * Tidak mutate apapun. Bisa dipanggil di luar atau di dalam transaksi.
 */
export async function getWorkflowSubmissions(
    workflowId: string,
    executor: DbExecutor = db,
): Promise<ClaimSubmissionRow[]> {
    return executor
        .select()
        .from(claimSubmission)
        .where(eq(claimSubmission.claimWorkflowId, workflowId))
        .orderBy(asc(claimSubmission.createdAt));
}

/**
 * Pastikan workflow punya minimal satu submission. Idempotent.
 *
 * Bila belum ada submission sama sekali (mis. workflow baru dibuat dari
 * OFF tanpa migration), buat default submission dari field workflow,
 * lalu link semua item + payment yang masih NULL ke submission tersebut.
 *
 * Bila sudah ada submission, return submission tertua (paling awal
 * dibuat) tanpa side effect tambahan.
 *
 * Selalu dijalankan dalam executor (db atau tx). Caller bertanggung jawab
 * atas transaksi luar.
 */
export async function getOrCreateDefaultSubmission(
    executor: DbExecutor,
    workflow: ClaimWorkflowRow,
    now: Date = new Date(),
): Promise<ClaimSubmissionRow> {
    const existing = await getWorkflowSubmissions(workflow.id, executor);
    if (existing.length > 0) return existing[0];

    const draft = buildDefaultSubmissionFromWorkflow(workflow, now);
    const id = randomUUID();
    await executor.insert(claimSubmission).values({
        id,
        claimWorkflowId: workflow.id,
        ...draft,
    });

    // Link item + payment yang masih NULL. Aman karena indempotent
    // (filter `IS NULL`).
    await executor
        .update(claimWorkflowItem)
        .set({ claimSubmissionId: id, updatedAt: now })
        .where(
            and(
                eq(claimWorkflowItem.claimWorkflowId, workflow.id),
                isNull(claimWorkflowItem.claimSubmissionId),
            ),
        );
    await executor
        .update(claimPayment)
        .set({ claimSubmissionId: id, updatedAt: now })
        .where(
            and(
                eq(claimPayment.claimWorkflowId, workflow.id),
                isNull(claimPayment.claimSubmissionId),
            ),
        );

    const [created] = await executor
        .select()
        .from(claimSubmission)
        .where(eq(claimSubmission.id, id));
    return created;
}

/**
 * Recalc totals satu submission dari `claim_workflow_item` yang
 * ditugaskan ke submission tersebut. Update kolom totals + updatedAt.
 *
 * `totalPaid` dan `remainingAmount` di submission TIDAK di-recalc di
 * sini karena payment masih workflow-level di R7b. R7d akan menangani
 * payment per submission. Untuk R7b, totalPaid submission dipertahankan
 * apa adanya (default 0 untuk submission baru).
 */
export async function recalcSubmissionTotals(
    executor: DbExecutor,
    submissionId: string,
    now: Date = new Date(),
): Promise<{
    totalDpp: number;
    totalPpn: number;
    totalPph: number;
    totalClaim: number;
    itemCount: number;
}> {
    const items = await executor
        .select({
            dpp: claimWorkflowItem.dpp,
            ppnAmount: claimWorkflowItem.ppnAmount,
            pphAmount: claimWorkflowItem.pphAmount,
            nilaiKlaim: claimWorkflowItem.nilaiKlaim,
        })
        .from(claimWorkflowItem)
        .where(eq(claimWorkflowItem.claimSubmissionId, submissionId));

    const totals = items.reduce(
        (acc, row) => ({
            totalDpp: acc.totalDpp + Number(row.dpp || 0),
            totalPpn: acc.totalPpn + Number(row.ppnAmount || 0),
            totalPph: acc.totalPph + Number(row.pphAmount || 0),
            totalClaim: acc.totalClaim + Number(row.nilaiKlaim || 0),
        }),
        { totalDpp: 0, totalPpn: 0, totalPph: 0, totalClaim: 0 },
    );

    await executor
        .update(claimSubmission)
        .set({
            totalDpp: totals.totalDpp,
            totalPpn: totals.totalPpn,
            totalPph: totals.totalPph,
            totalClaim: totals.totalClaim,
            // remainingAmount mengikuti totalClaim - totalPaid (totalPaid
            // submission belum dipakai sampai R7d, default 0). Tetap
            // di-recalc supaya konsisten.
            remainingAmount: calculateRemainingAmount(totals.totalClaim, 0),
            updatedAt: now,
        })
        .where(eq(claimSubmission.id, submissionId));

    return { ...totals, itemCount: items.length };
}

/**
 * Recalc cache totals di `claim_workflow` dari sum semua submissions.
 *
 * Untuk R7b:
 * - totalDpp/totalPpn/totalPph/totalClaim → sum submissions.
 * - totalPaid/remainingAmount → tetap pakai workflow level (cache lama)
 *   karena payment masih workflow-level. Akan diganti di R7d.
 * - aggregateStatus → mirror dari workflow.status saat ini. Akan
 *   menjadi derived (aggregate dari submission status) di R7e.
 *
 * Tidak mengubah `claim_workflow.status` supaya behavior route existing
 * (mark_ready, submit_to_principal, payment, close) tidak berubah.
 */
export async function recalcWorkflowAggregateFromSubmissions(
    executor: DbExecutor,
    workflowId: string,
    now: Date = new Date(),
): Promise<{
    totalDpp: number;
    totalPpn: number;
    totalPph: number;
    totalClaim: number;
    submissionCount: number;
}> {
    const [aggregate] = await executor
        .select({
            totalDpp: sql<number>`COALESCE(SUM(${claimSubmission.totalDpp}), 0)`,
            totalPpn: sql<number>`COALESCE(SUM(${claimSubmission.totalPpn}), 0)`,
            totalPph: sql<number>`COALESCE(SUM(${claimSubmission.totalPph}), 0)`,
            totalClaim: sql<number>`COALESCE(SUM(${claimSubmission.totalClaim}), 0)`,
            submissionCount: sql<number>`COUNT(*)`,
        })
        .from(claimSubmission)
        .where(eq(claimSubmission.claimWorkflowId, workflowId));

    const totalDpp = Number(aggregate?.totalDpp || 0);
    const totalPpn = Number(aggregate?.totalPpn || 0);
    const totalPph = Number(aggregate?.totalPph || 0);
    const totalClaim = Number(aggregate?.totalClaim || 0);
    const submissionCount = Number(aggregate?.submissionCount || 0);

    // Ambil totalPaid + status existing untuk mempertahankan
    // remainingAmount (workflow level, R3) dan mirror aggregate_status.
    const [workflow] = await executor
        .select({
            totalPaid: claimWorkflow.totalPaid,
            status: claimWorkflow.status,
        })
        .from(claimWorkflow)
        .where(eq(claimWorkflow.id, workflowId));
    const totalPaid = Number(workflow?.totalPaid || 0);

    await executor
        .update(claimWorkflow)
        .set({
            totalDpp,
            totalPpn,
            totalPph,
            totalClaim,
            // remainingAmount tetap pakai formula R3 dengan totalPaid
            // existing supaya kompat dengan route payment yang akan
            // tetap menulis cache ini sampai R7d.
            remainingAmount: calculateRemainingAmount(totalClaim, totalPaid),
            aggregateStatus: workflow?.status ?? null,
            updatedAt: now,
        })
        .where(eq(claimWorkflow.id, workflowId));

    return { totalDpp, totalPpn, totalPph, totalClaim, submissionCount };
}

/**
 * Pastikan submission tertentu memang milik workflow yang dimaksud.
 * Throw error dengan kode standar bila tidak. Caller route diharapkan
 * meng-catch dan map ke 404/409.
 */
export async function assertSubmissionBelongsToWorkflow(
    submissionId: string,
    workflowId: string,
    executor: DbExecutor = db,
): Promise<ClaimSubmissionRow> {
    const [row] = await executor
        .select()
        .from(claimSubmission)
        .where(eq(claimSubmission.id, submissionId));
    if (!row) {
        throw Object.assign(new Error("Claim Submission not found"), {
            code: "CLAIM_SUBMISSION_NOT_FOUND",
            status: 404,
        });
    }
    if (row.claimWorkflowId !== workflowId) {
        throw Object.assign(new Error("Claim Submission tidak milik workflow ini."), {
            code: "CLAIM_SUBMISSION_WRONG_WORKFLOW",
            status: 409,
        });
    }
    return row;
}

/**
 * Cek apakah workflow + submission saat ini editable untuk operasi R7b
 * (create submission, assign item, edit scope/noClaim). Editable bila
 * workflow status `Draft` atau `Need Revision`. Lebih ketat dari window
 * existing untuk menghindari interaksi dengan dokumen/payment.
 */
export function isSubmissionEditableWorkflowStatus(status: string): boolean {
    return (
        status === claimSubmissionStatuses.draft ||
        status === claimSubmissionStatuses.needRevision
    );
}
