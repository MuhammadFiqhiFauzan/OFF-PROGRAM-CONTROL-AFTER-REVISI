import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    claimPayment,
    claimWorkflow,
    claimWorkflowItem,
    offBatch,
} from "@/db/schema";
import {
    canActorReadClaimWorkflow,
    requireClaimSession,
} from "@/lib/claim-workflow";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!canActorReadClaimWorkflow(actor)) {
        return NextResponse.json({ ok: false, error: "Role Anda tidak memiliki akses detail Claim Workflow." }, { status: 403 });
    }

    try {
        const { id } = await context.params;
        const [row] = await db
            .select({
                workflow: claimWorkflow,
                offNoPengajuan: offBatch.noPengajuan,
            })
            .from(claimWorkflow)
            .leftJoin(offBatch, eq(claimWorkflow.offBatchId, offBatch.id))
            .where(eq(claimWorkflow.id, id));

        if (!row) {
            return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
        }

        const items = await db
            .select()
            .from(claimWorkflowItem)
            .where(eq(claimWorkflowItem.claimWorkflowId, id));
        const payments = await db
            .select()
            .from(claimPayment)
            .where(eq(claimPayment.claimWorkflowId, id))
            .orderBy(asc(claimPayment.createdAt));

        return NextResponse.json({
            ok: true,
            workflow: {
                ...row.workflow,
                offNoPengajuan: row.offNoPengajuan,
            },
            items,
            payments,
        });
    } catch (error) {
        console.error("[CLAIM WORKFLOW DETAIL ERROR]", error);
        return NextResponse.json({ ok: false, error: "Gagal mengambil detail Claim Workflow." }, { status: 500 });
    }
}
