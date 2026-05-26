"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  claimWorkflowStatuses,
  displayClaimStatusLabel,
  isLegacyPekaStatus,
} from "@/lib/claim-workflow/constants";

type TransitionAction =
  | "mark_ready"
  | "return_to_draft"
  | "submit_to_principal";

type Workflow = {
  id: string;
  claimWorkflowNo: string;
  offBatchId: string;
  offNoPengajuan?: string | null;
  principleName: string;
  status: string;
  totalDpp: number;
  totalPpn: number;
  totalPph: number;
  totalClaim: number;
  totalPaid: number;
  remainingAmount: number;
  submittedToPrincipalAt?: string | Date | null;
  claimLetterPdfPath?: string | null;
  claimLetterGeneratedAt?: string | Date | null;
  claimLetterGeneratedBy?: string | null;
  summaryPdfPath?: string | null;
  summaryGeneratedAt?: string | Date | null;
  summaryGeneratedBy?: string | null;
  receiptPdfPath?: string | null;
  receiptGeneratedAt?: string | Date | null;
  receiptGeneratedBy?: string | null;
  noClaim?: string | null;
  noClaimAssignedAt?: string | Date | null;
  noClaimAssignedBy?: string | null;
  noClaimAssignedByName?: string | null;
  createdAt: string | Date;
};

type WorkflowItem = {
  id: string;
  noSurat?: string | null;
  jenisPromosi?: string | null;
  periode?: string | null;
  outlet?: string | null;
  dpp: number;
  ppnRate: number;
  ppnAmount: number;
  pphRate: number;
  pphAmount: number;
  nilaiKlaim: number;
  status: string;
  note?: string | null;
};

type AuditRow = {
  id: string;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  note?: string | null;
  createdAt: string | Date;
};

type DetailResult = {
  ok?: boolean;
  error?: string;
  workflow?: Workflow;
  items?: WorkflowItem[];
  payments?: unknown[];
  canEditItems?: boolean;
  canGenerateClaimLetter?: boolean;
  canGenerateSummary?: boolean;
  canGenerateReceipt?: boolean;
  canAssignNoClaim?: boolean;
};

type EditDraft = {
  dpp: string;
  ppnRate: string;
  pphRate: string;
  note: string;
};

