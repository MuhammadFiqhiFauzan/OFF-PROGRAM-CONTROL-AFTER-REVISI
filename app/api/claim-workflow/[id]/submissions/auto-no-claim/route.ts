/*
 * Tujuan: Auto-generate dan assign No Claim massal untuk semua item di
 *         workflow. Sistem otomatis membuat/mengatur claim_submission
 *         berdasarkan grouping (root/follower). Item dengan No Claim sama
 *         masuk ke submission yang sama.
 *
 * Caller: UI detail page — area "Generate No Claim Massal".
 * Method: POST
 * Body: {
 *   startSequence: string;        // nomor awal (e.g. "01", "05")
 *   month: string;                // 2 digit bulan (e.g. "06")
 *   year: string | number;        // 4 digit tahun (e.g. "2026")
 *   variantKey?: string;          // opsional variant (e.g. "HZ" untuk HEINZ)
 *   rowModes: Array<{
 *     itemId: string;
 *     mode: "own" | "same_as";
 *     sameAsItemId?: string;       // wajib jika mode === "same_as"
 *   }>;
 * }
 *
 * Logic:
 *   1. Resolve root/leader per item (prevent circular via iterative resolve).
 *   2. Assign sequence number per unique root group.
 *   3. Generate No Claim string per group via no-claim-rules.
 *   4. Validate duplicate global.
 *   5. Create/update claim_submission per group.
 *   6. Assign items ke submission sesuai group.
 *   7. Recalc totals. Invalidate stale documents.
 *   8. Sync No Claim ke off_batch_item.
 *   9. Audit log.
 *
 * Side Effects: Writes claim_submission, claim_workflow_item.claim_submission_id,
 *   off_batch_item.no_claim, claim_workflow cache, claim_audit_log.
 *   Invalidates PDF documents if No Claim/group changes.
 */
import { unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
    claimSubmission,
    claimWorkflow,
    claimWorkflowItem,
    offBatchItem,
} from "@/db/schema";
import {
    claimAuditScopes,
    claimSubmissionScopes,
    claimSubmissionStatuses,
    claimWorkflowStatuses,
    getOffFinanceGateForNoClaim,
    isPathInsideClaimDocumentRoot,
    isSubmissionEditableWorkflowStatus,
    NO_CLAIM_MAX_LENGTH,
    recalcSubmissionTotals,
    recalcWorkflowAggregateFromSubmissions,
    requireClaimSession,
    writeClaimAudit,
} from "@/lib/claim-workflow";
import {
    buildNoClaimFromRule,
    resolveNoClaimRule,
    formatNoClaimSequenceFromRule,
} from "@/lib/claim-workflow/no-claim-rules";

type Context = { params: Promise<{ id: string }> };

type RowMode = {
    itemId: string;
    mode: "own" | "same_as";
    sameAsItemId?: string;
};

type RequestBody = {
    startSequence?: unknown;
    month?: unknown;
    year?: unknown;
    variantKey?: unknown;
    rowModes?: unknown;
};

function isValidRowModes(value: unknown): value is RowMode[] {
    if (!Array.isArray(value)) return false;
    return value.every(
        (row) =>
            row &&
            typeof row === "object" &&
            typeof row.itemId === "string" &&
            (row.mode === "own" || row.mode === "same_as") &&
            (row.mode === "own" || typeof row.sameAsItemId === "string"),
    );
}

/**
 * Resolve root for each item. A root is an item that is "own" (leader).
 * If item B says "same_as A", and A says "same_as C", then root(B) = root(A) = C.
 * Max depth to prevent infinite loops = number of items.
 */
function resolveRoots(rowModes: RowMode[]): Map<string, string> {
    const modeMap = new Map<string, RowMode>();
    for (const rm of rowModes) modeMap.set(rm.itemId, rm);

    const rootCache = new Map<string, string>();

    function findRoot(itemId: string): string {
        if (rootCache.has(itemId)) return rootCache.get(itemId)!;

        const visited = new Set<string>();
        let current = itemId;
        while (true) {
            if (visited.has(current)) {
                // Circular detected — break, make this item its own root
                rootCache.set(itemId, itemId);
                return itemId;
            }
            visited.add(current);
            const mode = modeMap.get(current);
            if (!mode || mode.mode === "own" || !mode.sameAsItemId) {
                // Found the root
                // Cache all visited items to this root
                for (const v of visited) rootCache.set(v, current);
                return current;
            }
            current = mode.sameAsItemId;
        }
    }

    for (const rm of rowModes) {
        findRoot(rm.itemId);
    }
    return rootCache;
}

