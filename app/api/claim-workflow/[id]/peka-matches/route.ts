import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimPekaReport, claimWorkflow, claimWorkflowItem } from "@/db/schema";
import {
    canActorReadClaimWorkflow,
    normalizeNoSurat,
    requireClaimSession,
} from "@/lib/claim-workflow";

type Context = { params: Promise<{ id: string }> };

type BestMatch = {
    pekaId: string;
    ecNumber: string | null;
    cnNumber: string | null;
    claimNo: string | null;
    totalClaim: number;
    pendingUser: string | null;
    leadTime: number | null;
    age: number | null;
    note: string | null;
    sourceFile: string;
    importedAt: Date | null;
};

type ItemMatchPreview = {
    itemId: string;
    noSurat: string;
    normalizedNoSurat: string;
    jenisPromosi: string | null;
    periode: string | null;
    nilaiKlaim: number;
    matchedCount: number;
    status: "unmatched" | "matched" | "duplicate_match";
    bestMatch?: BestMatch;
    conflictMatches?: BestMatch[];
};

function toBestMatch(row: typeof claimPekaReport.$inferSelect): BestMatch {
    return {
        pekaId: row.id,
        ecNumber: row.ecNumber,
        cnNumber: row.cnNumber,
        claimNo: row.claimNo,
        totalClaim: Number(row.totalClaim || 0),
        pendingUser: row.pendingUser,
        leadTime: row.leadTime,
        age: row.age,
        note: row.note,
        sourceFile: row.sourceFile,
        importedAt: row.importedAt,
    };
}

export async function GET(_request: Request, context: Context) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!canActorReadClaimWorkflow(actor)) {
        return NextResponse.json({
            ok: false,
            error: "Role Anda tidak memiliki akses preview PEKA.",
        }, { status: 403 });
    }

    try {
        const { id } = await context.params;
        const [workflow] = await db
            .select({ id: claimWorkflow.id })
            .from(claimWorkflow)
            .where(eq(claimWorkflow.id, id));
        if (!workflow) {
            return NextResponse.json({ ok: false, error: "Claim Workflow not found" }, { status: 404 });
        }

        const items = await db
            .select()
            .from(claimWorkflowItem)
            .where(eq(claimWorkflowItem.claimWorkflowId, id));

        // Index seluruh PEKA report by normalized noSuratRd. Untuk Phase 3A,
        // dataset PEKA masih relatif kecil (1 file kantor per period), jadi
        // index in-memory sederhana lebih cepat dan transparan dibanding
        // round-trip per item ke DB. Endpoint ini READ-ONLY, tidak menulis.
        const pekaRows = await db.select().from(claimPekaReport);
        const indexByNoSurat = new Map<string, typeof pekaRows>();
        for (const row of pekaRows) {
            const key = normalizeNoSurat(row.noSuratRd);
            if (!key) continue;
            const existing = indexByNoSurat.get(key);
            if (existing) {
                existing.push(row);
            } else {
                indexByNoSurat.set(key, [row]);
            }
        }

        const previews: ItemMatchPreview[] = items.map((item) => {
            const noSuratRaw = String(item.noSurat || "");
            const normalized = normalizeNoSurat(noSuratRaw);
            const matches = normalized ? indexByNoSurat.get(normalized) || [] : [];
            const matchedCount = matches.length;

            if (matchedCount === 0) {
                return {
                    itemId: item.id,
                    noSurat: noSuratRaw,
                    normalizedNoSurat: normalized,
                    jenisPromosi: item.jenisPromosi,
                    periode: item.periode,
                    nilaiKlaim: Number(item.nilaiKlaim || 0),
                    matchedCount,
                    status: "unmatched",
                };
            }

            if (matchedCount === 1) {
                return {
                    itemId: item.id,
                    noSurat: noSuratRaw,
                    normalizedNoSurat: normalized,
                    jenisPromosi: item.jenisPromosi,
                    periode: item.periode,
                    nilaiKlaim: Number(item.nilaiKlaim || 0),
                    matchedCount,
                    status: "matched",
                    bestMatch: toBestMatch(matches[0]),
                };
            }

            // Duplicate match: terurutkan terbaru dulu agar bestMatch jadi
            // kandidat termutakhir, sisanya tetap dipresentasikan sebagai
            // conflictMatches supaya user bisa review manual sebelum apply.
            const sorted = [...matches].sort((a, b) => {
                const aTime = a.importedAt ? new Date(a.importedAt).getTime() : 0;
                const bTime = b.importedAt ? new Date(b.importedAt).getTime() : 0;
                return bTime - aTime;
            });
            return {
                itemId: item.id,
                noSurat: noSuratRaw,
                normalizedNoSurat: normalized,
                jenisPromosi: item.jenisPromosi,
                periode: item.periode,
                nilaiKlaim: Number(item.nilaiKlaim || 0),
                matchedCount,
                status: "duplicate_match",
                bestMatch: toBestMatch(sorted[0]),
                conflictMatches: sorted.slice(1).map(toBestMatch),
            };
        });

        const summary = {
            itemCount: items.length,
            matched: previews.filter((p) => p.status === "matched").length,
            unmatched: previews.filter((p) => p.status === "unmatched").length,
            duplicate: previews.filter((p) => p.status === "duplicate_match").length,
            pekaRowCount: pekaRows.length,
        };

        return NextResponse.json({
            ok: true,
            previews,
            summary,
        });
    } catch (error) {
        console.error("[CLAIM PEKA MATCHES ERROR]", error);
        return NextResponse.json({
            ok: false,
            error: "Gagal memuat preview matching PEKA.",
        }, { status: 500 });
    }
}
