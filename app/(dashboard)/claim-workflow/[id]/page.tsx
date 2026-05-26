"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { claimWorkflowStatuses } from "@/lib/claim-workflow/constants";

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
  ecPeka?: string | null;
  cnNumber?: string | null;
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

function statusTone(status: string) {
  if (status === claimWorkflowStatuses.paid || status === claimWorkflowStatuses.closed) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (status === claimWorkflowStatuses.needRevision || status === claimWorkflowStatuses.cancelled) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  }
  if (
    status === claimWorkflowStatuses.submittedToPrincipal ||
    status === claimWorkflowStatuses.waitingPeka
  ) {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [transitionLoading, setTransitionLoading] = useState<TransitionAction | "">("");
  const [generatingLetter, setGeneratingLetter] = useState(false);

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
  }, [id]);

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
      if (action === "submit_to_principal") {
        const confirmed =
          typeof window !== "undefined"
            ? window.confirm(
                "Submit Claim Workflow ini ke Principal? Item pajak akan dikunci setelah ini.",
              )
            : true;
        if (!confirmed) return;
      }
      setTransitionLoading(action);
      setMessage("");
      try {
        const response = await fetch(`/api/claim-workflow/${id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
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

  // Phase 2B: tombol transisi hanya untuk status Draft / Need Revision
  // (Mark Ready) dan Ready to Submit (Return to Draft, Submit to Principal).
  // Status setelah Submitted to Principal belum punya transisi di phase ini.
  const transitions: TransitionAction[] =
    workflow.status === claimWorkflowStatuses.draft ||
    workflow.status === claimWorkflowStatuses.needRevision
      ? ["mark_ready"]
      : workflow.status === claimWorkflowStatuses.readyToSubmit
        ? ["return_to_draft", "submit_to_principal"]
        : [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12 pt-4">
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
            <span className={`rounded-full border px-3 py-1.5 text-sm font-bold ${statusTone(workflow.status)}`}>
              {workflow.status}
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
      </section>

      {message && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-bold text-white">Claim Letter</h2>
            <p className="mt-1 text-sm text-slate-400">
              {workflow.claimLetterGeneratedAt
                ? `Generated at ${dateText(workflow.claimLetterGeneratedAt)}`
                : "Not generated"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {workflow.claimLetterPdfPath && (
              <a
                href={`/api/claim-workflow/${id}/claim-letter`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10"
              >
                Open Claim Letter PDF
              </a>
            )}
            {canGenerateClaimLetter && (
              <button
                type="button"
                disabled={generatingLetter}
                onClick={() => void generateClaimLetter()}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {generatingLetter ? "Generating..." : "Generate Claim Letter PDF"}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c23]">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="font-bold text-white">Items</h2>
          <p className="mt-1 text-xs text-slate-400">
            DPP, PPN Rate, PPH Rate, dan catatan dapat diedit hanya saat Draft atau Need Revision.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1650px] text-left text-sm">
            <thead className="bg-black/20 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                {["No Surat", "Jenis Promosi", "Periode", "Outlet", "DPP", "PPN Rate", "PPN Amount", "PPH Rate", "PPH Amount", "Nilai Klaim", "EC PEKA", "CN Number", "Status", "Action"].map((header) => (
                  <th key={header} className="px-4 py-3">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((item) => {
                const isEditing = editable && editingId === item.id && draft;
                return (
                  <tr key={item.id} className="text-slate-300">
                    <td className="whitespace-nowrap px-4 py-3 font-mono">{item.noSurat || "-"}</td>
                    <td className="px-4 py-3">{item.jenisPromosi || "-"}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.periode || "-"}</td>
                    <td className="px-4 py-3">{item.outlet || "-"}</td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <input type="number" min="0" step="any" value={draft.dpp} onChange={(event) => setDraft({ ...draft, dpp: event.target.value })} className="w-32 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-right text-white" />
                      ) : rupiah(item.dpp)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <input type="number" min="0" max="100" step="any" value={draft.ppnRate} onChange={(event) => setDraft({ ...draft, ppnRate: event.target.value })} className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-right text-white" />
                      ) : `${item.ppnRate}%`}
                    </td>
                    <td className="px-4 py-3 text-right">{rupiah(item.ppnAmount)}</td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <input type="number" min="0" max="100" step="any" value={draft.pphRate} onChange={(event) => setDraft({ ...draft, pphRate: event.target.value })} className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-right text-white" />
                      ) : `${item.pphRate}%`}
                    </td>
                    <td className="px-4 py-3 text-right">{rupiah(item.pphAmount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{rupiah(item.nilaiKlaim)}</td>
                    <td className="px-4 py-3">{item.ecPeka || "-"}</td>
                    <td className="px-4 py-3">{item.cnNumber || "-"}</td>
                    <td className="px-4 py-3">{item.status}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="min-w-[220px] space-y-2">
                          <input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Catatan" className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-white" />
                          <div className="flex gap-2">
                            <button type="button" disabled={savingId === item.id} onClick={() => void saveEdit(item.id)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{savingId === item.id ? "Saving..." : "Save"}</button>
                            <button type="button" onClick={() => { setEditingId(""); setDraft(null); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-300">Cancel</button>
                          </div>
                        </div>
                      ) : editable ? (
                        <button type="button" onClick={() => startEdit(item)} className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-200">
                          Edit Tax
                        </button>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-slate-500">Tidak ada item Claim Workflow.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
