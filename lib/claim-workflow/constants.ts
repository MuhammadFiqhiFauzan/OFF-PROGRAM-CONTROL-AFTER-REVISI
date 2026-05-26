export const claimWorkflowStatuses = {
    draft: "Draft",
    readyToSubmit: "Ready to Submit",
    submittedToPrincipal: "Submitted to Principal",
    waitingPeka: "Waiting PEKA",
    ecReceived: "EC Received",
    cnReceived: "CN Received",
    partiallyPaid: "Partially Paid",
    paid: "Paid",
    outstanding: "Outstanding",
    closed: "Closed",
    needRevision: "Need Revision",
    cancelled: "Cancelled",
} as const;

export type ClaimWorkflowStatus =
    (typeof claimWorkflowStatuses)[keyof typeof claimWorkflowStatuses];

export const claimWorkflowStatusList = Object.values(claimWorkflowStatuses);

/**
 * Phase R1 — Rewire OFF ↔ Claim No Claim:
 * Claim Workflow boleh dibuat setelah OFF OM Approved. Tidak perlu menunggu
 * OFF Completed lagi. Persyaratan minimum dipersempit ke `omStatus = Approved`
 * sehingga claim user bisa mempersiapkan tax editing dan generate claim
 * letter PDF tanpa harus menunggu Finance Paid + Final Completed.
 *
 * OFF Completed tetap punya rule terpisah: butuh Finance Paid + No Claim
 * Claim Workflow + sync ke off_batch_item.no_claim. Lihat
 * app/api/off-program-control/batches/[id]/final-claim/route.ts.
 */
export const claimWorkflowOffRequirements = {
    omStatus: "Approved",
} as const;
