import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { claimAuditLog } from "@/db/schema";
import type { ClaimActor } from "./types";

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

type AuditWriter = Pick<typeof db, "insert">;

export async function writeClaimAudit(input: {
    claimWorkflowId: string;
    actor?: ClaimActor | null;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    note?: string | null;
    metadata?: unknown;
}, writer: AuditWriter = db) {
    await writer.insert(claimAuditLog).values({
        id: randomUUID(),
        claimWorkflowId: input.claimWorkflowId,
        actorId: input.actor?.id || null,
        actorName: input.actor?.name || null,
        actorRole: input.actor?.role || null,
        action: input.action,
        fromStatus: input.fromStatus || null,
        toStatus: input.toStatus || null,
        note: input.note || null,
        metadata: normalizeMetadata(input.metadata),
        createdAt: new Date(),
    });
}
