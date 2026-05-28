/*
 * Tujuan: Helper minimal untuk Phase R7a — Multi No Claim + Direct Claim
 *         Source. Berisi pure function yang memetakan `claim_workflow`
 *         existing ke shape default `claim_submission` saat backfill.
 * Caller: scripts/migrate-r7a-default-submission.mjs (CommonJS-ish via
 *         dynamic import) dan future route handler R7b yang membuat
 *         submission baru. Tidak dipakai oleh route R1-R6.
 * Dependensi: Hanya tipe dari ./types dan konstanta dari ./constants.
 *             TIDAK mengakses DB di file ini supaya bebas dipakai oleh
 *             script Node maupun runtime Next.js.
 * Side Effects: Tidak ada (pure function).
 *
 * Catatan kunci:
 * - Helper TIDAK menulis DB. Migration script bertanggung jawab atas
 *   transaksi, FK, dan ID generation.
 * - Helper TIDAK memutuskan apakah submission sudah ada atau belum.
 *   Caller harus melakukan pre-check sebelum memanggil
 *   `buildDefaultSubmissionFromWorkflow`.
 * - `claimSubmissionStatuses` di-mirror dari status workflow apa adanya
 *   supaya backfill tidak mengubah status row lama. Status legacy PEKA
 *   (`Waiting PEKA`, `EC Received`, `CN Received`) bila masih ada di
 *   row legacy tetap dibawa apa adanya — UI sudah punya
 *   `displayClaimStatusLabel` untuk menanganinya. Migration sengaja
 *   tidak ikut "memperbaiki" status karena itu di luar scope R7a.
 */
import { claimSubmissionScopes } from "./constants";
import type { ClaimSubmissionRow, ClaimWorkflowRow } from "./types";

/**
 * Hasilkan label scope default untuk submission backfill. Mengikuti
 * preferensi user di prompt R7a: pakai `claimWorkflowNo` kalau ada,
 * fallback ke `"Pengajuan utama"`.
 */
export function getDefaultSubmissionScopeLabel(workflow: Pick<ClaimWorkflowRow, "claimWorkflowNo">): string {
    const trimmed = String(workflow.claimWorkflowNo ?? "").trim();
    return trimmed.length > 0 ? trimmed : "Pengajuan utama";
}

/**
 * Field-field claim_submission yang dihasilkan dari satu claim_workflow.
 * Sengaja tidak menyertakan `id` dan `claimWorkflowId` supaya caller
 * (migration script) yang menentukan ID dan referensi parent.
 */
export type DefaultSubmissionDraft = Omit<ClaimSubmissionRow, "id" | "claimWorkflowId">;

/**
 * Bentuk satu draft `claim_submission` dari row `claim_workflow` lama.
 * Tujuan utama: saat backfill, satu submission default mewakili seluruh
 * workflow lama (1 No Claim per workflow → 1 submission).
 *
 * Aturan mapping:
 * - `noClaim` + assigned metadata → diturunkan dari workflow.
 * - `scope` selalu `per_pengajuan` untuk default.
 * - `scopeLabel` pakai `claimWorkflowNo` atau "Pengajuan utama".
 * - `status` dimirror dari workflow (lihat catatan PEKA legacy di atas).
 * - Totals + dokumen + close metadata mengikuti workflow apa adanya.
 * - `createdAt` dipakai dari workflow supaya audit timeline tetap masuk
 *   akal saat row submission baru muncul. `updatedAt` dipakai dari `now`
 *   yang dipassing caller.
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
