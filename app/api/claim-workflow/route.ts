import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimWorkflow, offBatch } from "@/db/schema";
import {
    canActorReadClaimWorkflow,
    claimWorkflowStatusList,
    requireClaimSession,
} from "@/lib/claim-workflow";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(value: string | null): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function parseCursor(value: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!canActorReadClaimWorkflow(actor)) {
        return NextResponse.json({ ok: false, error: "Role Anda tidak memiliki akses Claim Workflow." }, { status: 403 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const limit = parseLimit(searchParams.get("limit"));
        const cursor = parseCursor(searchParams.get("cursor"));
        const statusFilter = searchParams.get("status");
        const principleCode = searchParams.get("principleCode");

        const conditions: SQL[] = [];
        if (statusFilter && claimWorkflowStatusList.includes(statusFilter as typeof claimWorkflowStatusList[number])) {
            conditions.push(eq(claimWorkflow.status, statusFilter));
        }
        if (principleCode) {
            conditions.push(eq(claimWorkflow.principleCode, principleCode));
        }
        if (cursor) {
            conditions.push(lt(claimWorkflow.createdAt, cursor));
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
        const rows = await filtered
            .orderBy(desc(claimWorkflow.createdAt))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const visibleRows = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore
            ? visibleRows[visibleRows.length - 1]?.workflow.createdAt?.toISOString() ?? null
            : null;

        return NextResponse.json({
            ok: true,
            workflows: visibleRows.map((row) => ({
                ...row.workflow,
                offNoPengajuan: row.offNoPengajuan,
            })),
            pagination: {
                limit,
                hasMore,
                nextCursor,
            },
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW LIST ERROR]", error);
        return NextResponse.json({ ok: false, error: "Gagal mengambil daftar Claim Workflow." }, { status: 500 });
    }
}
