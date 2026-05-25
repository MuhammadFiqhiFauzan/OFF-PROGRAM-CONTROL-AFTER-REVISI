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

export const claimWorkflowOffRequirements = {
    status: "Completed",
    financeStatus: "Paid",
    finalStatus: "Completed",
} as const;
