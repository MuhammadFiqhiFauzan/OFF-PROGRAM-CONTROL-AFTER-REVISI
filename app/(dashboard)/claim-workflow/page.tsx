"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText,
  Send,
  Wallet,
  CircleDollarSign,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { claimWorkflowStatuses } from "@/lib/claim-workflow/constants";
import { resolveOffRole } from "@/lib/off-program-control/access";

type ClaimWorkflowListRow = {
  id: string;
  claimWorkflowNo: string;
  offBatchId: string;
  offNoPengajuan?: string | null;
  principleName: string;
  status: string;
  totalClaim: number;
  totalPaid: number;
  remainingAmount: number;
  createdAt: string | Date;
};

type PekaImportWarning = {
  rowIndex: number;
  field: string;
  message: string;
};

type PekaImportResult = {
  ok?: boolean;
  success?: boolean;
  error?: string;
  message?: string;
  importedCount?: number;
  skippedCount?: number;
  warningCount?: number;
  warnings?: PekaImportWarning[];
  sourceFile?: string;
};

function rupiah(value: number) {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function createdDate(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function statusTone(status: string) {
  if (
    status === claimWorkflowStatuses.closed ||
    status === claimWorkflowStatuses.paid
  ) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (
    status === claimWorkflowStatuses.needRevision ||
    status === claimWorkflowStatuses.cancelled
  ) {
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

export default function ClaimWorkflowPage() {
  const [rows, setRows] = useState<ClaimWorkflowListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const { data: session } = authClient.useSession();
  const sessionUser = session?.user as
    | {
        name?: string | null;
        email?: string | null;
        role?: unknown;
        userRole?: unknown;
        type?: unknown;
        position?: unknown;
        department?: unknown;
      }
    | undefined;
  const offRoleInfo = resolveOffRole({
    role: sessionUser?.role,
    userRole: sessionUser?.userRole,
    type: sessionUser?.type,
    position: sessionUser?.position,
    department: sessionUser?.department,
    email: sessionUser?.email,
  });
  // Hanya admin/claim yang boleh melihat tombol import. staff tetap read-only.
  const canImportPeka =
    offRoleInfo.role === "admin" || offRoleInfo.role === "claim";

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<PekaImportResult | null>(null);

  const handlePekaImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/claim-workflow/peka/import", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as PekaImportResult;
      if (!response.ok || !result.ok) {
        const message = result.error || "Gagal mengimpor PEKA report.";
        toast.error(message);
        setImportResult({ ...result, error: message });
        return;
      }
      const importedCount = result.importedCount ?? 0;
      const skippedCount = result.skippedCount ?? 0;
      toast.success(
        `Import PEKA selesai: ${importedCount} baris masuk, ${skippedCount} di-skip.`,
      );
      setImportResult(result);
    } catch (importError) {
      const message =
        importError instanceof Error
          ? importError.message
          : "Gagal mengimpor PEKA report.";
      toast.error(message);
      setImportResult({ ok: false, error: message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/claim-workflow", {
          cache: "no-store",
        });
        const result = (await response.json()) as {
          ok?: boolean;
          workflows?: ClaimWorkflowListRow[];
          error?: string;
        };
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "Gagal memuat Claim Workflow.");
        }
        if (active) setRows(result.workflows || []);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Gagal memuat Claim Workflow.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(
    () => [
      {
        label: "Total Claim Workflow",
        value: rows.length,
        icon: FileText,
        tone: "text-indigo-300",
      },
      {
        label: "Draft",
        value: rows.filter((row) => row.status === claimWorkflowStatuses.draft)
          .length,
        icon: Clock3,
        tone: "text-amber-300",
      },
      {
        label: "Submitted/Waiting PEKA",
        value: rows.filter(
          (row) =>
            row.status === claimWorkflowStatuses.submittedToPrincipal ||
            row.status === claimWorkflowStatuses.waitingPeka,
        ).length,
        icon: Send,
        tone: "text-sky-300",
      },
      {
        label: "Paid",
        value: rows.filter((row) => row.status === claimWorkflowStatuses.paid)
          .length,
        icon: Wallet,
        tone: "text-emerald-300",
      },
      {
        label: "Outstanding",
        value: rows.filter(
          (row) => row.status === claimWorkflowStatuses.outstanding,
        ).length,
        icon: CircleDollarSign,
        tone: "text-orange-300",
      },
      {
        label: "Closed",
        value: rows.filter((row) => row.status === claimWorkflowStatuses.closed)
          .length,
        icon: CheckCircle2,
        tone: "text-emerald-300",
      },
    ],
    [rows],
  );

  return (
    <div className="w-full space-y-6 pb-12 pt-2">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#1a1c23] to-[#0f1115] p-7 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-300">
          After OFF Program Control
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
          Claim Workflow
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Monitoring pengajuan principal, PEKA, EC/CN, dan pembayaran setelah
          OFF selesai diverifikasi.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="rounded-2xl border border-white/10 bg-[#1a1c23] p-4"
            >
              <Icon size={19} className={metric.tone} />
              <p className="mt-4 text-2xl font-black text-white">
                {metric.value}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-400">
                {metric.label}
              </p>
            </div>
          );
        })}
      </section>

      {canImportPeka && (
        <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold text-white">PEKA Manual Import</h2>
              <p className="mt-1 text-xs text-slate-400">
                Import file PEKA (.xlsx atau .csv) ke `claim_peka_report`. Phase 3A: hanya menyiapkan data untuk preview matching, tidak menulis EC/CN ke item.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                disabled={importing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handlePekaImport(file);
                }}
                className="text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-indigo-500"
              />
              {importing && (
                <span className="text-xs font-semibold text-indigo-200">Mengimpor...</span>
              )}
            </div>
          </div>
          {importResult && (
            <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-slate-300">
              {importResult.error ? (
                <p className="text-rose-300">{importResult.error}</p>
              ) : (
                <>
                  <p>
                    <span className="font-semibold text-white">{importResult.sourceFile}</span> — diimpor {importResult.importedCount ?? 0}, di-skip {importResult.skippedCount ?? 0}, warning {importResult.warningCount ?? 0}.
                  </p>
                  {importResult.message && (
                    <p className="text-amber-200">{importResult.message}</p>
                  )}
                  {importResult.warnings && importResult.warnings.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-amber-200">
                      {importResult.warnings.map((warning, index) => (
                        <li key={`${warning.rowIndex}-${warning.field}-${index}`}>
                          Row {warning.rowIndex + 1}: {warning.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c23] shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">Daftar Claim Workflow</h2>
            {!loading && !error && (
              <p className="mt-1 text-xs text-slate-500">
                {rows.length} workflow ditampilkan
              </p>
            )}
          </div>
        </div>
        {loading ? (
          <div className="px-5 py-16 text-center text-sm text-slate-400">
            Memuat data Claim Workflow...
          </div>
        ) : error ? (
          <div className="mx-5 my-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-4 text-center text-sm text-rose-200">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <FileText size={28} className="mx-auto text-slate-600" />
            <p className="mt-3 text-sm font-medium text-slate-300">
              Belum ada Claim Workflow.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Draft pertama dapat dibuat dari OFF batch yang sudah Completed dan Paid.
            </p>
          </div>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#1a1c23]/95 text-xs uppercase tracking-wider text-slate-500 backdrop-blur supports-[backdrop-filter]:bg-[#1a1c23]/70">
                <tr className="border-b border-white/10">
                  <th scope="col" className="px-5 py-3 font-semibold">Claim Workflow No</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Principle</th>
                  <th scope="col" className="px-5 py-3 font-semibold">OFF Batch / No Pengajuan</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Total Claim</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Total Paid</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Outstanding</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="text-slate-300 transition-colors hover:bg-white/[0.04]"
                  >
                    <td className="whitespace-nowrap px-5 py-4 font-semibold">
                      <Link
                        href={`/claim-workflow/${row.id}`}
                        className="font-mono text-indigo-200 transition-colors hover:text-indigo-100 hover:underline"
                      >
                        {row.claimWorkflowNo}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-slate-200">{row.principleName}</td>
                    <td className="whitespace-nowrap px-5 py-4">
                      <p className="text-slate-200">{row.offNoPengajuan || "-"}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                        {row.offBatchId.slice(0, 8)}…
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-semibold tabular-nums text-white">
                      {rupiah(row.totalClaim)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums text-slate-200">
                      {rupiah(row.totalPaid)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-5 py-4 text-right tabular-nums ${
                        row.remainingAmount > 0 ? "text-amber-200" : "text-slate-500"
                      }`}
                    >
                      {rupiah(row.remainingAmount)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-400">
                      {createdDate(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