export async function POST(request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (actor.role !== "admin" && actor.role !== "claim") {
        return NextResponse.json({
            ok: false,
            code: "CLAIM_WORKFLOW_FORBIDDEN",
            error: "Hanya role admin atau claim yang dapat generate No Claim massal.",
        }, { status: 403 });
    }

    let body: RequestBody = {};
    if (request.headers.get("content-type")?.includes("application/json")) {
        body = await request.json().catch(() => ({}));
    }

    // Validate inputs
    const startSequence = String(body.startSequence ?? "").trim();
    const month = String(body.month ?? "").trim();
    const year = String(body.year ?? "").trim();
    const variantKey = body.variantKey ? String(body.variantKey).trim() : undefined;

    if (!startSequence) {
        return NextResponse.json({ ok: false, code: "MISSING_START_SEQUENCE", error: "startSequence wajib diisi." }, { status: 400 });
    }
    if (!/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12) {
        return NextResponse.json({ ok: false, code: "INVALID_MONTH", error: "month harus 2 digit (01-12)." }, { status: 400 });
    }
    if (!/^\d{4}$/.test(year)) {
        return NextResponse.json({ ok: false, code: "INVALID_YEAR", error: "year harus 4 digit." }, { status: 400 });
    }
    if (!isValidRowModes(body.rowModes)) {
        return NextResponse.json({ ok: false, code: "INVALID_ROW_MODES", error: "rowModes harus array valid dengan itemId + mode." }, { status: 400 });
    }
    const rowModes = body.rowModes as RowMode[];
    if (rowModes.length === 0) {
        return NextResponse.json({ ok: false, code: "EMPTY_ROW_MODES", error: "rowModes tidak boleh kosong." }, { status: 400 });
    }

    try {
        const { id } = await context.params;

        const result = await db.transaction(async (tx) => {
            // 1. Load workflow
            const [workflow] = await tx.select().from(claimWorkflow).where(eq(claimWorkflow.id, id));
            if (!workflow) {
                return { error: { status: 404, code: "CLAIM_WORKFLOW_NOT_FOUND", message: "Claim Workflow not found" } } as const;
            }
            if (!isSubmissionEditableWorkflowStatus(workflow.status)) {
                return {
                    error: {
                        status: 409,
                        code: "CLAIM_WORKFLOW_STATUS_LOCKED",
                        message: `Auto No Claim hanya bisa saat workflow Draft atau Need Revision. Status: ${workflow.status}.`,
                    },
                } as const;
            }

            // 2. Finance gate
            const offFinanceGate = await getOffFinanceGateForNoClaim(tx, workflow.offBatchId);
            if (!offFinanceGate.isPaid) {
                return {
                    error: {
                        status: 409,
                        code: "OFF_FINANCE_NOT_PAID_FOR_NO_CLAIM",
                        message: offFinanceGate.reason || "Menunggu validasi keuangan OFF Program. No Claim baru bisa dibuat setelah Finance OFF Paid.",
                    },
                } as const;
            }

            // 3. Load all items for this workflow
            const allItems = await tx
                .select()
                .from(claimWorkflowItem)
                .where(eq(claimWorkflowItem.claimWorkflowId, id));
            const itemMap = new Map(allItems.map((item) => [item.id, item]));

            // Validate all itemIds in rowModes exist
            for (const rm of rowModes) {
                if (!itemMap.has(rm.itemId)) {
                    return {
                        error: {
                            status: 400,
                            code: "INVALID_ITEM_ID",
                            message: `Item ${rm.itemId} tidak ditemukan di workflow ini.`,
                        },
                    } as const;
                }
                if (rm.mode === "same_as" && rm.sameAsItemId && !itemMap.has(rm.sameAsItemId)) {
                    return {
                        error: {
                            status: 400,
                            code: "INVALID_SAME_AS_ITEM_ID",
                            message: `Target sameAsItemId ${rm.sameAsItemId} tidak ditemukan di workflow ini.`,
                        },
                    } as const;
                }
            }

            // 4. Resolve root groups
            const rootMap = resolveRoots(rowModes);

            // Group items by root
            const groups = new Map<string, string[]>(); // rootItemId -> [itemId, ...]
            for (const rm of rowModes) {
                const root = rootMap.get(rm.itemId) ?? rm.itemId;
                const group = groups.get(root) ?? [];
                group.push(rm.itemId);
                groups.set(root, group);
            }

            // 5. Generate No Claim per group (sorted by root order in rowModes)
            const rule = resolveNoClaimRule(workflow.principleCode, variantKey);
            const startNum = Number(startSequence) || 1;
            const mm = month.padStart(2, "0");

            // Order roots by their first appearance in rowModes
            const orderedRoots: string[] = [];
            const seenRoots = new Set<string>();
            for (const rm of rowModes) {
                const root = rootMap.get(rm.itemId) ?? rm.itemId;
                if (!seenRoots.has(root)) {
                    seenRoots.add(root);
                    orderedRoots.push(root);
                }
            }

            const generatedNoClaims = new Map<string, string>(); // rootItemId -> noClaim
            for (let i = 0; i < orderedRoots.length; i++) {
                const root = orderedRoots[i];
                const seq = String(startNum + i);
                let noClaim = "";
                if (rule) {
                    noClaim = buildNoClaimFromRule(rule, { sequence: seq, month: mm, year });
                }
                if (!noClaim) {
                    // Fallback
                    const formatted = seq.length === 1 ? seq.padStart(2, "0") : seq;
                    noClaim = `${formatted}/CLAIM/${mm}/${year}`;
                }
                if (noClaim.length > NO_CLAIM_MAX_LENGTH) {
                    return {
                        error: {
                            status: 400,
                            code: "NO_CLAIM_TOO_LONG",
                            message: `No Claim generated "${noClaim}" melebihi batas ${NO_CLAIM_MAX_LENGTH} karakter.`,
                        },
                    } as const;
                }
                generatedNoClaims.set(root, noClaim);
            }

            // 6. Validate no duplicate globally (against existing submissions NOT in this workflow)
            const noClaimValues = [...new Set(generatedNoClaims.values())];
            for (const nc of noClaimValues) {
                const [dup] = await tx
                    .select({ id: claimSubmission.id, claimWorkflowId: claimSubmission.claimWorkflowId })
                    .from(claimSubmission)
                    .where(
                        and(
                            eq(claimSubmission.noClaim, nc),
                            ne(claimSubmission.claimWorkflowId, id),
                        ),
                    );
                if (dup) {
                    return {
                        error: {
                            status: 409,
                            code: "NO_CLAIM_DUPLICATE",
                            message: `No Claim "${nc}" sudah dipakai workflow lain (${dup.claimWorkflowId}).`,
                        },
                    } as const;
                }
            }

            // 7. Load existing submissions for this workflow
            const existingSubmissions = await tx
                .select()
                .from(claimSubmission)
                .where(eq(claimSubmission.claimWorkflowId, id));
            const submissionByNoClaim = new Map(
                existingSubmissions
                    .filter((s) => s.noClaim && s.noClaim.trim())
                    .map((s) => [s.noClaim!, s]),
            );

            const now = new Date();
            const resultGroups: Array<{ noClaim: string; itemIds: string[]; submissionId: string }> = [];
            const touchedSubmissionIds = new Set<string>();
            const invalidatedPaths: Array<{ submissionId: string; type: string; path: string }> = [];

            // 8. For each group, create or reuse submission, assign items
            for (const root of orderedRoots) {
                const noClaim = generatedNoClaims.get(root)!;
                const itemIds = groups.get(root)!;

                let submission = submissionByNoClaim.get(noClaim);
                let submissionId: string;

                if (submission) {
                    // Reuse existing submission with same No Claim
                    submissionId = submission.id;
                } else {
                    // Check if there's an empty/unused submission we can repurpose
                    // (one with no noClaim and no items assigned)
                    let reuseTarget = existingSubmissions.find(
                        (s) =>
                            (!s.noClaim || !s.noClaim.trim()) &&
                            Number(s.totalClaim || 0) === 0 &&
                            !touchedSubmissionIds.has(s.id),
                    );

                    if (reuseTarget) {
                        submissionId = reuseTarget.id;
                        // Invalidate documents if the submission had any
                        for (const docType of ["claimLetterPdfPath", "summaryPdfPath", "receiptPdfPath"] as const) {
                            if (reuseTarget[docType]) {
                                invalidatedPaths.push({
                                    submissionId,
                                    type: docType,
                                    path: reuseTarget[docType]!,
                                });
                            }
                        }
                        await tx
                            .update(claimSubmission)
                            .set({
                                noClaim,
                                noClaimAssignedAt: now,
                                noClaimAssignedBy: actor.id,
                                scope: claimSubmissionScopes.perItem,
                                scopeLabel: noClaim,
                                claimLetterPdfPath: null,
                                claimLetterGeneratedAt: null,
                                claimLetterGeneratedBy: null,
                                summaryPdfPath: null,
                                summaryGeneratedAt: null,
                                summaryGeneratedBy: null,
                                receiptPdfPath: null,
                                receiptGeneratedAt: null,
                                receiptGeneratedBy: null,
                                updatedAt: now,
                            })
                            .where(eq(claimSubmission.id, submissionId));
                    } else {
                        // Create new submission
                        submissionId = randomUUID();
                        await tx.insert(claimSubmission).values({
                            id: submissionId,
                            claimWorkflowId: id,
                            noClaim,
                            noClaimAssignedAt: now,
                            noClaimAssignedBy: actor.id,
                            scope: claimSubmissionScopes.perItem,
                            scopeLabel: noClaim,
                            status: claimSubmissionStatuses.draft,
                            totalDpp: 0,
                            totalPpn: 0,
                            totalPph: 0,
                            totalClaim: 0,
                            totalPaid: 0,
                            remainingAmount: 0,
                            createdBy: actor.id,
                            createdAt: now,
                            updatedAt: now,
                        });
                    }
                    // Update our lookup for next iteration
                    submissionByNoClaim.set(noClaim, { id: submissionId, noClaim } as typeof existingSubmissions[0]);
                }

                touchedSubmissionIds.add(submissionId);

                // If submission had a different noClaim before, invalidate docs
                if (submission && submission.noClaim !== noClaim) {
                    for (const docType of ["claimLetterPdfPath", "summaryPdfPath", "receiptPdfPath"] as const) {
                        if (submission[docType]) {
                            invalidatedPaths.push({
                                submissionId,
                                type: docType,
                                path: submission[docType]!,
                            });
                        }
                    }
                    await tx
                        .update(claimSubmission)
                        .set({
                            noClaim,
                            noClaimAssignedAt: now,
                            noClaimAssignedBy: actor.id,
                            claimLetterPdfPath: null,
                            claimLetterGeneratedAt: null,
                            claimLetterGeneratedBy: null,
                            summaryPdfPath: null,
                            summaryGeneratedAt: null,
                            summaryGeneratedBy: null,
                            receiptPdfPath: null,
                            receiptGeneratedAt: null,
                            receiptGeneratedBy: null,
                            updatedAt: now,
                        })
                        .where(eq(claimSubmission.id, submissionId));
                }

                // Assign items to this submission
                await tx
                    .update(claimWorkflowItem)
                    .set({ claimSubmissionId: submissionId, updatedAt: now })
                    .where(inArray(claimWorkflowItem.id, itemIds));

                // Sync noClaim to off_batch_item for these items
                const offItemIds = itemIds
                    .map((iid) => itemMap.get(iid)?.offBatchItemId)
                    .filter((v): v is string => typeof v === "string" && v.length > 0);
                if (offItemIds.length > 0) {
                    await tx
                        .update(offBatchItem)
                        .set({ noClaim, updatedAt: now })
                        .where(inArray(offBatchItem.id, offItemIds));
                }

                resultGroups.push({ noClaim, itemIds, submissionId });
            }

            // 9. Recalc all touched submissions
            for (const subId of touchedSubmissionIds) {
                await recalcSubmissionTotals(tx, subId, now);
            }

            // Also recalc submissions that lost items (items moved away)
            const previousSubmissionIds = new Set(
                allItems
                    .filter((item) => item.claimSubmissionId && !touchedSubmissionIds.has(item.claimSubmissionId))
                    .map((item) => item.claimSubmissionId!)
            );
            for (const subId of previousSubmissionIds) {
                await recalcSubmissionTotals(tx, subId, now);
                touchedSubmissionIds.add(subId);
            }

            // 10. Recalc workflow aggregate
            await recalcWorkflowAggregateFromSubmissions(tx, id, now);

            // 11. Update workflow cache noClaim if single unique No Claim
            const uniqueNoClaims = [...new Set(generatedNoClaims.values())];
            if (uniqueNoClaims.length === 1) {
                await tx
                    .update(claimWorkflow)
                    .set({
                        noClaim: uniqueNoClaims[0],
                        noClaimAssignedAt: now,
                        noClaimAssignedBy: actor.id,
                        updatedAt: now,
                    })
                    .where(eq(claimWorkflow.id, id));
            } else {
                // Multiple No Claims — clear workflow cache
                await tx
                    .update(claimWorkflow)
                    .set({
                        noClaim: null,
                        noClaimAssignedAt: null,
                        noClaimAssignedBy: null,
                        updatedAt: now,
                    })
                    .where(eq(claimWorkflow.id, id));
            }

            // 12. Invalidate workflow-level documents if they exist
            // (because grouping changed)
            const workflowDocPaths: string[] = [];
            if (workflow.claimLetterPdfPath) workflowDocPaths.push(workflow.claimLetterPdfPath);
            if (workflow.summaryPdfPath) workflowDocPaths.push(workflow.summaryPdfPath);
            if (workflow.receiptPdfPath) workflowDocPaths.push(workflow.receiptPdfPath);
            if (workflowDocPaths.length > 0) {
                await tx
                    .update(claimWorkflow)
                    .set({
                        claimLetterPdfPath: null,
                        claimLetterGeneratedAt: null,
                        claimLetterGeneratedBy: null,
                        summaryPdfPath: null,
                        summaryGeneratedAt: null,
                        summaryGeneratedBy: null,
                        receiptPdfPath: null,
                        receiptGeneratedAt: null,
                        receiptGeneratedBy: null,
                        updatedAt: now,
                    })
                    .where(eq(claimWorkflow.id, id));
                for (const p of workflowDocPaths) {
                    invalidatedPaths.push({ submissionId: "workflow", type: "workflow-doc", path: p });
                }
            }

            // 13. Audit
            await writeClaimAudit({
                claimWorkflowId: id,
                actor,
                action: "no_claim_auto_generated",
                fromStatus: workflow.status,
                toStatus: workflow.status,
                metadata: {
                    startSequence,
                    month: mm,
                    year,
                    variantKey: variantKey ?? null,
                    principleCode: workflow.principleCode,
                    groupCount: orderedRoots.length,
                    itemCount: rowModes.length,
                    groups: resultGroups.map((g) => ({
                        noClaim: g.noClaim,
                        submissionId: g.submissionId,
                        itemCount: g.itemIds.length,
                    })),
                    invalidatedDocumentCount: invalidatedPaths.length,
                },
            }, tx);

            if (invalidatedPaths.length > 0) {
                await writeClaimAudit({
                    claimWorkflowId: id,
                    actor,
                    action: "no_claim_changed_invalidated_documents",
                    fromStatus: workflow.status,
                    toStatus: workflow.status,
                    metadata: {
                        invalidatedPaths: invalidatedPaths.map((p) => ({
                            submissionId: p.submissionId,
                            type: p.type,
                            path: p.path,
                        })),
                    },
                }, tx);
            }

            return {
                ok: true,
                groups: resultGroups,
                invalidatedPaths,
                touchedSubmissionIds: [...touchedSubmissionIds],
            } as const;
        });

        if ("error" in result && result.error) {
            return NextResponse.json(
                { ok: false, code: result.error.code, error: result.error.message },
                { status: result.error.status },
            );
        }

        // Best-effort unlink invalidated files outside transaction
        if ("invalidatedPaths" in result) {
            for (const entry of result.invalidatedPaths) {
                if (!isPathInsideClaimDocumentRoot(entry.path)) continue;
                await unlink(entry.path).catch(() => {});
            }
        }

        return NextResponse.json({
            ok: true,
            success: true,
            groups: "groups" in result ? result.groups : [],
            invalidatedDocumentCount: "invalidatedPaths" in result ? result.invalidatedPaths.length : 0,
        });
    } catch (error) {
        console.error("[AUTO NO CLAIM ERROR]", error);
        return NextResponse.json(
            { ok: false, error: "Gagal generate No Claim massal." },
            { status: 500 },
        );
    }
}