function rupiah(value: number) {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function dateText(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Legacy PEKA statuses are displayed in the same tone as Submitted to
// Principal because the PEKA workflow has been retired. The detail page
// must not crash on legacy rows but also must not expose any PEKA action.
function statusTone(status: string) {
  if (status === claimWorkflowStatuses.paid || status === claimWorkflowStatuses.closed) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === claimWorkflowStatuses.needRevision || status === claimWorkflowStatuses.cancelled) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  }
  if (
    status === claimWorkflowStatuses.submittedToPrincipal ||
    isLegacyPekaStatus(status)
  ) {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }
  if (status === claimWorkflowStatuses.partiallyPaid) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }
  if (status === claimWorkflowStatuses.outstanding) {
    return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  }
  if (status === claimWorkflowStatuses.readyToSubmit) {
    return "border-indigo-500/30 bg-indigo-500/10 text-indigo-200";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

const TRANSITION_LABEL: Record<TransitionAction, string> = {
  mark_ready: "Mark Ready",
  return_to_draft: "Return to Draft",
  submit_to_principal: "Submit to Principal",
};

export default function ClaimWorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id || "");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [canEditItems, setCanEditItems] = useState(false);
  const [canGenerateClaimLetter, setCanGenerateClaimLetter] = useState(false);
  const [canGenerateSummary, setCanGenerateSummary] = useState(false);
  const [canGenerateReceipt, setCanGenerateReceipt] = useState(false);
  const [canAssignNoClaim, setCanAssignNoClaim] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [transitionLoading, setTransitionLoading] = useState<TransitionAction | "">("");
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [noClaimDraft, setNoClaimDraft] = useState("");
  const [noClaimSaving, setNoClaimSaving] = useState(false);
  const [noClaimEditing, setNoClaimEditing] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    setAuditError("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as DetailResult;
      if (!response.ok || !result.ok || !result.workflow) {
        throw new Error(result.error || "Gagal memuat detail Claim Workflow.");
      }
      setWorkflow(result.workflow);
      setItems(result.items || []);
      setCanEditItems(Boolean(result.canEditItems));
      setCanGenerateClaimLetter(Boolean(result.canGenerateClaimLetter));
      setCanGenerateSummary(Boolean(result.canGenerateSummary));
      setCanGenerateReceipt(Boolean(result.canGenerateReceipt));
      setCanAssignNoClaim(Boolean(result.canAssignNoClaim));
      // Sinkronkan draft input dengan nilai No Claim terbaru, kecuali user
      // sedang mengetik (noClaimEditing true).
      if (!noClaimEditing) {
        setNoClaimDraft(result.workflow.noClaim || "");
      }

      const auditResponse = await fetch(`/api/claim-workflow/${id}/audit`, {
        cache: "no-store",
      });
      const auditResult = (await auditResponse.json()) as {
        ok?: boolean;
        error?: string;
        audit?: AuditRow[];
      };
      if (auditResponse.ok && auditResult.ok) {
        setAudit(auditResult.audit || []);
      } else {
        setAudit([]);
        setAuditError(auditResult.error || "Audit tidak tersedia untuk role ini.");
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Gagal memuat detail Claim Workflow.",
      );
    } finally {
      setLoading(false);
    }
  }, [id, noClaimEditing]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const editable =
    canEditItems &&
    (workflow?.status === claimWorkflowStatuses.draft ||
      workflow?.status === claimWorkflowStatuses.needRevision);

  const startEdit = (item: WorkflowItem) => {
    setMessage("");
    setEditingId(item.id);
    setDraft({
      dpp: String(item.dpp),
      ppnRate: String(item.ppnRate),
      pphRate: String(item.pphRate),
      note: item.note || "",
    });
  };

  const saveEdit = async (itemId: string) => {
    if (!draft) return;
    setSavingId(itemId);
    setMessage("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal menyimpan perubahan pajak item.");
      }
      setEditingId("");
      setDraft(null);
      setMessage("Nilai pajak item tersimpan dan total Claim Workflow telah dihitung ulang.");
      await loadDetail();
    } catch (saveError) {
      setMessage(
        saveError instanceof Error
          ? saveError.message
          : "Gagal menyimpan perubahan pajak item.",
      );
    } finally {
      setSavingId("");
    }
  };

  const runTransition = useCallback(
    async (action: TransitionAction) => {
      if (!workflow) return;
      let note: string | undefined;
      if (action === "submit_to_principal") {
        const confirmed =
          typeof window !== "undefined"
            ? window.confirm(
                "Submit Claim Workflow ini ke Principal? Item pajak akan dikunci setelah ini.",
              )
            : true;
        if (!confirmed) return;
      } else if (action === "return_to_draft") {
        // Backend mewajibkan note non-kosong untuk return_to_draft karena
        // aksi ini menginvalidasi tiga dokumen aktif (Claim Letter, Summary,
        // Kwitansi) dan membuka kembali tax editing. Tolak input kosong di
        // sisi UI sebelum hit API.
        if (typeof window === "undefined") return;
        const reason = window.prompt(
          "Alasan mengembalikan Claim Workflow ke Draft (wajib diisi):",
          "",
        );
        if (reason === null) return;
        const trimmed = reason.trim();
        if (!trimmed) {
          const blankMessage = "Alasan wajib diisi saat mengembalikan Claim Workflow ke Draft.";
          toast.error(blankMessage);
          setMessage(blankMessage);
          return;
        }
        note = trimmed;
      }
      setTransitionLoading(action);
      setMessage("");
      try {
        const response = await fetch(`/api/claim-workflow/${id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(note ? { action, note } : { action }),
        });
        const result = (await response.json()) as {
          ok?: boolean;
          error?: string;
          workflow?: { status?: string };
        };
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "Gagal mengubah status Claim Workflow.");
        }
        const successMessage =
          action === "mark_ready"
            ? "Status diubah menjadi Ready to Submit."
            : action === "return_to_draft"
              ? "Status dikembalikan ke Draft."
              : "Claim Workflow berhasil disubmit ke Principal.";
        toast.success(successMessage);
        setMessage(successMessage);
        await loadDetail();
      } catch (transitionError) {
        const errorMessage =
          transitionError instanceof Error
            ? transitionError.message
            : "Gagal mengubah status Claim Workflow.";
        toast.error(errorMessage);
        setMessage(errorMessage);
      } finally {
        setTransitionLoading("");
      }
    },
    [id, loadDetail, workflow],
  );

  const generateClaimLetter = async () => {
    setGeneratingLetter(true);
    setMessage("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}/claim-letter`, {
        method: "POST",
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal membuat Claim Letter PDF.");
      }
      const successMessage = "Claim Letter PDF berhasil dibuat.";
      toast.success(successMessage);
      setMessage(successMessage);
      await loadDetail();
    } catch (generateError) {
      const errorMessage =
        generateError instanceof Error
          ? generateError.message
          : "Gagal membuat Claim Letter PDF.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setGeneratingLetter(false);
    }
  };

  const generateClaimSummary = async () => {
    setGeneratingSummary(true);
    setMessage("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}/summary`, {
        method: "POST",
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal membuat Claim Summary PDF.");
      }
      const successMessage = "Claim Summary PDF berhasil dibuat.";
      toast.success(successMessage);
      setMessage(successMessage);
      await loadDetail();
    } catch (generateError) {
      const errorMessage =
        generateError instanceof Error
          ? generateError.message
          : "Gagal membuat Claim Summary PDF.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const generateClaimReceipt = async () => {
    setGeneratingReceipt(true);
    setMessage("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}/receipt`, {
        method: "POST",
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal membuat Kwitansi Claim PDF.");
      }
      const successMessage = "Kwitansi Claim PDF berhasil dibuat.";
      toast.success(successMessage);
      setMessage(successMessage);
      await loadDetail();
    } catch (generateError) {
      const errorMessage =
        generateError instanceof Error
          ? generateError.message
          : "Gagal membuat Kwitansi Claim PDF.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setGeneratingReceipt(false);
    }
  };

  const submitNoClaim = async () => {
    const trimmed = noClaimDraft.trim();
    if (!trimmed) {
      const blankMessage = "No Claim tidak boleh kosong.";
      toast.error(blankMessage);
      setMessage(blankMessage);
      return;
    }
    setNoClaimSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}/no-claim`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noClaim: trimmed }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        sync?: { syncedItemCount?: number };
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal menyimpan No Claim.");
      }
      const syncedItemCount = result.sync?.syncedItemCount ?? 0;
      const successMessage = `No Claim tersimpan dan sync ke ${syncedItemCount} OFF item.`;
      toast.success(successMessage);
      setMessage(successMessage);
      setNoClaimEditing(false);
      await loadDetail();
    } catch (saveError) {
      const errorMessage =
        saveError instanceof Error
          ? saveError.message
          : "Gagal menyimpan No Claim.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setNoClaimSaving(false);
    }
  };

  if (loading) {
    return <div className="px-5 py-12 text-sm text-slate-400">Memuat detail Claim Workflow...</div>;
  }
  if (error || !workflow) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">{error || "Claim Workflow tidak ditemukan."}</div>;
  }

  const summary = [
    ["Total DPP", rupiah(workflow.totalDpp)],
    ["Total PPN", rupiah(workflow.totalPpn)],
    ["Total PPH", rupiah(workflow.totalPph)],
    ["Total Claim", rupiah(workflow.totalClaim)],
    ["Total Paid", rupiah(workflow.totalPaid)],
    ["Remaining Amount", rupiah(workflow.remainingAmount)],
  ];

  // Status setelah Submitted to Principal belum punya transisi UI di phase
  // ini — Partially Paid / Paid akan otomatis ditulis lewat payment workflow
  // (R3). Closed akan diatur lewat close endpoint terpisah (R4). Status
  // legacy PEKA tidak menyediakan transisi apapun supaya tidak menghidupkan
  // kembali alur PEKA.
  const transitions: TransitionAction[] =
    workflow.status === claimWorkflowStatuses.draft ||
    workflow.status === claimWorkflowStatuses.needRevision
      ? ["mark_ready"]
      : workflow.status === claimWorkflowStatuses.readyToSubmit
        ? ["return_to_draft", "submit_to_principal"]
        : [];

  const showLegacyNotice = isLegacyPekaStatus(workflow.status);

  return (
    <div className="w-full space-y-6 pb-12 pt-2">
      <Link href="/claim-workflow" className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">
        Kembali ke Claim Workflow
      </Link>

      <section className="rounded-3xl border border-white/10 bg-[#1a1c23] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">Claim Workflow Detail</p>
            <h1 className="mt-3 text-2xl font-black text-white">{workflow.claimWorkflowNo}</h1>
            <p className="mt-2 text-sm text-slate-400">
              {workflow.principleName} | OFF {workflow.offNoPengajuan || workflow.offBatchId}
            </p>
            <p className="mt-2 text-xs text-slate-500">Created: {dateText(workflow.createdAt)}</p>
            {workflow.submittedToPrincipalAt && (
              <p className="mt-1 text-xs text-sky-300">
                Submitted to Principal: {dateText(workflow.submittedToPrincipalAt)}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-3">
            <span
              className={`rounded-full border px-3 py-1.5 text-sm font-bold ${statusTone(workflow.status)}`}
              title={showLegacyNotice ? "Legacy PEKA status — diperlakukan sebagai Submitted to Principal" : undefined}
            >
              {displayClaimStatusLabel(workflow.status)}
            </span>
            {canEditItems && transitions.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                {transitions.map((action) => {
                  const isPrimary = action === "submit_to_principal" || action === "mark_ready";
                  const className = isPrimary
                    ? "rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                    : "rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50";
                  return (
                    <button
                      key={action}
                      type="button"
                      disabled={transitionLoading !== ""}
                      onClick={() => void runTransition(action)}
                      className={className}
                    >
                      {transitionLoading === action ? "Memproses..." : TRANSITION_LABEL[action]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {summary.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className="mt-2 whitespace-nowrap text-sm font-bold text-white">{value}</p>
            </div>
          ))}
        </div>
        {showLegacyNotice && (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            Workflow ini masih memiliki status legacy PEKA ({workflow.status}). Alur PEKA/EC/CN sudah retired; status ini sekarang diperlakukan sebagai Submitted to Principal. Pembayaran principal akan ditangani via Principal Payment workflow (R3).
          </p>
        )}
      </section>

      {message && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-white">No Claim</h2>
            <p className="mt-1 text-sm text-slate-400">
              No Claim utama untuk Claim Workflow ini. Saat di-assign, otomatis sync ke semua OFF item terkait.
            </p>
            {workflow.noClaim ? (
              <div className="mt-3 space-y-1">
                <p className="font-mono text-base font-bold text-emerald-200">
                  {workflow.noClaim}
                </p>
                {workflow.noClaimAssignedAt && (
                  <p className="text-xs text-slate-500">
                    Assigned at {dateText(workflow.noClaimAssignedAt)}
                    {(workflow.noClaimAssignedByName || workflow.noClaimAssignedBy)
                      ? ` by ${workflow.noClaimAssignedByName || workflow.noClaimAssignedBy}`
                      : ""}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-amber-200">
                Belum di-assign. Wajib di-assign sebelum Mark Ready.
              </p>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:max-w-md">
            {canAssignNoClaim ? (
              noClaimEditing || !workflow.noClaim ? (
                <>
                  <input
                    type="text"
                    value={noClaimDraft}
                    onChange={(event) => {
                      setNoClaimEditing(true);
                      setNoClaimDraft(event.target.value);
                    }}
                    placeholder="Contoh: 09/SUPER-GCPI/02/2026"
                    disabled={noClaimSaving}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    {workflow.noClaim && (
                      <button
                        type="button"
                        disabled={noClaimSaving}
                        onClick={() => {
                          setNoClaimEditing(false);
                          setNoClaimDraft(workflow.noClaim || "");
                        }}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
                      >
                        Batal
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={noClaimSaving}
                      onClick={() => void submitNoClaim()}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {noClaimSaving ? "Menyimpan..." : workflow.noClaim ? "Update No Claim" : "Assign No Claim"}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNoClaimEditing(true);
                    setNoClaimDraft(workflow.noClaim || "");
                  }}
                  className="self-end rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/20"
                >
                  Edit No Claim
                </button>
              )
            ) : (
              <p className="text-xs italic text-slate-500">
                View-only. Hanya admin atau claim yang dapat assign / update No Claim.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-white">Dokumen Klaim</h2>
            <p className="mt-1 text-sm text-slate-400">
              Tiga dokumen wajib di-generate sebelum Mark Ready: Claim Letter, Claim Summary, Kwitansi Claim.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {/* Claim Letter */}
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Claim Letter</h3>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  workflow.claimLetterPdfPath
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {workflow.claimLetterPdfPath ? "Generated" : "Belum"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {workflow.claimLetterGeneratedAt
                ? `Generated at ${dateText(workflow.claimLetterGeneratedAt)}`
                : "Surat klaim resmi ke principal."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {workflow.claimLetterPdfPath && (
                <a
                  href={`/api/claim-workflow/${id}/claim-letter`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10"
                >
                  Open PDF
                </a>
              )}
              {canGenerateClaimLetter && (
                <button
                  type="button"
                  disabled={generatingLetter}
                  onClick={() => void generateClaimLetter()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {generatingLetter
                    ? "Generating..."
                    : workflow.claimLetterPdfPath ? "Regenerate" : "Generate"}
                </button>
              )}
            </div>
          </div>

          {/* Claim Summary */}
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Claim Summary</h3>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  workflow.summaryPdfPath
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {workflow.summaryPdfPath ? "Generated" : "Belum"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {workflow.summaryGeneratedAt
                ? `Generated at ${dateText(workflow.summaryGeneratedAt)}`
                : "Ringkasan tabel item dan total klaim."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {workflow.summaryPdfPath && (
                <a
                  href={`/api/claim-workflow/${id}/summary`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10"
                >
                  Open PDF
                </a>
              )}
              {canGenerateSummary && (
                <button
                  type="button"
                  disabled={generatingSummary}
                  onClick={() => void generateClaimSummary()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {generatingSummary
                    ? "Generating..."
                    : workflow.summaryPdfPath ? "Regenerate" : "Generate"}
                </button>
              )}
            </div>
          </div>

          {/* Kwitansi Claim */}
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">Kwitansi Claim</h3>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  workflow.receiptPdfPath
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {workflow.receiptPdfPath ? "Generated" : "Belum"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {workflow.receiptGeneratedAt
                ? `Generated at ${dateText(workflow.receiptGeneratedAt)}`
                : "Kwitansi pengajuan klaim (pre-submission)."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {workflow.receiptPdfPath && (
                <a
                  href={`/api/claim-workflow/${id}/receipt`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10"
                >
                  Open PDF
                </a>
              )}
              {canGenerateReceipt && (
                <button
                  type="button"
                  disabled={generatingReceipt}
                  onClick={() => void generateClaimReceipt()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {generatingReceipt
                    ? "Generating..."
                    : workflow.receiptPdfPath ? "Regenerate" : "Generate"}
                </button>
              )}
            </div>
          </div>
        </div>

        {(workflow.status === claimWorkflowStatuses.draft ||
          workflow.status === claimWorkflowStatuses.needRevision) && (
          <p className="mt-4 text-xs text-amber-200">
            Mark Ready memerlukan ketiga dokumen di atas, plus No Claim ter-assign dan Total Claim &gt; 0.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c23] shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="font-bold text-white">Items</h2>
            <p className="mt-1 text-xs text-slate-400">
              DPP, PPN Rate, PPH Rate, dan catatan dapat diedit hanya saat Draft atau Need Revision.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {items.length} item
          </p>
        </div>
        {items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            Tidak ada item Claim Workflow.
          </div>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="min-w-[1450px] text-left text-sm">
              <thead className="sticky top-0 z-20 bg-[#1a1c23]/95 text-xs uppercase tracking-wider text-slate-500 backdrop-blur supports-[backdrop-filter]:bg-[#1a1c23]/70">
                <tr className="border-b border-white/10">
                  <th scope="col" className="sticky left-0 z-30 bg-[#1a1c23]/95 px-4 py-3 font-semibold backdrop-blur supports-[backdrop-filter]:bg-[#1a1c23]/70">No Surat</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Jenis Promosi</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Periode</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Outlet</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">DPP</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">PPN Rate</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">PPN Amount</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">PPH Rate</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">PPH Amount</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Nilai Klaim</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((item) => {
                  const isEditing = editable && editingId === item.id && draft;
                  const inputClass = "w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-right tabular-nums text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40";
                  return (
                    <tr key={item.id} className="text-slate-300 transition-colors hover:bg-white/[0.03]">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-[#1a1c23] px-4 py-3 font-mono text-slate-100 group-hover:bg-[#1d2027]">
                        {item.noSurat || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-200">{item.jenisPromosi || "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-300">{item.periode || "-"}</td>
                      <td className="px-4 py-3 text-slate-300">{item.outlet || "-"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={draft.dpp}
                            onChange={(event) => setDraft({ ...draft, dpp: event.target.value })}
                            className={`${inputClass} w-32`}
                          />
                        ) : (
                          rupiah(item.dpp)
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            value={draft.ppnRate}
                            onChange={(event) => setDraft({ ...draft, ppnRate: event.target.value })}
                            className={`${inputClass} w-20`}
                          />
                        ) : (
                          `${item.ppnRate}%`
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">{rupiah(item.ppnAmount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            value={draft.pphRate}
                            onChange={(event) => setDraft({ ...draft, pphRate: event.target.value })}
                            className={`${inputClass} w-20`}
                          />
                        ) : (
                          `${item.pphRate}%`
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-300">{rupiah(item.pphAmount)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-white">{rupiah(item.nilaiKlaim)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold text-slate-300">
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="min-w-[240px] space-y-2">
                            <input
                              value={draft.note}
                              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                              placeholder="Catatan"
                              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={savingId === item.id}
                                onClick={() => void saveEdit(item.id)}
                                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                              >
                                {savingId === item.id ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId("");
                                  setDraft(null);
                                }}
                                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-white/5"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : editable ? (
                          <button
                            type="button"
                            onClick={() => startEdit(item)}
                            className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/20"
                          >
                            Edit Tax
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
        <h2 className="font-bold text-white">Audit</h2>
        {auditError ? (
          <p className="mt-4 text-sm text-slate-400">{auditError}</p>
        ) : audit.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Belum ada audit log.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {audit.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold text-white">{entry.action}</span>
                  <span className="text-xs text-slate-500">{dateText(entry.createdAt)}</span>
                </div>
                <p className="mt-1 text-slate-400">
                  {entry.actorName || "System"}{entry.actorRole ? ` (${entry.actorRole})` : ""}
                  {entry.note ? ` | ${entry.note}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
