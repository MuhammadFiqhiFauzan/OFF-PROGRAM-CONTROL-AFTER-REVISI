import {
    claimAuditLog,
    claimPayment,
    claimWorkflow,
    claimWorkflowItem,
} from "@/db/schema";
import type { OffActor } from "@/lib/off-program-control";

export type ClaimActor = OffActor;
export type ClaimWorkflowRow = typeof claimWorkflow.$inferSelect;
export type ClaimWorkflowItemRow = typeof claimWorkflowItem.$inferSelect;
export type ClaimPaymentRow = typeof claimPayment.$inferSelect;
export type ClaimAuditLogRow = typeof claimAuditLog.$inferSelect;

export type ClaimAmountCalculation = {
    dpp: number;
    ppnRate: number;
    ppnAmount: number;
    pphRate: number;
    pphAmount: number;
    nilaiKlaim: number;
};
