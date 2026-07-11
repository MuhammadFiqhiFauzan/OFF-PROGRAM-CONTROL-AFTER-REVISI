import {
  offStatuses,
  offSmStatuses,
  offClaimStatuses,
  offOmStatuses,
  offFinalStatuses,
  offFinanceStatuses,
  type OffBatchStatus,
} from "./constants";
import type { OffBatchRow, OffItemRow, OffPaymentRow } from "./types";

export function canProcessFinancePayment(batch: OffBatchRow) {
  const payableStatuses = [
    offFinanceStatuses.waitingPayment,
    offFinanceStatuses.partialPaid,
    offFinanceStatuses.needCorrection,
  ] as string[];
  return (
    batch.smStatus === "Approved by SM" &&
    batch.claimStatus === "Approved" &&
    batch.omStatus === "Approved" &&
    payableStatuses.includes(batch.financeStatus)
  );
}

export function canOpenFinalClaim(batch: OffBatchRow) {
  return (
    batch.financeStatus === offFinanceStatuses.paid &&
    ["Waiting Claim Final Verification", "Incomplete Documents"].includes(
      batch.finalStatus,
    ) &&
    batch.status === "Paid"
  );
}

export function paymentsHaveProofs(payments: OffPaymentRow[]) {
  // Revisi B: bukti pembayaran tidak wajib untuk metode Tunai.
  // Untuk Transfer/non-tunai bukti tetap wajib.
  return (
    payments.length > 0 &&
    payments.every((payment) => {
      const method = String(payment.paymentMethod || "").trim().toLowerCase();
      if (method === "tunai") return true;
      return payment.paymentProofPath && payment.paymentProofName;
    })
  );
}

type BatchProgressSource = {
  // string fallback diperlukan karena Drizzle menginfer status sebagai string,
  // bukan OffBatchStatus. Union memastikan literal baru di fungsi ini tetap
  // tervalidasi terhadap konstanta yang terdaftar.
  status: OffBatchStatus | string;
  financeStatus: string;
  finalStatus: string;
  omStatus: string;
  claimStatus: string;
  smStatus: string;
};

type FinalChecklistSource = Pick<
  OffItemRow,
  | "finalKwt"
  | "finalSkp"
  | "finalFp"
  | "finalPc"
  | "finalFoto"
  | "finalRekap"
  | "finalOthers"
>;

export function computeBatchProgress(batch: BatchProgressSource): number {
  const status = batch.status;
  const financeStatus = batch.financeStatus;
  const finalStatus = batch.finalStatus;

  if (status === offStatuses.cancelled || status === offStatuses.cancelledByOm) return 0;
  if (finalStatus === offFinalStatuses.completed || status === offStatuses.completed) return 100;
  if (finalStatus === offFinalStatuses.fullyRefunded) return 100;
  if (
    finalStatus === offFinalStatuses.pendingRefund ||
    finalStatus === offFinalStatuses.partiallyRefunded ||
    // ponytail: status legacy — tidak lagi ditulis ke DB baru, dipertahankan
    // agar baris lama tetap mendapat progress 92 bukan fallback 10.
    status === offStatuses.overpaidPendingRefund
  ) return 92;
  if (finalStatus === offFinalStatuses.incompleteDocuments) return 90;
  if (
    finalStatus === offFinalStatuses.waitingClaimFinalVerification ||
    status === offStatuses.paid
  ) return 85;
  if (financeStatus === offFinanceStatuses.partialPaid || status === offStatuses.partialPaid) return 75;
  if (
    batch.omStatus === offOmStatuses.approved &&
    ([offFinanceStatuses.waitingPayment, offFinanceStatuses.notStarted] as string[]).includes(financeStatus)
  ) return 65;
  if (
    batch.claimStatus === offClaimStatuses.approved ||
    status === offStatuses.claimApproved
    // ponytail: "Ready for OM" dan "Waiting OM" dihapus — status legacy yang
    // tidak lagi ditulis ke DB. Data lama dengan nilai ini akan fallback ke 10
    // (Draft level), yang acceptable untuk record orphan.
  ) return 50;
  if (batch.smStatus === offSmStatuses.approvedBySm || status === offStatuses.approvedBySm) return 35;
  if (status === offStatuses.submittedToSm || batch.smStatus === offSmStatuses.waitingReview) return 20;
  if (
    status === offStatuses.draft ||
    status === offStatuses.returnedBySm ||
    status === offStatuses.returnedByClaim
  ) return 10;
  return 10;
}

export function hasMinimalFinalChecklist(item: FinalChecklistSource): boolean {
  return Boolean(
    item.finalKwt ||
    item.finalSkp ||
    item.finalFp ||
    item.finalPc ||
    item.finalFoto ||
    item.finalRekap ||
    item.finalOthers,
  );
}
