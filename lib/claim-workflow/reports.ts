/*
 * Tujuan: Helper builder + CSV serializer untuk Phase R5 Reporting/Export.
 *         Mengonsolidasi query Claim Workflow + Claim Payment menjadi
 *         baris-baris siap tampil/ekspor untuk tiga report:
 *         Summary, Paid (transaction-based), Outstanding.
 * Caller: app/api/claim-workflow/reports/* (JSON + CSV) dan UI report
 *         page. Helper tidak menulis DB.
 * Dependensi: drizzle-orm, lib/claim-workflow/calculations.
 * Side Effects: Tidak ada (read-only).
 *
 * Catatan kunci:
 * - `totalPaid` per workflow di-recalc dari `claim_payment` aktif (voided_at NULL).
 * - `remainingAmount = max(totalClaim - totalPaid, 0)` (helper R3).
 * - Tidak ada kolom PEKA/EC/CN. Workflow legacy PEKA statuses tetap
 *   ditampilkan apa adanya supaya tidak hilang dari recap.
 */
import { and, asc, count, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimPayment, claimWorkflow, claimWorkflowItem, offBatch } from "@/db/schema";
import { calculateRemainingAmount, sumActivePayments } from "./calculations";
import {
    LEGACY_PEKA_STATUSES,
    claimWorkflowStatuses,
    claimWorkflowStatusList,
} from "./constants";

// =============================================================================
// CSV serializer
// =============================================================================

/**
 * Escape satu cell CSV mengikuti RFC 4180:
 * - Bungkus dengan double-quote bila value mengandung koma, double-quote,
 *   newline, carriage return, atau leading/trailing whitespace.
 * - Double-quote di dalam value di-escape menjadi `""`.
 * - null/undefined → empty string.
 * - Number diserialisasi tanpa locale (no thousand separator).
 */
