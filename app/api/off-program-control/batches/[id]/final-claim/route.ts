import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimWorkflow, offBatch, offBatchItem } from "@/db/schema";
import {
  canActorPerformOffAction,
  canOpenFinalClaim,
  computeOffFinancePaymentSummary,
  computeOffPaymentSummary,
  getBatchWithItems,
  hasMinimalFinalChecklist,
  paymentsHaveProofs,
  publicBatch,
  requireOffSession,
  writeOffAudit,
} from "@/lib/off-program-control";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireOffSession();
    if (!actor)
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    if (!canActorPerformOffAction(actor, "claim_final"))
      return NextResponse.json(
        { ok: false, error: "Role Anda tidak memiliki akses final Claim." },
        { status: 403 },
      );
    const { id } = await context.params;
    const data = await getBatchWithItems(id);
    if (!data)
      return NextResponse.json(
        { ok: false, error: "Batch not found" },
        { status: 404 },
      );
    const itemSummary = computeOffPaymentSummary(data.items);
    const paymentSummary = computeOffFinancePaymentSummary(
      itemSummary.total,
      data.payments,
    );
    if (!canOpenFinalClaim(data.batch)) {
      return NextResponse.json(
        { ok: false, error: "Batch belum dibayar Keuangan." },
        { status: 409 },
      );
    }
    if (!paymentSummary.isFullyPaid) {
      return NextResponse.json(
        {
          ok: false,
          error: "Pembayaran belum lunas, belum bisa di-approve Claim.",
        },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || body.decision || "complete");
    const note = String(body.note || body.finalClaimNote || "").trim();
    const claimRefs = Array.isArray(body.claimRefs) ? body.claimRefs : [];
    const now = new Date();

    if (action === "remind_incomplete_documents") {
      if (!note)
        return NextResponse.json(
          {
            ok: false,
            error:
              "Catatan Final Claim wajib diisi untuk mengirim pengingat kelengkapan belum lengkap.",
          },
          { status: 400 },
        );
      await db
        .update(offBatch)
        .set({
          status: "Paid",
          financeStatus: "Paid",
          finalStatus: "Incomplete Documents",
          finalClaimNote: note,
          locked: true,
          updatedAt: now,
        })
        .where(eq(offBatch.id, id));
      await writeOffAudit({
        batchId: id,
        actor,
        action: "final_remind_incomplete_documents",
        fromStatus: data.batch.finalStatus,
        toStatus: "Incomplete Documents",
        note,
        metadata: {
          totalPaid: paymentSummary.totalPaid,
          totalNominal: paymentSummary.totalNominal,
        },
      });
      const updated = await getBatchWithItems(id);
      return NextResponse.json({
        ok: true,
        message:
          "Pengingat kelengkapan ditampilkan di web untuk Sales Manager dan Supervisor/SPV. Batch tetap menunggu final Claim.",
        batch: updated ? publicBatch(updated.batch) : null,
      });
    }

    if (action !== "complete")
      return NextResponse.json(
        { ok: false, error: "Action Final Claim tidak valid." },
        { status: 400 },
      );
    if (data.payments.length === 0)
      return NextResponse.json(
        {
          ok: false,
          error: "Pembayaran belum lunas, belum bisa di-approve Claim.",
        },
        { status: 409 },
      );
    if (!paymentsHaveProofs(data.payments)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Semua pembayaran wajib memiliki bukti pembayaran.",
        },
        { status: 400 },
      );
    }
    if (paymentSummary.totalPaid !== paymentSummary.totalNominal) {
      return NextResponse.json(
        {
          ok: false,
          error: "Pembayaran belum lunas, belum bisa di-approve Claim.",
        },
        { status: 409 },
      );
    }

    // Phase R1 — Rewire OFF ↔ Claim No Claim:
    // Sumber kebenaran No Claim adalah claim_workflow.no_claim, bukan input
    // manual per item di body. Validasi:
    //   1. Claim Workflow untuk OFF batch ini sudah ada.
    //   2. claim_workflow.no_claim sudah di-assign (non-empty).
    //   3. Semua off_batch_item dengan noSurat sudah punya no_claim hasil
    //      sync dari endpoint /api/claim-workflow/[id]/no-claim.
    // OFF Completed TIDAK perlu menunggu Claim Workflow Submitted to
    // Principal — rule kerja antar workflow tetap terpisah.
    const [linkedWorkflow] = await db
      .select({
        id: claimWorkflow.id,
        claimWorkflowNo: claimWorkflow.claimWorkflowNo,
        noClaim: claimWorkflow.noClaim,
        status: claimWorkflow.status,
      })
      .from(claimWorkflow)
      .where(eq(claimWorkflow.offBatchId, id));
    if (!linkedWorkflow) {
      return NextResponse.json(
        {
          ok: false,
          code: "OFF_FINAL_CLAIM_WORKFLOW_REQUIRED",
          error:
            "Claim Workflow untuk OFF batch ini belum dibuat. Buat Claim Workflow terlebih dahulu.",
        },
        { status: 409 },
      );
    }
    const workflowNoClaim = String(linkedWorkflow.noClaim || "").trim();
    if (!workflowNoClaim) {
      return NextResponse.json(
        {
          ok: false,
          code: "OFF_FINAL_NO_CLAIM_REQUIRED",
          error: `Claim Workflow ${linkedWorkflow.claimWorkflowNo} belum memiliki No Claim. Assign No Claim di Claim Workflow terlebih dahulu.`,
        },
        { status: 409 },
      );
    }
    const itemsMissingNoClaim = data.items
      .filter((item) => String(item.noSurat || "").trim())
      .filter((item) => !String(item.noClaim || "").trim())
      .map((item) => String(item.noSurat || "").trim());
    if (itemsMissingNoClaim.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "OFF_FINAL_NO_CLAIM_NOT_SYNCED",
          error: `No Claim belum tersinkron ke OFF item. Re-assign No Claim di Claim Workflow ${linkedWorkflow.claimWorkflowNo} untuk men-sync ulang. No Surat tanpa noClaim: ${itemsMissingNoClaim.join(", ")}`,
        },
        { status: 409 },
      );
    }

    type ClaimRef = {
      itemId: string;
      noSurat: string;
      finalKwt: boolean;
      finalSkp: boolean;
      finalFp: boolean;
      finalPc: boolean;
      finalFoto: boolean;
      finalRekap: boolean;
      finalOthers: boolean;
      finalOthersText: string;
      finalCompletenessNote: string;
    };

    // Body tetap menerima claimRefs untuk checklist final per item.
    // Field `noClaim` di body sengaja diabaikan — sumber kebenaran adalah
    // claim_workflow.no_claim yang sudah ter-sync.
    const sanitizedClaimRefs: ClaimRef[] = claimRefs.map(
      (ref: Record<string, unknown>) => ({
        itemId: String(ref.itemId || "").trim(),
        noSurat: String(ref.noSurat || "").trim(),
        finalKwt: ref.finalKwt === true || ref.finalKwt === "true",
        finalSkp: ref.finalSkp === true || ref.finalSkp === "true",
        finalFp: ref.finalFp === true || ref.finalFp === "true",
        finalPc: ref.finalPc === true || ref.finalPc === "true",
        finalFoto: ref.finalFoto === true || ref.finalFoto === "true",
        finalRekap: ref.finalRekap === true || ref.finalRekap === "true",
        finalOthers: ref.finalOthers === true || ref.finalOthers === "true",
        finalOthersText: String(ref.finalOthersText || "").trim(),
        finalCompletenessNote: String(ref.finalCompletenessNote || "").trim(),
      }),
    );

    const claimRefMap = new Map<string, ClaimRef>(
      sanitizedClaimRefs.map((ref): [string, ClaimRef] => [ref.itemId, ref]),
    );

    // Validasi: setiap item minimal harus punya checklist final yang dianggap cukup
    const missingChecklist = data.items
      .filter((item) => String(item.noSurat || "").trim())
      .filter((item) => {
        const ref = claimRefMap.get(item.id);
        if (!ref) return true;
        return !hasMinimalFinalChecklist(ref);
      })
      .map((item) => String(item.noSurat || "").trim());

    if (missingChecklist.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Checklist kelengkapan final wajib diisi minimal satu untuk No Surat: ${missingChecklist.join(", ")}`,
        },
        { status: 400 },
      );
    }

    await db.transaction(async (tx) => {
      // Phase R6 — Race-safety recheck:
      // Pre-checks di atas dilakukan di luar transaksi sehingga ada
      // celah teoretis di mana noClaim Claim Workflow / off_batch_item
      // berubah antara pre-check dan commit OFF Completed. Re-read
      // status critical (claim_workflow.noClaim + off_batch_item.noClaim)
      // di dalam transaksi dan rollback jika tidak konsisten lagi.
      const [tWorkflow] = await tx
        .select({
          id: claimWorkflow.id,
          claimWorkflowNo: claimWorkflow.claimWorkflowNo,
          noClaim: claimWorkflow.noClaim,
        })
        .from(claimWorkflow)
        .where(eq(claimWorkflow.offBatchId, id));
      if (!tWorkflow || !String(tWorkflow.noClaim || "").trim()) {
        // Throw to rollback. Pesan tetap ramah supaya UI bisa hint user
        // untuk re-assign No Claim.
        throw Object.assign(
          new Error(
            "No Claim Claim Workflow tidak konsisten. Re-assign No Claim lalu coba lagi.",
          ),
          { code: "OFF_FINAL_NO_CLAIM_RACE" },
        );
      }
      const txItems = await tx
        .select({ id: offBatchItem.id, noSurat: offBatchItem.noSurat, noClaim: offBatchItem.noClaim })
        .from(offBatchItem)
        .where(eq(offBatchItem.batchId, id));
      const txItemsMissing = txItems
        .filter((row) => String(row.noSurat || "").trim())
        .filter((row) => !String(row.noClaim || "").trim())
        .map((row) => String(row.noSurat || "").trim());
      if (txItemsMissing.length > 0) {
        throw Object.assign(
          new Error(
            `No Claim belum tersinkron ke OFF item (race detected). Re-assign No Claim di Claim Workflow ${tWorkflow.claimWorkflowNo}.`,
          ),
          { code: "OFF_FINAL_NO_CLAIM_NOT_SYNCED_RACE" },
        );
      }

      for (const item of data.items) {
        const ref = claimRefMap.get(item.id);
        if (!ref) continue;

        await tx
          .update(offBatchItem)
          .set({
            // No Claim TIDAK ditulis dari body. Tetap dipakai dari
            // off_batch_item.no_claim hasil sync claim_workflow.
            finalKwt: ref.finalKwt,
            finalSkp: ref.finalSkp,
            finalFp: ref.finalFp,
            finalPc: ref.finalPc,
            finalFoto: ref.finalFoto,
            finalRekap: ref.finalRekap,
            finalOthers: ref.finalOthers,
            finalOthersText: ref.finalOthersText || null,
            finalCompletenessNote: ref.finalCompletenessNote || null,
            updatedAt: now,
          })
          .where(eq(offBatchItem.id, item.id));
      }

      await tx
        .update(offBatch)
        .set({
          status: "Completed",
          finalStatus: "Completed",
          verifiedAmount: paymentSummary.totalPaid,
          finalClaimNote: note,
          locked: true,
          updatedAt: now,
        })
        .where(eq(offBatch.id, id));

      await writeOffAudit({
        batchId: id,
        actor,
        action: "complete",
        fromStatus: data.batch.finalStatus,
        toStatus: "Completed",
        note,
        metadata: {
          totalPaid: paymentSummary.totalPaid,
          paymentCount: data.payments.length,
          claimRefs: sanitizedClaimRefs,
          claimWorkflowId: linkedWorkflow.id,
          claimWorkflowNo: linkedWorkflow.claimWorkflowNo,
          claimWorkflowNoClaim: workflowNoClaim,
        },
      }, tx);
    });
    const updated = await getBatchWithItems(id);
    return NextResponse.json({
      ok: true,
      message: "Pengajuan selesai dan status menjadi Completed.",
      batch: updated ? publicBatch(updated.batch) : null,
    });
  } catch (error) {
    // Phase R6 — Race-safety: rollback transaksi melempar Error dengan
    // properti `code` yang sudah dikenal. Kembalikan 409 supaya UI bisa
    // render pesan bermakna dan user dapat retry.
    const code =
      error && typeof error === "object" && "code" in (error as Record<string, unknown>)
        ? String((error as Record<string, unknown>).code)
        : null;
    if (
      code === "OFF_FINAL_NO_CLAIM_RACE" ||
      code === "OFF_FINAL_NO_CLAIM_NOT_SYNCED_RACE"
    ) {
      return NextResponse.json(
        {
          ok: false,
          code,
          error: error instanceof Error ? error.message : "Konflik No Claim saat finalisasi.",
        },
        { status: 409 },
      );
    }
    console.error("[OFF FINAL CLAIM ERROR]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal memproses final verification Claim." },
      { status: 500 },
    );
  }
}
