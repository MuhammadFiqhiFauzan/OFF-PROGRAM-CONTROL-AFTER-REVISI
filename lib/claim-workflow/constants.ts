/*
 * Tujuan: Status Claim Workflow production setelah cleanup PEKA/EC/CN.
 * Caller: Lib helpers (`audit`, `access`, `pdf`, …) dan API routes
 *         (`/api/claim-workflow/...`) plus UI di `app/(dashboard)/claim-workflow`.
 * Dependensi: Tidak ada runtime dependency. Hanya konstanta.
 * Side Effects: Tidak ada.
 *
 * Catatan cleanup PEKA (Mei 2026):
 * - Status `Waiting PEKA`, `EC Received`, dan `CN Received` dihapus.
 *   Workflow production sekarang langsung jalan
 *   `Submitted to Principal -> Partially Paid / Paid -> Closed`.
 * - Status `Outstanding` tetap dipertahankan sebagai label monitoring untuk
 *   klaim lewat deadline tanpa pembayaran. Dipakai oleh dashboard outstanding
 *   (R3 — Principal Payment + Outstanding) tanpa tergantung PEKA/EC/CN.
 * - Legacy DB row yang masih berisi `Waiting PEKA` / `EC Received` /
 *   `CN Received` ditangani lewat `LEGACY_PEKA_STATUSES` / `isLegacyPekaStatus`
 *   — UI menampilkannya sebagai fallback `Submitted to Principal` dan tidak
 *   menyediakan aksi transisi PEKA apapun.
 */
export const claimWorkflowStatuses = {
    draft: "Draft",
    needRevision: "Need Revision",
    readyToSubmit: "Ready to Submit",
    submittedToPrincipal: "Submitted to Principal",
    partiallyPaid: "Partially Paid",
    paid: "Paid",
    outstanding: "Outstanding",
    closed: "Closed",
    cancelled: "Cancelled",
} as const;

export type ClaimWorkflowStatus =
    (typeof claimWorkflowStatuses)[keyof typeof claimWorkflowStatuses];

export const claimWorkflowStatusList = Object.values(claimWorkflowStatuses);

/**
 * Legacy PEKA status labels yang mungkin masih ada di SQLite lama. Tidak
 * dipakai untuk transisi baru. Dipakai oleh helper `isLegacyPekaStatus`
 * dan `displayClaimStatusLabel` agar UI tetap bisa render row legacy
 * tanpa crash dan tanpa memunculkan kembali aksi PEKA.
 */
export const LEGACY_PEKA_STATUSES = [
    "Waiting PEKA",
    "EC Received",
    "CN Received",
] as const;

export type LegacyPekaStatus = (typeof LEGACY_PEKA_STATUSES)[number];

export function isLegacyPekaStatus(value: string | null | undefined): value is LegacyPekaStatus {
    if (!value) return false;
    return (LEGACY_PEKA_STATUSES as ReadonlyArray<string>).includes(value);
}

/**
 * Label aman untuk ditampilkan di UI. Status legacy PEKA dipetakan ke
 * `Submitted to Principal` agar konsisten dengan flow production yang
 * baru, tanpa menulis kembali ke DB.
 */
export function displayClaimStatusLabel(value: string | null | undefined): string {
    if (!value) return "Draft";
    if (isLegacyPekaStatus(value)) {
        return `${claimWorkflowStatuses.submittedToPrincipal} (legacy: ${value})`;
    }
    return value;
}

/**
 * Phase R1 — Rewire OFF ↔ Claim No Claim:
 * Claim Workflow boleh dibuat setelah OFF OM Approved. Tidak perlu menunggu
 * OFF Completed lagi. Persyaratan minimum dipersempit ke `omStatus = Approved`
 * sehingga claim user bisa mempersiapkan tax editing dan generate dokumen
 * klaim tanpa harus menunggu Finance Paid + Final Completed.
 *
 * OFF Completed tetap punya rule terpisah: butuh Finance Paid + No Claim
 * Claim Workflow + sync ke off_batch_item.no_claim. Lihat
 * app/api/off-program-control/batches/[id]/final-claim/route.ts.
 */
export const claimWorkflowOffRequirements = {
    omStatus: "Approved",
} as const;