export function escapeCsvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    let text: string;
    if (value instanceof Date) {
        text = Number.isFinite(value.getTime()) ? value.toISOString() : "";
    } else if (typeof value === "number") {
        if (!Number.isFinite(value)) return "";
        text = String(value);
    } else if (typeof value === "boolean") {
        text = value ? "true" : "false";
    } else {
        text = String(value);
    }
    const needsQuote = /[",\r\n]/.test(text) || /^\s|\s$/.test(text);
    if (!needsQuote) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Serialisasi rows ke string CSV. Header otomatis dibangun dari urutan
 * `columns`. UTF-8 BOM ditambahkan supaya Excel di Windows membaca tabel
 * bahasa Indonesia dengan benar (Rp, é, dst.).
 */
export function rowsToCsv<T extends Record<string, unknown>>(
    columns: ReadonlyArray<{ key: keyof T & string; label: string }>,
    rows: ReadonlyArray<T>,
): string {
    const header = columns.map((col) => escapeCsvCell(col.label)).join(",");
    const body = rows
        .map((row) => columns.map((col) => escapeCsvCell(row[col.key])).join(","))
        .join("\r\n");
    const csv = body.length > 0 ? `${header}\r\n${body}\r\n` : `${header}\r\n`;
    return `\uFEFF${csv}`;
}

export function todayStamp(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

// =============================================================================
// Filters
// =============================================================================

export type CommonReportFilters = {
    status?: string | null;
    principleCode?: string | null;
    dateFrom?: string | null; // YYYY-MM-DD inclusive
    dateTo?: string | null; // YYYY-MM-DD inclusive
};

export type SummaryReportFilters = CommonReportFilters & {
    onlyOpen?: boolean;
};

export type PaidReportFilters = CommonReportFilters & {
    includeVoided?: boolean;
};

export type OutstandingReportFilters = Pick<CommonReportFilters, "status" | "principleCode">;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateStartOfDay(value: string | null | undefined): Date | null {
    if (!value || !ISO_DATE_RE.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) ? date : null;
}

function parseIsoDateEndOfDay(value: string | null | undefined): Date | null {
    if (!value || !ISO_DATE_RE.test(value)) return null;
    const date = new Date(`${value}T23:59:59.999Z`);
    return Number.isFinite(date.getTime()) ? date : null;
}

function isKnownStatus(value: string | null | undefined): value is string {
    if (!value) return false;
    if ((claimWorkflowStatusList as ReadonlyArray<string>).includes(value)) return true;
    if ((LEGACY_PEKA_STATUSES as ReadonlyArray<string>).includes(value)) return true;
    return false;
}

// =============================================================================
// Aggregation helpers
// =============================================================================

type WorkflowRow = typeof claimWorkflow.$inferSelect;

type PaymentSlim = {
    id: string;
    claimWorkflowId: string;
    paymentDate: string;
    paymentAmount: number;
    paymentType: string | null;
    paymentNote: string | null;
    createdBy: string | null;
    createdAt: Date;
    voidedAt: Date | null;
    voidedBy: string | null;
    voidReason: string | null;
};

async function loadPaymentsForWorkflows(workflowIds: ReadonlyArray<string>): Promise<Map<string, PaymentSlim[]>> {
    const map = new Map<string, PaymentSlim[]>();
    if (workflowIds.length === 0) return map;
    // SQLite param limit ~999 — chunk defensif walau dataset internal kecil.
    const CHUNK = 400;
    for (let i = 0; i < workflowIds.length; i += CHUNK) {
        const slice = workflowIds.slice(i, i + CHUNK);
        const rows = await db
            .select({
                id: claimPayment.id,
                claimWorkflowId: claimPayment.claimWorkflowId,
                paymentDate: claimPayment.paymentDate,
                paymentAmount: claimPayment.paymentAmount,
                paymentType: claimPayment.paymentType,
                paymentNote: claimPayment.paymentNote,
                createdBy: claimPayment.createdBy,
                createdAt: claimPayment.createdAt,
                voidedAt: claimPayment.voidedAt,
                voidedBy: claimPayment.voidedBy,
                voidReason: claimPayment.voidReason,
            })
            .from(claimPayment)
            .where(inArray(claimPayment.claimWorkflowId, slice as string[]))
            .orderBy(asc(claimPayment.paymentDate), asc(claimPayment.createdAt));
        for (const row of rows) {
            const existing = map.get(row.claimWorkflowId);
            if (existing) {
                existing.push(row);
            } else {
                map.set(row.claimWorkflowId, [row]);
            }
        }
    }
    return map;
}

function isoDateOnly(value: Date | null | undefined): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

// =============================================================================
// Summary Report
// =============================================================================

export type SummaryReportRow = {
    claimWorkflowNo: string;
    noClaim: string | null;
    principleCode: string;
    principleName: string;
    status: string;
    totalDpp: number;
    totalPpn: number;
    totalPph: number;
    totalClaim: number;
    totalPaid: number;
    remainingAmount: number;
    itemCount: number;
    submittedToPrincipalAt: string | null;
    closedAt: string | null;
    createdAt: string;
    offBatchId: string;
    offNoPengajuan: string | null;
};

const OPEN_STATUSES = [
    claimWorkflowStatuses.draft,
    claimWorkflowStatuses.needRevision,
    claimWorkflowStatuses.readyToSubmit,
    claimWorkflowStatuses.submittedToPrincipal,
    claimWorkflowStatuses.partiallyPaid,
    claimWorkflowStatuses.outstanding,
    ...LEGACY_PEKA_STATUSES,
] as const;

export async function buildSummaryReport(filters: SummaryReportFilters): Promise<SummaryReportRow[]> {
    const conditions: SQL[] = [];
    if (isKnownStatus(filters.status ?? null)) {
        conditions.push(eq(claimWorkflow.status, filters.status as string));
    }
    if (filters.principleCode) {
        conditions.push(eq(claimWorkflow.principleCode, filters.principleCode));
    }
    const dateFrom = parseIsoDateStartOfDay(filters.dateFrom ?? null);
    const dateTo = parseIsoDateEndOfDay(filters.dateTo ?? null);
    if (dateFrom) conditions.push(gte(claimWorkflow.createdAt, dateFrom));
    if (dateTo) conditions.push(lte(claimWorkflow.createdAt, dateTo));
    if (filters.onlyOpen) {
        conditions.push(inArray(claimWorkflow.status, OPEN_STATUSES as unknown as string[]));
    }

    const baseQuery = db
        .select({
            workflow: claimWorkflow,
            offNoPengajuan: offBatch.noPengajuan,
        })
        .from(claimWorkflow)
        .leftJoin(offBatch, eq(claimWorkflow.offBatchId, offBatch.id));
    const filtered = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
    const rows = await filtered.orderBy(desc(claimWorkflow.createdAt));

    const workflowIds = rows.map((r) => r.workflow.id);
    const paymentsByWorkflow = await loadPaymentsForWorkflows(workflowIds);

    // itemCount per workflow: satu round-trip GROUP BY supaya report tetap
    // murah. SQLite mendukung COUNT(*) tanpa drizzle helper khusus.
    const itemCountMap = new Map<string, number>();
    if (workflowIds.length > 0) {
        const itemRows = await db
            .select({
                claimWorkflowId: claimWorkflowItem.claimWorkflowId,
                count: count(claimWorkflowItem.id),
            })
            .from(claimWorkflowItem)
            .where(inArray(claimWorkflowItem.claimWorkflowId, workflowIds as string[]))
            .groupBy(claimWorkflowItem.claimWorkflowId);
        for (const row of itemRows) {
            itemCountMap.set(row.claimWorkflowId, Number(row.count || 0));
        }
    }

    return rows.map(({ workflow: w, offNoPengajuan }) => {
        const totalClaim = Number(w.totalClaim || 0);
        const payments = paymentsByWorkflow.get(w.id) ?? [];
        const totalPaid = sumActivePayments(payments);
        const remainingAmount = calculateRemainingAmount(totalClaim, totalPaid);
        return {
            claimWorkflowNo: w.claimWorkflowNo,
            noClaim: w.noClaim,
            principleCode: w.principleCode,
            principleName: w.principleName,
            status: w.status,
            totalDpp: Number(w.totalDpp || 0),
            totalPpn: Number(w.totalPpn || 0),
            totalPph: Number(w.totalPph || 0),
            totalClaim,
            totalPaid,
            remainingAmount,
            itemCount: itemCountMap.get(w.id) ?? 0,
            submittedToPrincipalAt: w.submittedToPrincipalAt
                ? new Date(w.submittedToPrincipalAt).toISOString()
                : null,
            closedAt: w.closedAt ? new Date(w.closedAt).toISOString() : null,
            createdAt: new Date(w.createdAt).toISOString(),
            offBatchId: w.offBatchId,
            offNoPengajuan,
        } satisfies SummaryReportRow;
    });
}

export const SUMMARY_REPORT_COLUMNS: ReadonlyArray<{ key: keyof SummaryReportRow & string; label: string }> = [
    { key: "claimWorkflowNo", label: "Claim Workflow No" },
    { key: "noClaim", label: "No Claim" },
    { key: "principleCode", label: "Principle Code" },
    { key: "principleName", label: "Principle Name" },
    { key: "status", label: "Status" },
    { key: "totalDpp", label: "Total DPP" },
    { key: "totalPpn", label: "Total PPN" },
    { key: "totalPph", label: "Total PPH" },
    { key: "totalClaim", label: "Total Claim" },
    { key: "totalPaid", label: "Total Paid" },
    { key: "remainingAmount", label: "Remaining Amount" },
    { key: "itemCount", label: "Item Count" },
    { key: "submittedToPrincipalAt", label: "Submitted To Principal At" },
    { key: "closedAt", label: "Closed At" },
    { key: "createdAt", label: "Created At" },
    { key: "offBatchId", label: "OFF Batch Id" },
    { key: "offNoPengajuan", label: "OFF No Pengajuan" },
];

// =============================================================================
// Paid Report (transaction-based)
// =============================================================================

export type PaidReportRow = {
    paymentId: string;
    claimWorkflowId: string;
    claimWorkflowNo: string;
    noClaim: string | null;
    principleCode: string;
    principleName: string;
    paymentDate: string;
    paymentAmount: number;
    paymentType: string | null;
    paymentNote: string | null;
    workflowTotalClaim: number;
    workflowTotalPaid: number;
    workflowRemainingAmount: number;
    workflowStatus: string;
    createdBy: string | null;
    createdAt: string;
    voidedAt: string | null;
    voidedBy: string | null;
    voidReason: string | null;
};

export async function buildPaidReport(filters: PaidReportFilters): Promise<PaidReportRow[]> {
    const workflowConditions: SQL[] = [];
    if (isKnownStatus(filters.status ?? null)) {
        workflowConditions.push(eq(claimWorkflow.status, filters.status as string));
    }
    if (filters.principleCode) {
        workflowConditions.push(eq(claimWorkflow.principleCode, filters.principleCode));
    }

    const baseWorkflow = db
        .select({
            workflow: claimWorkflow,
        })
        .from(claimWorkflow);
    const workflowsQuery = workflowConditions.length > 0
        ? baseWorkflow.where(and(...workflowConditions))
        : baseWorkflow;
    const workflowRows = await workflowsQuery;
    if (workflowRows.length === 0) return [];

    const workflowMap = new Map<string, WorkflowRow>();
    for (const row of workflowRows) workflowMap.set(row.workflow.id, row.workflow);

    const paymentsByWorkflow = await loadPaymentsForWorkflows([...workflowMap.keys()]);

    const includeVoided = Boolean(filters.includeVoided);
    const dateFrom = filters.dateFrom && ISO_DATE_RE.test(filters.dateFrom) ? filters.dateFrom : null;
    const dateTo = filters.dateTo && ISO_DATE_RE.test(filters.dateTo) ? filters.dateTo : null;

    const rows: PaidReportRow[] = [];
    for (const workflow of workflowMap.values()) {
        const payments = paymentsByWorkflow.get(workflow.id) ?? [];
        if (payments.length === 0) continue;
        const totalClaim = Number(workflow.totalClaim || 0);
        const totalPaid = sumActivePayments(payments);
        const remainingAmount = calculateRemainingAmount(totalClaim, totalPaid);
        for (const p of payments) {
            const isVoid = p.voidedAt !== null;
            if (!includeVoided && isVoid) continue;
            if (dateFrom && p.paymentDate < dateFrom) continue;
            if (dateTo && p.paymentDate > dateTo) continue;
            rows.push({
                paymentId: p.id,
                claimWorkflowId: workflow.id,
                claimWorkflowNo: workflow.claimWorkflowNo,
                noClaim: workflow.noClaim,
                principleCode: workflow.principleCode,
                principleName: workflow.principleName,
                paymentDate: p.paymentDate,
                paymentAmount: Number(p.paymentAmount || 0),
                paymentType: p.paymentType,
                paymentNote: p.paymentNote,
                workflowTotalClaim: totalClaim,
                workflowTotalPaid: totalPaid,
                workflowRemainingAmount: remainingAmount,
                workflowStatus: workflow.status,
                createdBy: p.createdBy,
                createdAt: new Date(p.createdAt).toISOString(),
                voidedAt: p.voidedAt ? new Date(p.voidedAt).toISOString() : null,
                voidedBy: p.voidedBy,
                voidReason: p.voidReason,
            });
        }
    }
    rows.sort((a, b) => {
        if (a.paymentDate === b.paymentDate) return a.createdAt.localeCompare(b.createdAt);
        return a.paymentDate.localeCompare(b.paymentDate);
    });
    return rows;
}

export const PAID_REPORT_COLUMNS: ReadonlyArray<{ key: keyof PaidReportRow & string; label: string }> = [
    { key: "paymentId", label: "Payment Id" },
    { key: "claimWorkflowNo", label: "Claim Workflow No" },
    { key: "noClaim", label: "No Claim" },
    { key: "principleCode", label: "Principle Code" },
    { key: "principleName", label: "Principle Name" },
    { key: "paymentDate", label: "Payment Date" },
    { key: "paymentAmount", label: "Payment Amount" },
    { key: "paymentType", label: "Payment Type" },
    { key: "paymentNote", label: "Payment Note" },
    { key: "workflowTotalClaim", label: "Workflow Total Claim" },
    { key: "workflowTotalPaid", label: "Workflow Total Paid" },
    { key: "workflowRemainingAmount", label: "Workflow Remaining Amount" },
    { key: "workflowStatus", label: "Workflow Status" },
    { key: "createdBy", label: "Created By" },
    { key: "createdAt", label: "Created At" },
    { key: "voidedAt", label: "Voided At" },
    { key: "voidedBy", label: "Voided By" },
    { key: "voidReason", label: "Void Reason" },
];

// =============================================================================
// Outstanding Report
// =============================================================================

export type OutstandingReportRow = {
    claimWorkflowNo: string;
    noClaim: string | null;
    principleCode: string;
    principleName: string;
    status: string;
    totalClaim: number;
    totalPaid: number;
    remainingAmount: number;
    submittedToPrincipalAt: string | null;
    latestPaymentDate: string | null;
    daysOutstanding: number | null;
    agingBucket: "0-30" | "31-60" | "61-90" | ">90" | "Unknown";
    offBatchId: string;
    offNoPengajuan: string | null;
};

const OUTSTANDING_STATUSES = [
    claimWorkflowStatuses.submittedToPrincipal,
    claimWorkflowStatuses.partiallyPaid,
    claimWorkflowStatuses.outstanding,
    ...LEGACY_PEKA_STATUSES,
] as const;

function bucketize(days: number | null): OutstandingReportRow["agingBucket"] {
    if (days === null) return "Unknown";
    if (days <= 30) return "0-30";
    if (days <= 60) return "31-60";
    if (days <= 90) return "61-90";
    return ">90";
}

export async function buildOutstandingReport(filters: OutstandingReportFilters): Promise<OutstandingReportRow[]> {
    const conditions: SQL[] = [];
    const requestedStatus = filters.status ?? null;
    if (requestedStatus && (OUTSTANDING_STATUSES as ReadonlyArray<string>).includes(requestedStatus)) {
        conditions.push(eq(claimWorkflow.status, requestedStatus));
    } else {
        conditions.push(inArray(claimWorkflow.status, OUTSTANDING_STATUSES as unknown as string[]));
    }
    if (filters.principleCode) {
        conditions.push(eq(claimWorkflow.principleCode, filters.principleCode));
    }

    const baseQuery = db
        .select({
            workflow: claimWorkflow,
            offNoPengajuan: offBatch.noPengajuan,
        })
        .from(claimWorkflow)
        .leftJoin(offBatch, eq(claimWorkflow.offBatchId, offBatch.id));
    const filtered = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
    const rows = await filtered.orderBy(desc(claimWorkflow.submittedToPrincipalAt));

    const workflowIds = rows.map((r) => r.workflow.id);
    const paymentsByWorkflow = await loadPaymentsForWorkflows(workflowIds);

    const now = Date.now();
    const out: OutstandingReportRow[] = [];
    for (const row of rows) {
        const totalClaim = Number(row.workflow.totalClaim || 0);
        const payments = paymentsByWorkflow.get(row.workflow.id) ?? [];
        const totalPaid = sumActivePayments(payments);
        const remainingAmount = calculateRemainingAmount(totalClaim, totalPaid);
        if (remainingAmount <= 0) continue;
        const activePayments = payments.filter((p) => p.voidedAt === null);
        const latestPaymentDate = activePayments.length > 0
            ? activePayments[activePayments.length - 1].paymentDate
            : null;
        const submittedAt = row.workflow.submittedToPrincipalAt
            ? new Date(row.workflow.submittedToPrincipalAt)
            : null;
        const days = submittedAt && Number.isFinite(submittedAt.getTime())
            ? Math.max(0, Math.floor((now - submittedAt.getTime()) / (1000 * 60 * 60 * 24)))
            : null;
        out.push({
            claimWorkflowNo: row.workflow.claimWorkflowNo,
            noClaim: row.workflow.noClaim,
            principleCode: row.workflow.principleCode,
            principleName: row.workflow.principleName,
            status: row.workflow.status,
            totalClaim,
            totalPaid,
            remainingAmount,
            submittedToPrincipalAt: submittedAt ? submittedAt.toISOString() : null,
            latestPaymentDate,
            daysOutstanding: days,
            agingBucket: bucketize(days),
            offBatchId: row.workflow.offBatchId,
            offNoPengajuan: row.offNoPengajuan,
        });
    }
    return out;
}

export const OUTSTANDING_REPORT_COLUMNS: ReadonlyArray<{ key: keyof OutstandingReportRow & string; label: string }> = [
    { key: "claimWorkflowNo", label: "Claim Workflow No" },
    { key: "noClaim", label: "No Claim" },
    { key: "principleCode", label: "Principle Code" },
    { key: "principleName", label: "Principle Name" },
    { key: "status", label: "Status" },
    { key: "totalClaim", label: "Total Claim" },
    { key: "totalPaid", label: "Total Paid" },
    { key: "remainingAmount", label: "Remaining Amount" },
    { key: "submittedToPrincipalAt", label: "Submitted To Principal At" },
    { key: "latestPaymentDate", label: "Latest Payment Date" },
    { key: "daysOutstanding", label: "Days Outstanding" },
    { key: "agingBucket", label: "Aging Bucket" },
    { key: "offBatchId", label: "OFF Batch Id" },
    { key: "offNoPengajuan", label: "OFF No Pengajuan" },
];

// =============================================================================
// Untyped util re-export (jaga isoDateOnly tidak unused warning)
// =============================================================================

export const __reportInternal = { isoDateOnly };
