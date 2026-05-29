"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  // R7a — Multi No Claim: source type / aggregate status optional pada
  // detail response. Fallback ke "off_program" / status workflow saat
  // field belum ada di payload.
  sourceType?: string | null;
  aggregateStatus?: string | null;
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
  closedAt?: string | Date | null;
  closedBy?: string | null;
  closeNote?: string | null;
  paymentDerivedStatus?: string;
  statusDriftWarning?: boolean;
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
  // Phase R7b — Multi No Claim: item dapat di-link ke claim_submission.
  claimSubmissionId?: string | null;
};

// Phase R7b — Multi No Claim: minimal type untuk daftar submission.
type Submission = {
  id: string;
  claimWorkflowId: string;
  noClaim?: string | null;
  scope: string;
  scopeLabel?: string | null;
  status: string;
  totalClaim: number;
  totalPaid: number;
  remainingAmount: number;
  itemCount?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  // Phase R7c — Documents per submission:
  claimLetterPdfPath?: string | null;
  claimLetterGeneratedAt?: string | Date | null;
  summaryPdfPath?: string | null;
  summaryGeneratedAt?: string | Date | null;
  receiptPdfPath?: string | null;
  receiptGeneratedAt?: string | Date | null;
};

const SUBMISSION_SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "per_pengajuan", label: "Per Pengajuan" },
  { value: "per_program", label: "Per Program" },
  { value: "per_toko", label: "Per Toko" },
  { value: "per_item", label: "Per Baris / Item" },
  { value: "custom", label: "Custom" },
];

type AuditRow = {
  id: string;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  note?: string | null;
  createdAt: string | Date;
};

type Payment = {
  id: string;
  paymentDate: string;
  paymentAmount: number;
  paymentType?: string | null;
  paymentNote?: string | null;
  createdBy?: string | null;
  voidedAt?: string | Date | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt: string | Date;
};

type PaymentSummary = {
  totalClaim: number;
  totalPaid: number;
  remainingAmount: number;
  paymentStatus: string;
  persistedStatus?: string;
  paymentDerivedStatus?: string;
  statusDriftWarning?: boolean;
  paymentCount: number;
  activePaymentCount: number;
  voidedPaymentCount: number;
};

type DetailResult = {
  ok?: boolean;
  error?: string;
  workflow?: Workflow;
  items?: WorkflowItem[];
  payments?: Payment[];
  activePayments?: Payment[];
  voidedPayments?: Payment[];
  paymentSummary?: PaymentSummary;
  // Phase R7b — Multi No Claim
  submissions?: Submission[];
  submissionCount?: number;
  hasMultipleSubmissions?: boolean;
  noClaimList?: string[];
  noClaimDisplay?: string | null;
  canEditItems?: boolean;
  canGenerateClaimLetter?: boolean;
  canGenerateSummary?: boolean;
  canGenerateReceipt?: boolean;
  canAssignNoClaim?: boolean;
  canRecordPayment?: boolean;
  canVoidPayment?: boolean;
  canClose?: boolean;
  closeBlockers?: string[];
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

// =============================================================================
// R7 — UX Experiment Helpers (frontend only)
// =============================================================================
// Helpers berikut tidak menyentuh backend. Mereka hanya membantu UI
// merangkum status submission menjadi label step-guidance yang ramah staff.
//
// Aturan tone:
// - warning  → kuning/amber (butuh aksi user)
// - info     → indigo/sky (langkah normal selanjutnya)
// - success  → emerald (selesai / OK)
// - neutral  → slate (informasi netral)

type GuidanceTone = "warning" | "info" | "success" | "neutral";

const SCOPE_DISPLAY_LABEL: Record<string, string> = {
  per_pengajuan: "Per Pengajuan",
  per_program: "Per Program",
  per_toko: "Per Toko",
  per_item: "Per Baris / Item",
  custom: "Custom",
};

const SCOPE_HELPER_TEXT: Record<string, string> = {
  per_pengajuan: "Satu paket untuk seluruh pengajuan.",
  per_program: "Pisahkan klaim berdasarkan program.",
  per_toko: "Pisahkan klaim berdasarkan toko.",
  per_item:
    "Satu item/baris klaim menjadi satu Paket No Claim. Ini paling mirip sheet BASE di Excel.",
  custom: "Grouping manual sesuai kebutuhan.",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  off_program: "OFF Program",
  direct_kwitansi: "Direct Kwitansi",
  manual: "Manual",
};

function getScopeDisplayLabel(scope: string | null | undefined): string {
  if (!scope) return "Paket Klaim";
  return SCOPE_DISPLAY_LABEL[scope] || scope;
}

function getScopeHelper(scope: string | null | undefined): string {
  if (!scope) return "";
  return SCOPE_HELPER_TEXT[scope] || "";
}

// =============================================================================
// R7g — Excel-style No Claim Generator helpers
// =============================================================================
// Pola Excel Godrej: No Claim = sequence + "/" + distributor + "-" + principal
// + "/" + month(2 digit) + "/" + year(4 digit). Contoh: 01/SUPER-GCPI/02/2026.
//
// Default month/year diambil dari zona Asia/Makassar (UTC+08:00) supaya tidak
// bergantung timezone browser/server.

/**
 * Hasilkan komponen tanggal (year/month/day, 2 digit untuk month/day, 4 digit
 * untuk year) menurut zona Asia/Makassar. Berfungsi di browser dan Node modern
 * via Intl.DateTimeFormat.
 */
function getMakassarDateParts(date: Date = new Date()): {
  year: string;
  month: string;
  day: string;
} {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Makassar",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year").padStart(4, "0");
    const month = get("month").padStart(2, "0");
    const day = get("day").padStart(2, "0");
    if (year && month && day) return { year, month, day };
  } catch {
    // Intl tidak tersedia; fallback di bawah.
  }
  // Fallback aman tanpa timezone (tidak ideal, tetapi mencegah crash).
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return { year: yyyy, month: mm, day: dd };
}

/**
 * Format sequence sesuai pola Excel: angka 1-9 di-pad jadi 2 digit ("01"),
 * angka 10+ apa adanya, dan string non-numeric apa adanya (trim). Tidak
 * memaksa 3 digit.
 */
function formatNoClaimSequence(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 1 && n <= 9) {
      return String(n).padStart(2, "0");
    }
    // 10+ → as typed (tetapi buang leading zero ganda kalau ada).
    return String(Number(trimmed));
  }
  return trimmed;
}

type NoClaimGeneratorDraft = {
  sequence: string;
  distributorCode: string;
  principalCode: string;
  month: string;
  year: string;
};

/**
 * Validasi draft generator. Return error message pertama (string) atau null.
 */
function validateNoClaimGenerator(
  draft: NoClaimGeneratorDraft,
): string | null {
  if (!draft.sequence.trim()) return "Nomor urut wajib diisi.";
  if (!draft.distributorCode.trim()) return "Kode distributor wajib diisi.";
  if (!draft.principalCode.trim()) return "Kode principal wajib diisi.";
  const month = draft.month.trim();
  if (!/^\d{2}$/.test(month)) return "Bulan harus 2 digit (01-12).";
  const monthNum = Number(month);
  if (monthNum < 1 || monthNum > 12) return "Bulan harus 01-12.";
  if (!/^\d{4}$/.test(draft.year.trim())) return "Tahun harus 4 digit.";
  return null;
}

/**
 * Build preview string dari draft. Tidak melakukan validasi; caller pakai
 * `validateNoClaimGenerator` terlebih dulu jika ingin tahu valid atau tidak.
 */
function buildNoClaimPreview(draft: NoClaimGeneratorDraft): string {
  const sequence = formatNoClaimSequence(draft.sequence);
  const distributor = draft.distributorCode.trim();
  const principal = draft.principalCode.trim();
  const month = draft.month.trim();
  const year = draft.year.trim();
  if (!sequence || !distributor || !principal || !month || !year) return "";
  return `${sequence}/${distributor}-${principal}/${month}/${year}`;
}

/**
 * Tebak kode principal dari nama principle workflow. Default fallback "GCPI"
 * (Godrej Consumer Products Indonesia) sesuai pola Excel sumber R7g.
 */
function guessPrincipalCode(principleName: string | null | undefined): string {
  const name = String(principleName || "").toLowerCase();
  if (name.includes("godrej") || name.includes("gcpi")) return "GCPI";
  return "GCPI";
}

/**
 * R7h — parse komponen No Claim Excel-style dari string `noClaim`. Pattern:
 * `{sequence}/{distributor}-{principal}/{MM}/{YYYY}`. Bila format tidak
 * cocok, return null. Caller pakai null untuk fallback default Makassar +
 * SUPER/GCPI saat menampilkan No.2 dan Bulan kosong di table.
 */
function parseNoClaimComponents(value: string | null | undefined): {
  sequence: string;
  distributorCode: string;
  principalCode: string;
  month: string;
  year: string;
} | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^([A-Za-z0-9]+)\/([A-Za-z0-9]+)-([A-Za-z0-9]+)\/(\d{2})\/(\d{4})$/,
  );
  if (!match) return null;
  return {
    sequence: match[1],
    distributorCode: match[2],
    principalCode: match[3],
    month: match[4],
    year: match[5],
  };
}

function getSubmissionTitle(submission: Submission): string {
  const label = (submission.scopeLabel || "").trim();
  if (label) return label;
  return getScopeDisplayLabel(submission.scope);
}

function getSubmissionDocumentsCompletedCount(submission: Submission): number {
  let count = 0;
  if (submission.claimLetterPdfPath) count += 1;
  if (submission.summaryPdfPath) count += 1;
  if (submission.receiptPdfPath) count += 1;
  return count;
}

function isSubmissionDocumentsComplete(submission: Submission): boolean {
  return getSubmissionDocumentsCompletedCount(submission) >= 3;
}

function isSubmissionClosed(submission: Submission): boolean {
  return submission.status === claimWorkflowStatuses.closed;
}

function getSubmissionRemainingAmount(submission: Submission): number {
  return Number(submission.remainingAmount || 0);
}

function getSubmissionNextAction(submission: Submission): {
  label: string;
  tone: GuidanceTone;
} {
  const noClaimEmpty = !submission.noClaim || !String(submission.noClaim).trim();
  const docsIncomplete = !isSubmissionDocumentsComplete(submission);
  const status = submission.status;
  const remaining = getSubmissionRemainingAmount(submission);

  if (status === claimWorkflowStatuses.closed) {
    return { label: "Selesai", tone: "neutral" };
  }
  if (noClaimEmpty) {
    return { label: "Isi No Claim", tone: "warning" };
  }
  if (docsIncomplete) {
    return { label: "Lengkapi dokumen", tone: "warning" };
  }
  if (
    status === claimWorkflowStatuses.draft ||
    status === claimWorkflowStatuses.needRevision
  ) {
    return { label: "Siap diproses", tone: "info" };
  }
  if (status === claimWorkflowStatuses.readyToSubmit) {
    return { label: "Submit ke principal", tone: "info" };
  }
  if (status === claimWorkflowStatuses.submittedToPrincipal && remaining > 0) {
    return { label: "Menunggu pembayaran", tone: "warning" };
  }
  if (status === claimWorkflowStatuses.partiallyPaid) {
    return { label: "Follow up outstanding", tone: "warning" };
  }
  if (status === claimWorkflowStatuses.paid) {
    return { label: "Close paket", tone: "success" };
  }
  return { label: "Cek detail paket", tone: "neutral" };
}

function getWorkflowGuidance(submissions: Submission[]): {
  message: string;
  tone: GuidanceTone;
} {
  if (submissions.length === 0) {
    return {
      message: "Buat paket pertama untuk mulai mengelompokkan item klaim.",
      tone: "info",
    };
  }
  const allClosed = submissions.every((s) => isSubmissionClosed(s));
  if (allClosed) {
    return { message: "Semua paket selesai.", tone: "success" };
  }
  const missingNoClaim = submissions.filter(
    (s) => !s.noClaim || !String(s.noClaim).trim(),
  ).length;
  if (missingNoClaim > 0) {
    return {
      message: `${missingNoClaim} paket belum punya No Claim.`,
      tone: "warning",
    };
  }
  const docsIncomplete = submissions.filter(
    (s) => !isSubmissionDocumentsComplete(s) && !isSubmissionClosed(s),
  ).length;
  if (docsIncomplete > 0) {
    return {
      message: `${docsIncomplete} paket dokumennya belum lengkap.`,
      tone: "warning",
    };
  }
  const outstanding = submissions.filter(
    (s) =>
      !isSubmissionClosed(s) &&
      getSubmissionRemainingAmount(s) > 0 &&
      (s.status === claimWorkflowStatuses.submittedToPrincipal ||
        s.status === claimWorkflowStatuses.partiallyPaid),
  ).length;
  if (outstanding > 0) {
    return {
      message: `${outstanding} paket masih outstanding.`,
      tone: "warning",
    };
  }
  return {
    message: "Pilih paket untuk melanjutkan proses.",
    tone: "info",
  };
}

function getGuidanceClass(tone: GuidanceTone): string {
  switch (tone) {
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "info":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-200";
    default:
      return "border-white/10 bg-white/5 text-slate-300";
  }
}

const SUBMISSION_LAYOUT_STORAGE_KEY = "claimWorkflowSubmissionLayoutMode";
type SubmissionLayoutMode =
  | "excel"
  | "master"
  | "accordion"
  | "card"
  | "focus"
  | "board";

const SUBMISSION_LAYOUT_OPTIONS: Array<{
  value: SubmissionLayoutMode;
  label: string;
  hint: string;
}> = [
  {
    value: "excel",
    label: "Excel Input",
    hint: "Tabel mirip BASE Godrej. Default untuk staff.",
  },
  {
    value: "master",
    label: "Master Detail",
    hint: "Daftar paket di kiri, detail di kanan.",
  },
  {
    value: "accordion",
    label: "Accordion",
    hint: "Buka tutup paket satu per satu.",
  },
  {
    value: "card",
    label: "Kartu",
    hint: "Grid kartu ringkas + detail di bawah.",
  },
  {
    value: "focus",
    label: "Fokus",
    hint: "Satu paket per layar dengan navigasi sebelumnya/berikutnya.",
  },
  {
    value: "board",
    label: "Status Board",
    hint: "Paket dikelompokkan per tahap.",
  },
];

const ALLOWED_LAYOUT_MODES = SUBMISSION_LAYOUT_OPTIONS.map((opt) => opt.value);

function readStoredLayoutMode(): SubmissionLayoutMode {
  if (typeof window === "undefined") return "excel";
  try {
    const raw = window.localStorage.getItem(SUBMISSION_LAYOUT_STORAGE_KEY);
    if (raw && (ALLOWED_LAYOUT_MODES as ReadonlyArray<string>).includes(raw)) {
      return raw as SubmissionLayoutMode;
    }
  } catch {
    // localStorage might be unavailable; fallback to default.
  }
  return "excel";
}

// R7 UX experiment — group submissions ke 3 lifecycle stage besar agar
// Status Board mudah dipahami staff non-teknis. Tahap apapun yang butuh
// input user → "needs_action"; sudah jalan tapi belum selesai →
// "in_progress"; sudah closed → "done".
type SubmissionLifecycleStage = "needs_action" | "in_progress" | "done";

function getSubmissionLifecycleStage(
  submission: Submission,
): SubmissionLifecycleStage {
  if (isSubmissionClosed(submission)) return "done";
  const noClaimEmpty =
    !submission.noClaim || !String(submission.noClaim).trim();
  const docsIncomplete = !isSubmissionDocumentsComplete(submission);
  if (noClaimEmpty || docsIncomplete) return "needs_action";
  if (
    submission.status === claimWorkflowStatuses.draft ||
    submission.status === claimWorkflowStatuses.needRevision
  ) {
    return "needs_action";
  }
  if (submission.status === claimWorkflowStatuses.paid) {
    return "needs_action";
  }
  return "in_progress";
}

const LIFECYCLE_STAGES: Array<{
  key: SubmissionLifecycleStage;
  title: string;
  description: string;
  badgeClass: string;
  cardClass: string;
}> = [
  {
    key: "needs_action",
    title: "Butuh Aksi",
    description: "Paket yang menunggu input atau dokumen dari kamu.",
    badgeClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-200",
    cardClass:
      "border-amber-500/20 bg-amber-500/5",
  },
  {
    key: "in_progress",
    title: "Sedang Diproses",
    description: "Paket yang sudah berjalan dan menunggu pembayaran.",
    badgeClass:
      "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
    cardClass:
      "border-indigo-500/20 bg-indigo-500/5",
  },
  {
    key: "done",
    title: "Selesai",
    description: "Paket yang sudah closed.",
    badgeClass:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    cardClass:
      "border-emerald-500/20 bg-emerald-500/5",
  },
];

// =============================================================================
// R7 UX experiment — Shared card render helpers (Single Source of Truth)
// =============================================================================
// Master Detail / Accordion / Kartu / Status Board semuanya menampilkan
// ringkasan paket dengan field yang sama (scope badge, status badge,
// No Claim, totals, dokumen X/3, outstanding, next action). Helper di
// bawah dipakai oleh keempat mode supaya kalau bisnis menambah field
// wajib baru, perubahan cukup di satu tempat.
//
// Tetap pure functions yang return JSX agar tidak menyentuh state komponen
// utama. Caller bertanggung jawab atas wrapper layout (grid/flex/padding).

function SubmissionScopeStatusBadges({
  submission,
}: {
  submission: Submission;
}) {
  return (
    <>
      <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-200">
        {getScopeDisplayLabel(submission.scope)}
      </span>
      <span
        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone(submission.status)}`}
      >
        {displayClaimStatusLabel(submission.status)}
      </span>
    </>
  );
}

function SubmissionNoClaimLine({
  submission,
  className,
}: {
  submission: Submission;
  className?: string;
}) {
  const noClaimEmpty =
    !submission.noClaim || !String(submission.noClaim).trim();
  if (noClaimEmpty) {
    return (
      <p
        className={`${className ?? ""} font-semibold text-amber-200`.trim()}
      >
        Belum ada No Claim
      </p>
    );
  }
  return (
    <p className={`${className ?? ""} font-mono text-emerald-200`.trim()}>
      {submission.noClaim}
    </p>
  );
}

function SubmissionNextActionBadge({
  submission,
}: {
  submission: Submission;
}) {
  const next = getSubmissionNextAction(submission);
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getGuidanceClass(next.tone)}`}
    >
      {next.label}
    </span>
  );
}

function SubmissionMetaRow({
  submission,
  showItems = true,
  abbreviated = false,
}: {
  submission: Submission;
  showItems?: boolean;
  abbreviated?: boolean;
}) {
  const docsCount = getSubmissionDocumentsCompletedCount(submission);
  const remaining = getSubmissionRemainingAmount(submission);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
      <span>{rupiah(submission.totalClaim)}</span>
      {showItems && (
        <>
          <span className="text-slate-600">·</span>
          <span>{submission.itemCount ?? 0} item</span>
        </>
      )}
      <span className="text-slate-600">·</span>
      <span
        className={
          docsCount === 3 ? "text-emerald-300" : "text-amber-300"
        }
      >
        {abbreviated ? `Dok ${docsCount}/3` : `Dokumen ${docsCount}/3`}
      </span>
      {remaining > 0 && (
        <>
          <span className="text-slate-600">·</span>
          <span className="text-amber-300">
            {abbreviated
              ? rupiah(remaining)
              : `Outstanding ${rupiah(remaining)}`}
          </span>
        </>
      )}
    </div>
  );
}

export default function ClaimWorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id || "");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);
  const [canEditItems, setCanEditItems] = useState(false);
  const [canGenerateClaimLetter, setCanGenerateClaimLetter] = useState(false);
  const [canGenerateSummary, setCanGenerateSummary] = useState(false);
  const [canGenerateReceipt, setCanGenerateReceipt] = useState(false);
  const [canAssignNoClaim, setCanAssignNoClaim] = useState(false);
  const [canRecordPayment, setCanRecordPayment] = useState(false);
  const [canVoidPayment, setCanVoidPayment] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [closeBlockers, setCloseBlockers] = useState<string[]>([]);
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
  const [paymentDraft, setPaymentDraft] = useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentAmount: "",
    paymentType: "Transfer",
    paymentNote: "",
  });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [voidingId, setVoidingId] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closeSaving, setCloseSaving] = useState(false);
  // Phase R7b — Multi No Claim:
  // State minimal untuk section Submissions. Mark Ready / dokumen /
  // payment masih di workflow-level sampai R7c/R7d.
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [hasMultipleSubmissions, setHasMultipleSubmissions] = useState(false);
  const [createSubmissionScope, setCreateSubmissionScope] = useState("per_pengajuan");
  const [createSubmissionLabel, setCreateSubmissionLabel] = useState("");
  const [createSubmissionNoClaim, setCreateSubmissionNoClaim] = useState("");
  const [creatingSubmission, setCreatingSubmission] = useState(false);
  const [movingItemId, setMovingItemId] = useState("");
  // Phase R7c — Documents per submission: state generate per submission +
  // type. Key = `${submissionId}:${type}` supaya tombol per kombinasi
  // bisa disabled secara independen.
  const [generatingDocKey, setGeneratingDocKey] = useState("");
  // R7 UX experiment — dual layout state (frontend only).
  // Default mode: "master" (Master Detail + Step Guidance). Persist
  // pilihan ke localStorage agar mengikuti preferensi user lintas
  // navigasi. Tidak diserialisasi ke backend.
  const [submissionLayoutMode, setSubmissionLayoutMode] =
    useState<SubmissionLayoutMode>("excel");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(
    null,
  );
  const [openSubmissionIds, setOpenSubmissionIds] = useState<string[]>([]);
  const [showCreateSubmissionForm, setShowCreateSubmissionForm] = useState(false);
  // Per-submission No Claim editor state. Map submissionId → draft value.
  // Editor aktif ditandai oleh `submissionNoClaimEditingId`. Saving id
  // mencegah double click.
  const [submissionNoClaimDraft, setSubmissionNoClaimDraft] = useState<
    Record<string, string>
  >({});
  const [submissionNoClaimEditingId, setSubmissionNoClaimEditingId] =
    useState<string>("");
  const [submissionNoClaimSavingId, setSubmissionNoClaimSavingId] =
    useState<string>("");
  // R7g — Excel-style No Claim generator state.
  // Per submission: mode (manual | generate) + draft komponen generator.
  // Default month/year diambil dari Asia/Makassar saat mount; user boleh
  // menggantinya. Tidak dikirim ke backend; preview murni di-derive.
  const [submissionGeneratorMode, setSubmissionGeneratorMode] = useState<
    Record<string, "manual" | "generate">
  >({});
  const [submissionGeneratorDraft, setSubmissionGeneratorDraft] = useState<
    Record<string, NoClaimGeneratorDraft>
  >({});
  // R7g — Per Item action state.
  const [creatingPerItem, setCreatingPerItem] = useState(false);
  // R7h — Excel Input Mode state. Draft per item (No.2 + Bulan + DPP/PPN/PPH).
  // Tax (DPP/PPN/PPH) inline edit ke PATCH /items/[itemId] yang sudah ada
  // (ppnRate/pphRate). No Claim tetap di-save lewat PATCH submission.
  // Toolbar punya global generator settings (distributor/principal/year)
  // supaya kolom No.2 + Bulan per row tetap ringkas.
  const [excelDistributorCode, setExcelDistributorCode] = useState("SUPER");
  const [excelPrincipalCode, setExcelPrincipalCode] = useState("GCPI");
  const [excelYear, setExcelYear] = useState("2026");
  const [excelDefaultMonth, setExcelDefaultMonth] = useState("01");
  const [excelSearch, setExcelSearch] = useState("");
  const [excelStatusFilter, setExcelStatusFilter] = useState<
    "all" | "needs_no_claim" | "needs_docs" | "outstanding" | "paid"
  >("all");
  type ExcelRowDraft = {
    sequence: string;
    month: string;
    noClaimDraft: string;
    dpp: string;
    ppnRate: string;
    pphRate: string;
    initialNoClaim: string;
    initialDpp: string;
    initialPpnRate: string;
    initialPphRate: string;
  };
  const [excelRowDrafts, setExcelRowDrafts] = useState<
    Record<string, ExcelRowDraft>
  >({});
  const [excelRowSavingId, setExcelRowSavingId] = useState<string>("");
  // Track items yang sudah pernah di-init agar perubahan default toolbar
  // (year/month) tidak menimpa draft user yang aktif.
  const excelInitializedItemsRef = useRef<Set<string>>(new Set());

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
      setPayments(result.payments || []);
      setPaymentSummary(result.paymentSummary || null);
      setCanEditItems(Boolean(result.canEditItems));
      setCanGenerateClaimLetter(Boolean(result.canGenerateClaimLetter));
      setCanGenerateSummary(Boolean(result.canGenerateSummary));
      setCanGenerateReceipt(Boolean(result.canGenerateReceipt));
      setCanAssignNoClaim(Boolean(result.canAssignNoClaim));
      setCanRecordPayment(Boolean(result.canRecordPayment));
      setCanVoidPayment(Boolean(result.canVoidPayment));
      setCanClose(Boolean(result.canClose));
      setCloseBlockers(result.closeBlockers || []);
      // Phase R7b — Multi No Claim: populate submissions list.
      setSubmissions(result.submissions || []);
      setSubmissionCount(result.submissionCount ?? (result.submissions?.length ?? 0));
      setHasMultipleSubmissions(Boolean(result.hasMultipleSubmissions));
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

  // R7 UX experiment — hydrate layout mode dari localStorage. Dilakukan
  // sekali setelah mount untuk menghindari hydration mismatch (server
  // render selalu pakai default "master").
  useEffect(() => {
    setSubmissionLayoutMode(readStoredLayoutMode());
  }, []);

  // R7 UX experiment — persist layout mode pilihan user. Guard dengan
  // typeof window untuk SSR safety.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SUBMISSION_LAYOUT_STORAGE_KEY,
        submissionLayoutMode,
      );
    } catch {
      // ignore storage errors (private mode etc).
    }
  }, [submissionLayoutMode]);

  // R7 UX experiment — sinkronkan selected submission setelah submissions
  // berubah (load awal, create, delete, dsb).
  useEffect(() => {
    if (submissions.length === 0) {
      if (selectedSubmissionId !== null) setSelectedSubmissionId(null);
      return;
    }
    const stillExists = submissions.some((s) => s.id === selectedSubmissionId);
    if (!selectedSubmissionId || !stillExists) {
      setSelectedSubmissionId(submissions[0].id);
    }
  }, [submissions, selectedSubmissionId]);

  // R7 UX experiment — accordion default open. Spec: buka submission
  // pertama saat mount awal. Setelah itu user bebas menutup semua atau
  // memilih open ids manual. Implementasi pakai ref untuk membandingkan
  // signature id list — bila tidak berubah, useEffect tidak menyentuh
  // openSubmissionIds (mencegah re-open paksa setiap kali user toggle).
  const accordionInitializedKeyRef = useRef<string>("");
  useEffect(() => {
    if (submissions.length === 0) {
      accordionInitializedKeyRef.current = "";
      setOpenSubmissionIds((current) => (current.length === 0 ? current : []));
      return;
    }
    const nextKey = submissions.map((s) => s.id).join("|");
    if (accordionInitializedKeyRef.current === nextKey) {
      // Submissions list belum berubah; hormati pilihan open/close user.
      return;
    }
    const isFirstSync = accordionInitializedKeyRef.current === "";
    accordionInitializedKeyRef.current = nextKey;
    setOpenSubmissionIds((current) => {
      const filtered = current.filter((id) =>
        submissions.some((s) => s.id === id),
      );
      // Hanya enforce default-open pada sync pertama kali submissions
      // tersedia. Setelah itu, biarkan user yang menentukan.
      if (isFirstSync && filtered.length === 0) {
        return [submissions[0].id];
      }
      return filtered;
    });
  }, [submissions]);

  // R7h — initial default toolbar month/year dari Asia/Makassar saat mount.
  // Setelah itu user boleh ganti, tidak di-overwrite ulang.
  const excelToolbarInitializedRef = useRef(false);
  useEffect(() => {
    if (excelToolbarInitializedRef.current) return;
    excelToolbarInitializedRef.current = true;
    const parts = getMakassarDateParts();
    setExcelDefaultMonth(parts.month);
    setExcelYear(parts.year);
  }, []);

  // R7h — sinkronkan principal default dari workflow.principleName.
  useEffect(() => {
    if (!workflow) return;
    const guess = guessPrincipalCode(workflow.principleName);
    setExcelPrincipalCode((prev) => (prev === "GCPI" || prev === "") ? guess : prev);
  }, [workflow]);

  // R7h — initialize draft per item saat items berubah. Item baru / belum
  // pernah ter-init akan diisi dari current data + parsing No Claim.
  // Item yang sudah ter-init tidak dipaksa reset (preserve user editing).
  useEffect(() => {
    if (items.length === 0) {
      excelInitializedItemsRef.current = new Set();
      setExcelRowDrafts({});
      return;
    }
    const submissionByItem = new Map<string, Submission>();
    for (const sub of submissions) {
      // do nothing here; lookup by item.claimSubmissionId below
      void sub;
    }
    setExcelRowDrafts((prev) => {
      const next: Record<string, ExcelRowDraft> = { ...prev };
      const seen = new Set<string>();
      for (const item of items) {
        seen.add(item.id);
        if (excelInitializedItemsRef.current.has(item.id)) continue;
        const sub = submissions.find((s) => s.id === item.claimSubmissionId) ||
          null;
        const noClaim = sub?.noClaim || "";
        const parsed = parseNoClaimComponents(noClaim);
        next[item.id] = {
          sequence: parsed?.sequence ?? "",
          month: parsed?.month ?? excelDefaultMonth,
          noClaimDraft: noClaim,
          dpp: String(item.dpp ?? 0),
          ppnRate: String(item.ppnRate ?? 0),
          pphRate: String(item.pphRate ?? 0),
          initialNoClaim: noClaim,
          initialDpp: String(item.dpp ?? 0),
          initialPpnRate: String(item.ppnRate ?? 0),
          initialPphRate: String(item.pphRate ?? 0),
        };
        excelInitializedItemsRef.current.add(item.id);
      }
      // Drop drafts untuk item yang sudah hilang.
      for (const draftId of Object.keys(next)) {
        if (!seen.has(draftId)) {
          delete next[draftId];
          excelInitializedItemsRef.current.delete(draftId);
        }
      }
      // Bila server me-refresh data (mis. setelah save), sync initial
      // baseline tanpa overwrite draft text yang masih dirty.
      for (const item of items) {
        const draft = next[item.id];
        if (!draft) continue;
        const sub = submissions.find((s) => s.id === item.claimSubmissionId) ||
          null;
        const noClaim = sub?.noClaim || "";
        next[item.id] = {
          ...draft,
          initialNoClaim: noClaim,
          initialDpp: String(item.dpp ?? 0),
          initialPpnRate: String(item.ppnRate ?? 0),
          initialPphRate: String(item.pphRate ?? 0),
        };
      }
      return next;
    });
  }, [items, submissions, excelDefaultMonth]);

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

  const submitPayment = async () => {
    const amount = Number(paymentDraft.paymentAmount);
    if (!paymentDraft.paymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDraft.paymentDate)) {
      toast.error("Tanggal bayar wajib diisi (YYYY-MM-DD).");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nominal bayar harus lebih dari 0.");
      return;
    }
    setPaymentSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentDate: paymentDraft.paymentDate,
          paymentAmount: amount,
          paymentType: paymentDraft.paymentType.trim() || null,
          paymentNote: paymentDraft.paymentNote.trim() || null,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        statusChanged?: boolean;
        workflow?: { status?: string };
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal mencatat pembayaran.");
      }
      const successMessage = result.statusChanged
        ? `Pembayaran tersimpan. Status berubah menjadi ${result.workflow?.status || ""}.`
        : "Pembayaran tersimpan.";
      toast.success(successMessage);
      setMessage(successMessage);
      setPaymentDraft({
        paymentDate: new Date().toISOString().slice(0, 10),
        paymentAmount: "",
        paymentType: paymentDraft.paymentType,
        paymentNote: "",
      });
      await loadDetail();
    } catch (saveError) {
      const errorMessage = saveError instanceof Error
        ? saveError.message
        : "Gagal mencatat pembayaran.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setPaymentSaving(false);
    }
  };

  const voidPayment = async (paymentId: string) => {
    if (typeof window === "undefined") return;
    const reason = window.prompt(
      "Alasan void pembayaran (wajib diisi):",
      "",
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Alasan void wajib diisi.");
      return;
    }
    setVoidingId(paymentId);
    setMessage("");
    try {
      const response = await fetch(
        `/api/claim-workflow/${id}/payments/${paymentId}/void`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed }),
        },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        statusChanged?: boolean;
        workflow?: { status?: string };
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal void pembayaran.");
      }
      const successMessage = result.statusChanged
        ? `Pembayaran di-void. Status kembali ke ${result.workflow?.status || ""}.`
        : "Pembayaran di-void.";
      toast.success(successMessage);
      setMessage(successMessage);
      await loadDetail();
    } catch (voidError) {
      const errorMessage = voidError instanceof Error
        ? voidError.message
        : "Gagal void pembayaran.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setVoidingId("");
    }
  };

  // Phase R7b - Multi No Claim: handler create submission baru.
  const submitCreateSubmission = async () => {
    if (!workflow) return;
    setCreatingSubmission(true);
    setMessage("");
    try {
      const body: Record<string, string> = { scope: createSubmissionScope };
      const labelTrimmed = createSubmissionLabel.trim();
      if (labelTrimmed) body.scopeLabel = labelTrimmed;
      const noClaimTrimmed = createSubmissionNoClaim.trim();
      if (noClaimTrimmed) body.noClaim = noClaimTrimmed;
      const response = await fetch(`/api/claim-workflow/${id}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        submission?: { id?: string };
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal membuat Claim Submission.");
      }
      const successMessage = "Paket No Claim baru tersimpan. Pindahkan item lewat dropdown di tabel.";
      toast.success(successMessage);
      setMessage(successMessage);
      setCreateSubmissionLabel("");
      setCreateSubmissionNoClaim("");
      setCreateSubmissionScope("per_pengajuan");
      setShowCreateSubmissionForm(false);
      // R7 UX — pilih submission baru di Master Detail jika response
      // membawa id. Tanpa id, useEffect sync akan fallback ke first.
      if (result.submission?.id) {
        setSelectedSubmissionId(result.submission.id);
      }
      await loadDetail();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Gagal membuat Claim Submission.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setCreatingSubmission(false);
    }
  };

  // R7 UX experiment — handler save No Claim per submission. Pakai
  // endpoint PATCH submission yang sudah ada (R7b). Validasi non-empty
  // di client; backend menolak empty dengan code submission-specific.
  const submitSubmissionNoClaim = async (submissionId: string) => {
    const draft = submissionNoClaimDraft[submissionId] ?? "";
    const trimmed = draft.trim();
    if (!trimmed) {
      const blankMessage = "No Claim wajib diisi.";
      toast.error(blankMessage);
      setMessage(blankMessage);
      return;
    }
    setSubmissionNoClaimSavingId(submissionId);
    setMessage("");
    try {
      const response = await fetch(
        `/api/claim-workflow/${id}/submissions/${submissionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noClaim: trimmed }),
        },
      );
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal menyimpan No Claim paket.");
      }
      toast.success("No Claim paket tersimpan.");
      setMessage("No Claim paket tersimpan.");
      setSubmissionNoClaimEditingId("");
      await loadDetail();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Gagal menyimpan No Claim paket.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setSubmissionNoClaimSavingId("");
    }
  };

  // R7g — Handler initialize generator draft + mode untuk satu submission.
  // Dipanggil saat user pertama kali switch ke mode "Generate dari Excel".
  // Default month/year dari Asia/Makassar; principal code di-tebak dari nama
  // principle workflow.
  const ensureGeneratorDraft = (submissionId: string) => {
    if (submissionGeneratorDraft[submissionId]) return;
    const parts = getMakassarDateParts();
    const principal = guessPrincipalCode(workflow?.principleName);
    setSubmissionGeneratorDraft((prev) => ({
      ...prev,
      [submissionId]: {
        sequence: "",
        distributorCode: "SUPER",
        principalCode: principal,
        month: parts.month,
        year: parts.year,
      },
    }));
  };

  // R7g — Handler "Buat Paket per Baris / Item": panggil endpoint
  // submissions/from-items mode all_unassigned. Tidak menghapus paket lama.
  // Tidak auto-generate No Claim.
  const submitCreatePerItem = async () => {
    if (!workflow) return;
    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            "Buat satu Paket No Claim untuk setiap item klaim yang belum dipaketkan? Paket lama tidak akan dihapus.",
          )
        : true;
    if (!confirmed) return;
    setCreatingPerItem(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/claim-workflow/${id}/submissions/from-items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "all_unassigned" }),
        },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        createdCount?: number;
        skippedCount?: number;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal membuat paket per item.");
      }
      const createdCount = result.createdCount ?? 0;
      const successMessage = createdCount > 0
        ? `${createdCount} paket per item dibuat.`
        : "Semua item sudah memiliki paket.";
      toast.success(successMessage);
      setMessage(successMessage);
      await loadDetail();
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : "Gagal membuat paket per item.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setCreatingPerItem(false);
    }
  };

  // R7h — Excel Input Mode handler: simpan satu row table.
  // Memanggil PATCH item (DPP/PPN/PPH) bila tax dirty, dan PATCH submission
  // (noClaim) bila No Claim dirty. Mengambil endpoint existing R7b/R7c
  // tanpa membuat API baru. Tidak auto-save; dipanggil dari tombol "Simpan".
  const saveExcelRow = async (item: WorkflowItem) => {
    const draft = excelRowDrafts[item.id];
    if (!draft) return;
    const submission = submissions.find(
      (s) => s.id === item.claimSubmissionId,
    );
    const taxDirty =
      String(draft.dpp) !== String(draft.initialDpp) ||
      String(draft.ppnRate) !== String(draft.initialPpnRate) ||
      String(draft.pphRate) !== String(draft.initialPphRate);
    const noClaimTrimmed = draft.noClaimDraft.trim();
    const noClaimDirty = noClaimTrimmed !== String(draft.initialNoClaim || "");

    if (!taxDirty && !noClaimDirty) {
      toast.info?.("Tidak ada perubahan untuk disimpan.");
      return;
    }

    // Validasi tax (mirror backend route).
    if (taxDirty) {
      const dpp = Number(draft.dpp);
      const ppn = Number(draft.ppnRate);
      const pph = Number(draft.pphRate);
      if (!Number.isFinite(dpp) || dpp < 0) {
        toast.error("DPP harus angka >= 0.");
        return;
      }
      if (!Number.isFinite(ppn) || ppn < 0 || ppn > 100) {
        toast.error("PPN % harus angka 0-100.");
        return;
      }
      if (!Number.isFinite(pph) || pph < 0 || pph > 100) {
        toast.error("PPH % harus angka 0-100.");
        return;
      }
    }
    // Validasi No Claim.
    if (noClaimDirty) {
      if (!noClaimTrimmed) {
        toast.error("No Claim wajib diisi.");
        return;
      }
      if (!submission) {
        toast.error(
          "Item belum punya Paket No Claim. Klik 'Buat Paket per Baris / Item' di toolbar.",
        );
        return;
      }
    }

    setExcelRowSavingId(item.id);
    setMessage("");
    try {
      if (taxDirty) {
        const response = await fetch(
          `/api/claim-workflow/${id}/items/${item.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dpp: draft.dpp,
              ppnRate: draft.ppnRate,
              pphRate: draft.pphRate,
            }),
          },
        );
        const result = (await response.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "Gagal menyimpan tax item.");
        }
      }
      if (noClaimDirty && submission) {
        const response = await fetch(
          `/api/claim-workflow/${id}/submissions/${submission.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ noClaim: noClaimTrimmed }),
          },
        );
        const result = (await response.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || !result.ok) {
          throw new Error(result.error || "Gagal menyimpan No Claim.");
        }
      }
      toast.success("Baris klaim tersimpan.");
      setMessage("Baris klaim tersimpan.");
      await loadDetail();
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : "Gagal menyimpan baris.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setExcelRowSavingId("");
    }
  };

  // Phase R7b - Multi No Claim: handler pindahkan item ke submission lain.
  const moveItemToSubmission = async (itemId: string, targetSubmissionId: string) => {
    if (!targetSubmissionId) return;
    setMovingItemId(itemId);
    setMessage("");
    try {
      const response = await fetch(
        `/api/claim-workflow/${id}/submissions/${targetSubmissionId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: [itemId] }),
        },
      );
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal memindahkan item ke submission.");
      }
      toast.success("Item dipindahkan ke submission baru. Totals di-recalc.");
      await loadDetail();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Gagal memindahkan item ke submission.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setMovingItemId("");
    }
  };

  // Phase R7c - Documents per submission: generate Claim Letter / Summary
  // / Kwitansi PDF per submission via endpoint per-submission. Setelah
  // sukses detail di-reload supaya pdfPath terbaru muncul.
  const generateSubmissionDocument = async (
    submissionId: string,
    type: "claim-letter" | "summary" | "receipt",
  ) => {
    const key = `${submissionId}:${type}`;
    setGeneratingDocKey(key);
    setMessage("");
    try {
      const response = await fetch(
        `/api/claim-workflow/${id}/submissions/${submissionId}/${type}`,
        { method: "POST" },
      );
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal generate dokumen submission.");
      }
      const label = type === "claim-letter"
        ? "Claim Letter"
        : type === "summary"
          ? "Summary"
          : "Kwitansi";
      const successMessage = `${label} PDF submission berhasil dibuat.`;
      toast.success(successMessage);
      setMessage(successMessage);
      await loadDetail();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Gagal generate dokumen submission.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setGeneratingDocKey("");
    }
  };

  const submitClose = async () => {
    const trimmed = closeNote.trim();
    if (!trimmed) {
      toast.error("Catatan close wajib diisi.");
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Tutup Claim Workflow ini? Setelah Closed, payment dan transisi status tidak dapat lagi dilakukan.",
      );
      if (!confirmed) return;
    }
    setCloseSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/claim-workflow/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        workflow?: { status?: string };
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Gagal menutup Claim Workflow.");
      }
      const successMessage = `Claim Workflow ditutup. Status: ${result.workflow?.status || "Closed"}.`;
      toast.success(successMessage);
      setMessage(successMessage);
      setCloseNote("");
      await loadDetail();
    } catch (closeError) {
      const errorMessage = closeError instanceof Error
        ? closeError.message
        : "Gagal menutup Claim Workflow.";
      toast.error(errorMessage);
      setMessage(errorMessage);
    } finally {
      setCloseSaving(false);
    }
  };

  if (loading) {
    return <div className="px-5 py-12 text-sm text-slate-400">Memuat detail Claim Workflow...</div>;
  }
  if (error || !workflow) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">{error || "Claim Workflow tidak ditemukan."}</div>;
  }

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
  const showCloseSection =
    workflow.status === claimWorkflowStatuses.closed ||
    workflow.status === claimWorkflowStatuses.paid ||
    workflow.status === claimWorkflowStatuses.partiallyPaid ||
    (workflow.status === claimWorkflowStatuses.submittedToPrincipal &&
      (paymentSummary?.totalPaid ?? 0) > 0);

  // R7 UX experiment — derived helpers untuk dual layout submissions.
  const sourceTypeKey = (workflow.sourceType || "off_program") as string;
  const sourceTypeLabel = SOURCE_TYPE_LABEL[sourceTypeKey] || "OFF Program";
  const workflowGuidance = getWorkflowGuidance(submissions);
  const selectedSubmission = submissions.find(
    (s) => s.id === selectedSubmissionId,
  ) || null;

  // Helper: items yang sudah di-link ke satu submission. Read-only di
  // panel detail; pemindahan tetap lewat dropdown di tabel utama.
  const getSubmissionItems = (submissionId: string) =>
    items.filter((it) => it.claimSubmissionId === submissionId);

  // R7 UX experiment — render single submission detail panel. Dipakai
  // baik di Master Detail (right column) maupun Accordion body.
  const renderSubmissionDetailPanel = (submission: Submission) => {
    const docsCount = getSubmissionDocumentsCompletedCount(submission);
    const next = getSubmissionNextAction(submission);
    const submissionEditable =
      canEditItems &&
      (workflow.status === claimWorkflowStatuses.draft ||
        workflow.status === claimWorkflowStatuses.needRevision) &&
      !isSubmissionClosed(submission);
    const noClaimEmpty =
      !submission.noClaim || !String(submission.noClaim).trim();
    const editingNoClaim = submissionNoClaimEditingId === submission.id;
    const draftValue =
      submissionNoClaimDraft[submission.id] ?? (submission.noClaim || "");
    const savingNoClaim = submissionNoClaimSavingId === submission.id;
    const submissionItems = getSubmissionItems(submission.id);
    const remaining = getSubmissionRemainingAmount(submission);
    const docTypes: Array<{
      key: "claim-letter" | "summary" | "receipt";
      title: string;
      path?: string | null;
      generatedAt?: string | Date | null;
    }> = [
      {
        key: "claim-letter",
        title: "Surat Claim",
        path: submission.claimLetterPdfPath,
        generatedAt: submission.claimLetterGeneratedAt,
      },
      {
        key: "summary",
        title: "Summary",
        path: submission.summaryPdfPath,
        generatedAt: submission.summaryGeneratedAt,
      },
      {
        key: "receipt",
        title: "Kwitansi",
        path: submission.receiptPdfPath,
        generatedAt: submission.receiptGeneratedAt,
      },
    ];
    const canGenerateDocs =
      canEditItems &&
      !isSubmissionClosed(submission) &&
      (submission.itemCount ?? submissionItems.length) > 0 &&
      Number(submission.totalClaim || 0) > 0;
    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-200">
                  {getScopeDisplayLabel(submission.scope)}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone(submission.status)}`}
                >
                  {displayClaimStatusLabel(submission.status)}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getGuidanceClass(next.tone)}`}
                >
                  {next.label}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white">
                {getSubmissionTitle(submission)}
              </h3>
              {submission.noClaim ? (
                <p className="font-mono text-sm font-semibold text-emerald-200">
                  {submission.noClaim}
                </p>
              ) : (
                <p className="text-xs font-semibold text-amber-200">
                  Belum ada No Claim
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Dokumen
              </p>
              <p
                className={`mt-1 text-sm font-bold ${docsCount === 3 ? "text-emerald-200" : "text-amber-200"}`}
              >
                {docsCount}/3
              </p>
            </div>
          </div>
        </div>

        {/* No Claim Editor (per submission) */}
        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-white">No Claim Paket</h4>
              <p className="mt-1 text-xs text-slate-400">
                No Claim untuk paket ini. Tersinkronisasi otomatis ke OFF
                item terkait saat di-assign.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {!canAssignNoClaim && (
                <span className="text-[11px] italic text-slate-500">
                  View-only
                </span>
              )}
              {canAssignNoClaim && submissionEditable && (
                <div
                  role="group"
                  aria-label="Mode input No Claim"
                  className="inline-flex overflow-hidden rounded-lg border border-white/10"
                >
                  {(
                    [
                      { value: "manual", label: "Input Manual" },
                      { value: "generate", label: "Generate dari Excel" },
                    ] as const
                  ).map((opt) => {
                    const currentMode =
                      submissionGeneratorMode[submission.id] ?? "manual";
                    const active = currentMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          if (opt.value === "generate") {
                            ensureGeneratorDraft(submission.id);
                          }
                          setSubmissionGeneratorMode((prev) => ({
                            ...prev,
                            [submission.id]: opt.value,
                          }));
                        }}
                        className={`px-3 py-1 text-[11px] font-bold transition ${
                          active
                            ? "bg-indigo-600 text-white"
                            : "bg-transparent text-slate-300 hover:bg-white/5"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {canAssignNoClaim ? (
            editingNoClaim || noClaimEmpty ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={draftValue}
                  onChange={(event) => {
                    setSubmissionNoClaimEditingId(submission.id);
                    setSubmissionNoClaimDraft((prev) => ({
                      ...prev,
                      [submission.id]: event.target.value,
                    }));
                  }}
                  placeholder="Contoh: 09/SUPER-GCPI/02/2026"
                  disabled={savingNoClaim || !submissionEditable}
                  className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
                <div className="flex gap-2 sm:justify-end">
                  {!noClaimEmpty && (
                    <button
                      type="button"
                      disabled={savingNoClaim}
                      onClick={() => {
                        setSubmissionNoClaimEditingId("");
                        setSubmissionNoClaimDraft((prev) => ({
                          ...prev,
                          [submission.id]: submission.noClaim || "",
                        }));
                      }}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/5 disabled:opacity-50"
                    >
                      Batal
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={savingNoClaim || !submissionEditable}
                    onClick={() => void submitSubmissionNoClaim(submission.id)}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                    title={
                      !submissionEditable
                        ? "No Claim hanya dapat di-assign saat workflow Draft / Need Revision dan paket belum closed."
                        : undefined
                    }
                  >
                    {savingNoClaim
                      ? "Menyimpan..."
                      : noClaimEmpty
                        ? "Assign No Claim"
                        : "Update No Claim"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-semibold text-emerald-200">
                  {submission.noClaim}
                </p>
                <button
                  type="button"
                  disabled={!submissionEditable}
                  onClick={() => {
                    setSubmissionNoClaimEditingId(submission.id);
                    setSubmissionNoClaimDraft((prev) => ({
                      ...prev,
                      [submission.id]: submission.noClaim || "",
                    }));
                  }}
                  className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
                  title={
                    !submissionEditable
                      ? "Edit No Claim hanya tersedia saat workflow Draft / Need Revision."
                      : undefined
                  }
                >
                  Edit No Claim
                </button>
              </div>
            )
          ) : (
            <p className="mt-3 font-mono text-sm text-slate-300">
              {submission.noClaim || "—"}
            </p>
          )}
          {!submissionEditable && canAssignNoClaim && (
            <p className="mt-2 text-[11px] italic text-slate-500">
              Edit No Claim hanya tersedia saat workflow berstatus Draft atau
              Need Revision.
            </p>
          )}
          {/* R7g — Generator dari Excel (mode = "generate") */}
          {canAssignNoClaim &&
            submissionEditable &&
            (submissionGeneratorMode[submission.id] ?? "manual") === "generate" &&
            submissionGeneratorDraft[submission.id] && (() => {
              const draft = submissionGeneratorDraft[submission.id];
              const error = validateNoClaimGenerator(draft);
              const preview = error ? "" : buildNoClaimPreview(draft);
              const updateDraft = (patch: Partial<NoClaimGeneratorDraft>) => {
                setSubmissionGeneratorDraft((prev) => ({
                  ...prev,
                  [submission.id]: { ...prev[submission.id], ...patch },
                }));
              };
              return (
                <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-200">
                    Generate No Claim (pola Excel)
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Format mengikuti pola Excel: No.2/SUPER-GCPI/Bulan/Tahun.
                    Hasil tetap bisa diedit sebelum disimpan.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Nomor Urut
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.sequence}
                        onChange={(event) =>
                          updateDraft({ sequence: event.target.value })
                        }
                        placeholder="01"
                        className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Kode Distributor
                      <input
                        type="text"
                        value={draft.distributorCode}
                        onChange={(event) =>
                          updateDraft({ distributorCode: event.target.value })
                        }
                        placeholder="SUPER"
                        className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Kode Principal
                      <input
                        type="text"
                        value={draft.principalCode}
                        onChange={(event) =>
                          updateDraft({ principalCode: event.target.value })
                        }
                        placeholder="GCPI"
                        className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Bulan
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        value={draft.month}
                        onChange={(event) =>
                          updateDraft({ month: event.target.value })
                        }
                        placeholder="02"
                        className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Tahun
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={draft.year}
                        onChange={(event) =>
                          updateDraft({ year: event.target.value })
                        }
                        placeholder="2026"
                        className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[11px] text-slate-400">
                      <span className="font-semibold uppercase tracking-wider text-slate-500">
                        Preview:
                      </span>{" "}
                      {error ? (
                        <span className="text-amber-300">{error}</span>
                      ) : (
                        <span className="font-mono text-sm font-bold text-emerald-200">
                          {preview}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(error)}
                      onClick={() => {
                        if (error) return;
                        setSubmissionNoClaimEditingId(submission.id);
                        setSubmissionNoClaimDraft((prev) => ({
                          ...prev,
                          [submission.id]: preview,
                        }));
                      }}
                      className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-40"
                    >
                      Gunakan No Claim Ini
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] italic text-slate-500">
                    Default bulan/tahun mengikuti zona Asia/Makassar.
                  </p>
                </div>
              );
            })()}
        </div>

        {/* Summary Cards */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total Claim
            </p>
            <p className="mt-2 text-sm font-bold text-white">
              {rupiah(submission.totalClaim)}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              Total Paid
            </p>
            <p className="mt-2 text-sm font-bold text-emerald-200">
              {rupiah(submission.totalPaid)}
            </p>
          </div>
          <div
            className={`rounded-xl border p-4 ${remaining > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}
          >
            <p
              className={`text-[11px] font-semibold uppercase tracking-wider ${remaining > 0 ? "text-amber-300" : "text-emerald-300"}`}
            >
              Outstanding
            </p>
            <p
              className={`mt-2 text-sm font-bold ${remaining > 0 ? "text-amber-200" : "text-emerald-200"}`}
            >
              {rupiah(remaining)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Items
            </p>
            <p className="mt-2 text-sm font-bold text-white">
              {submission.itemCount ?? submissionItems.length}
            </p>
          </div>
        </div>

        {/* Documents */}
        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-white">Dokumen Paket</h4>
              <p className="mt-1 text-xs text-slate-400">
                Tiga dokumen wajib di-generate sebelum Mark Ready.
              </p>
            </div>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${docsCount === 3 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}
            >
              {docsCount}/3
            </span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {docTypes.map((doc) => {
              const generating = generatingDocKey === `${submission.id}:${doc.key}`;
              const generated = Boolean(doc.path);
              return (
                <div
                  key={doc.key}
                  className="rounded-xl border border-white/10 bg-black/30 p-4"
                >
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-semibold text-white">
                      {doc.title}
                    </h5>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${generated ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}
                    >
                      {generated ? "Sudah dibuat" : "Belum dibuat"}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {doc.generatedAt
                      ? `Generated at ${dateText(doc.generatedAt)}`
                      : "Belum di-generate."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {generated && (
                      <a
                        href={`/api/claim-workflow/${id}/submissions/${submission.id}/${doc.key}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10"
                      >
                        Buka PDF
                      </a>
                    )}
                    {canGenerateDocs && (
                      <button
                        type="button"
                        disabled={generating || generatingDocKey !== ""}
                        onClick={() =>
                          void generateSubmissionDocument(submission.id, doc.key)
                        }
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                        title={
                          generated
                            ? `Re-generate ${doc.title}`
                            : `Generate ${doc.title}`
                        }
                      >
                        {generating
                          ? "Generating..."
                          : generated
                            ? "Regenerate"
                            : "Generate"}
                      </button>
                    )}
                    {!generated && !canGenerateDocs && (
                      <span className="text-[11px] italic text-slate-500">
                        {!canEditItems
                          ? "View-only."
                          : isSubmissionClosed(submission)
                            ? "Paket sudah closed."
                            : (submission.itemCount ?? submissionItems.length) === 0
                              ? "Belum ada item ditugaskan."
                              : Number(submission.totalClaim || 0) <= 0
                                ? "Total Claim masih 0."
                                : "Belum dapat di-generate."}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Items in package */}
        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-white">Item Paket</h4>
              <p className="mt-1 text-xs text-slate-400">
                Daftar item klaim yang ditugaskan ke paket ini. Pemindahan
                antar paket dilakukan lewat dropdown di tabel item utama
                di bawah.
              </p>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {submissionItems.length} item
            </span>
          </div>
          {submissionItems.length === 0 ? (
            <p className="mt-3 text-xs italic text-slate-500">
              Belum ada item ditugaskan ke paket ini.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-black/40 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">No Surat</th>
                    <th className="px-3 py-2">Outlet</th>
                    <th className="px-3 py-2 text-right">DPP</th>
                    <th className="px-3 py-2 text-right">PPN</th>
                    <th className="px-3 py-2 text-right">PPH</th>
                    <th className="px-3 py-2 text-right">Nilai Klaim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {submissionItems.map((item) => (
                    <tr key={item.id} className="text-slate-300">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {item.noSurat || "-"}
                      </td>
                      <td className="px-3 py-2 text-xs">{item.outlet || "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                        {rupiah(item.dpp)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                        {rupiah(item.ppnAmount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                        {rupiah(item.pphAmount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold tabular-nums text-white">
                        {rupiah(item.nilaiKlaim)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payment summary read-only */}
        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-white">Pembayaran Paket</h4>
              <p className="mt-1 text-xs text-slate-400">
                Ringkasan pembayaran paket. Pencatatan / void pembayaran
                masih dilakukan di section Pembayaran Principal di bawah.
              </p>
            </div>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone(submission.status)}`}
            >
              {displayClaimStatusLabel(submission.status)}
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                Total Paid
              </p>
              <p className="mt-2 text-sm font-bold text-emerald-200">
                {rupiah(submission.totalPaid)}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${remaining > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}
            >
              <p
                className={`text-[11px] font-semibold uppercase tracking-wider ${remaining > 0 ? "text-amber-300" : "text-emerald-300"}`}
              >
                Outstanding
              </p>
              <p
                className={`mt-2 text-sm font-bold ${remaining > 0 ? "text-amber-200" : "text-emerald-200"}`}
              >
                {rupiah(remaining)}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Total Claim
              </p>
              <p className="mt-2 text-sm font-bold text-white">
                {rupiah(submission.totalClaim)}
              </p>
            </div>
          </div>
        </div>

        {/* Close info read-only */}
        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-white">Close Paket</h4>
              <p className="mt-1 text-xs text-slate-400">
                {isSubmissionClosed(submission)
                  ? "Paket sudah closed."
                  : "Close paket akan tersedia setelah Total Paid >= Total Claim dan dokumen lengkap. Saat ini close masih dijalankan workflow-level di section Close Workflow di bawah."}
              </p>
            </div>
            {isSubmissionClosed(submission) && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
                Closed
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-6 pb-12 pt-2">
      <Link href="/claim-workflow" className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">
        Kembali ke Claim Workflow
      </Link>

      <section className="rounded-3xl border border-white/10 bg-[#1a1c23] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">Claim Workflow Detail</p>
            <h1 className="text-2xl font-black text-white">{workflow.claimWorkflowNo}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{workflow.principleName}</span>
              <span className="text-slate-600">·</span>
              <span>OFF {workflow.offNoPengajuan || workflow.offBatchId}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-200">
                {sourceTypeLabel}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${submissionCount > 1 ? "border-purple-500/30 bg-purple-500/10 text-purple-200" : "border-white/10 bg-white/5 text-slate-300"}`}
              >
                {submissionCount} Paket No Claim
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone(workflow.status)}`}
                title={showLegacyNotice ? "Legacy PEKA status — diperlakukan sebagai Submitted to Principal" : undefined}
              >
                {displayClaimStatusLabel(workflow.status)}
              </span>
            </div>
            <p className="pt-2 text-[11px] text-slate-500">
              {hasMultipleSubmissions
                ? "Workflow ini memiliki beberapa Paket No Claim. Kelola No Claim, dokumen, pembayaran, dan close di masing-masing paket."
                : "Workflow ini memiliki satu Paket No Claim. Shortcut No Claim header masih bisa dipakai."}
            </p>
            <p className="text-[11px] text-slate-500">
              Created {dateText(workflow.createdAt)}
              {workflow.submittedToPrincipalAt
                ? ` · Submitted to Principal ${dateText(workflow.submittedToPrincipalAt)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
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
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { key: "totalClaim", label: "Total Claim", value: rupiah(workflow.totalClaim) },
            { key: "totalPaid", label: "Total Paid", value: rupiah(workflow.totalPaid) },
            { key: "remainingAmount", label: "Outstanding", value: rupiah(workflow.remainingAmount) },
            { key: "submissions", label: "Paket No Claim", value: String(submissionCount) },
          ].map((card) => (
            <div key={card.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-semibold text-slate-500">{card.label}</p>
              <p className="mt-2 whitespace-nowrap text-sm font-bold text-white">{card.value}</p>
            </div>
          ))}
        </div>
        {showLegacyNotice && (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            Workflow ini masih memiliki status legacy PEKA ({workflow.status}). Alur PEKA/EC/CN sudah retired; status ini sekarang diperlakukan sebagai Submitted to Principal. Pembayaran principal akan ditangani via Principal Payment workflow (R3).
          </p>
        )}
      </section>

      {/* R7 UX experiment — Workflow Guidance / Langkah Berikutnya */}
      <section
        className={`rounded-2xl border p-4 ${getGuidanceClass(workflowGuidance.tone)}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">
              Langkah Berikutnya
            </p>
            <p className="mt-1 text-sm font-bold">{workflowGuidance.message}</p>
          </div>
          {submissions.length > 0 && (
            <p className="text-[11px] opacity-80">
              {submissions.filter((s) => isSubmissionClosed(s)).length}/{submissions.length} paket selesai
            </p>
          )}
        </div>
      </section>

      {message && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
          {message}
        </div>
      )}

      {/* R7 UX experiment — No Claim Container Info.
          Saat workflow punya >1 paket, sembunyikan editor No Claim
          workflow-level dan arahkan user ke section paket. */}
      {hasMultipleSubmissions ? (
        <section className="rounded-2xl border border-purple-500/20 bg-[#1a1c23] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold text-white">No Claim diatur per Paket Klaim</h2>
              <p className="mt-1 text-sm text-slate-400">
                Workflow ini memiliki beberapa Paket No Claim. Isi atau edit
                No Claim pada masing-masing paket di section Paket No Claim.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-200">
                {submissionCount} Paket No Claim
              </span>
              <button
                type="button"
                onClick={() => {
                  if (typeof document !== "undefined") {
                    document
                      .getElementById("paket-no-claim-section")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-bold text-purple-200 hover:bg-purple-500/20"
              >
                Lihat Paket No Claim
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold text-white">No Claim</h2>
              <p className="mt-1 text-sm text-slate-400">
                No Claim utama untuk Claim Workflow ini. Saat di-assign,
                otomatis sync ke semua OFF item terkait.
              </p>
              <p className="mt-1 text-[11px] italic text-slate-500">
                Shortcut ini mengisi No Claim pada paket klaim utama.
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
      )}

      <section
        id="paket-no-claim-section"
        className="rounded-2xl border border-indigo-500/20 bg-[#1a1c23] p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-white">Paket No Claim</h2>
            <p className="mt-1 text-sm text-slate-400">
              Pilih paket untuk mengelola No Claim, dokumen, payment, dan
              close. Satu paket = satu No Claim. Item dipindah antar paket
              lewat dropdown di tabel item utama.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Catatan transisi R7: Section "Pembayaran Principal" dan "Close
              Workflow" di bawah masih berjalan workflow-level untuk legacy /
              single-submission. Akan dipindah ke per paket di phase berikut.
            </p>
          </div>
          {/* R7 UX experiment — Layout Mode Switcher */}
          <div className="flex flex-col items-end gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Mode Tampilan
            </span>
            <div
              role="group"
              aria-label="Mode Tampilan Paket No Claim"
              className="inline-flex flex-wrap gap-1 rounded-lg border border-white/10 p-1"
            >
              {SUBMISSION_LAYOUT_OPTIONS.map((opt) => {
                const active = submissionLayoutMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSubmissionLayoutMode(opt.value)}
                    title={opt.hint}
                    className={`rounded-md px-3 py-1 text-xs font-bold transition ${
                      active
                        ? "bg-indigo-600 text-white"
                        : "bg-transparent text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <span className="max-w-[220px] text-right text-[11px] italic text-slate-500">
              {SUBMISSION_LAYOUT_OPTIONS.find(
                (opt) => opt.value === submissionLayoutMode,
              )?.hint || ""}
            </span>
          </div>
        </div>

        {/* R7g — Buat Paket per Baris / Item */}
        {canEditItems && editable && (
          <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">
                  Buat Paket per Baris / Item
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Cocok jika ingin mengikuti Excel BASE: satu baris item menjadi
                  satu No Claim. Paket lama tidak dihapus dan No Claim diisi
                  setelah paket dibuat.
                </p>
              </div>
              <button
                type="button"
                disabled={creatingPerItem || items.length === 0}
                onClick={() => void submitCreatePerItem()}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                title={
                  items.length === 0
                    ? "Workflow belum memiliki item klaim."
                    : undefined
                }
              >
                {creatingPerItem
                  ? "Memproses..."
                  : "Buat Paket dari Item yang Belum Dipaketkan"}
              </button>
            </div>
          </div>
        )}

        {/* Create package form (collapsible) */}
        {canEditItems && editable && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20">
            <button
              type="button"
              onClick={() => setShowCreateSubmissionForm((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-bold text-white"
              aria-expanded={showCreateSubmissionForm}
            >
              <span>+ Buat Paket No Claim Baru</span>
              <span className="text-xs text-slate-400">
                {showCreateSubmissionForm ? "Tutup" : "Buka"}
              </span>
            </button>
            {showCreateSubmissionForm && (
              <div className="border-t border-white/10 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Tipe Paket
                    </label>
                    <select
                      value={createSubmissionScope}
                      onChange={(event) => setCreateSubmissionScope(event.target.value)}
                      disabled={creatingSubmission}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/60"
                    >
                      {SUBMISSION_SCOPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {getScopeHelper(createSubmissionScope)}
                    </p>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Nama Paket
                    </label>
                    <input
                      type="text"
                      value={createSubmissionLabel}
                      onChange={(event) => setCreateSubmissionLabel(event.target.value)}
                      placeholder="Mis. Program Promo KINO #0 / Toko ABC"
                      disabled={creatingSubmission}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/60"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      No Claim awal (opsional)
                    </label>
                    <input
                      type="text"
                      value={createSubmissionNoClaim}
                      onChange={(event) => setCreateSubmissionNoClaim(event.target.value)}
                      placeholder="Boleh kosong"
                      disabled={creatingSubmission}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={creatingSubmission}
                    onClick={() => void submitCreateSubmission()}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {creatingSubmission ? "Membuat..." : "Buat Paket"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!canEditItems && (
          <p className="mt-3 text-xs italic text-slate-500">
            View-only. Hanya admin atau claim yang dapat membuat atau memindahkan paket.
          </p>
        )}

        {/* Submissions content per layout */}
        {submissionLayoutMode === "excel" ? (
          /* R7h — Excel Input Mode (default).
             Tabel mirip sheet BASE: setiap baris = satu claim_workflow_item.
             No.2 + Bulan + No Claim per row, plus DPP/PPN%/PPH% inline.
             No Claim disimpan ke claim_submission.noClaim; tax disimpan ke
             claim_workflow_item via PATCH item existing. */
          (() => {
            const filteredItems = items.filter((it) => {
              const sub = submissions.find((s) => s.id === it.claimSubmissionId);
              const noClaim = sub?.noClaim || "";
              const haystack = `${it.noSurat || ""} ${it.outlet || ""} ${it.jenisPromosi || ""} ${noClaim}`.toLowerCase();
              const search = excelSearch.trim().toLowerCase();
              if (search && !haystack.includes(search)) return false;
              if (excelStatusFilter === "needs_no_claim") {
                if (noClaim) return false;
              } else if (excelStatusFilter === "needs_docs") {
                if (!sub) return false;
                if (isSubmissionDocumentsComplete(sub)) return false;
              } else if (excelStatusFilter === "outstanding") {
                if (!sub) return false;
                if (Number(sub.remainingAmount || 0) <= 0) return false;
              } else if (excelStatusFilter === "paid") {
                if (!sub) return false;
                if (Number(sub.remainingAmount || 0) > 0) return false;
              }
              return true;
            });
            const totalRows = items.length;
            return (
              <div className="mt-5 space-y-4">
                {/* Toolbar */}
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Cari (No Surat / Outlet / Perihal / No Claim)
                      <input
                        type="text"
                        value={excelSearch}
                        onChange={(event) => setExcelSearch(event.target.value)}
                        placeholder="Ketik untuk filter…"
                        className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Filter
                      <select
                        value={excelStatusFilter}
                        onChange={(event) =>
                          setExcelStatusFilter(
                            event.target.value as typeof excelStatusFilter,
                          )
                        }
                        className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/60"
                      >
                        <option value="all">Semua</option>
                        <option value="needs_no_claim">Belum No Claim</option>
                        <option value="needs_docs">Belum Dokumen</option>
                        <option value="outstanding">Outstanding</option>
                        <option value="paid">Paid</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Distributor
                      <input
                        type="text"
                        value={excelDistributorCode}
                        onChange={(event) =>
                          setExcelDistributorCode(event.target.value)
                        }
                        className="w-24 rounded-lg border border-white/10 bg-black/40 px-2 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Principal
                      <input
                        type="text"
                        value={excelPrincipalCode}
                        onChange={(event) =>
                          setExcelPrincipalCode(event.target.value)
                        }
                        className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Tahun
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={excelYear}
                        onChange={(event) =>
                          setExcelYear(event.target.value)
                        }
                        className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Bulan default
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        value={excelDefaultMonth}
                        onChange={(event) =>
                          setExcelDefaultMonth(event.target.value)
                        }
                        className="w-16 rounded-lg border border-white/10 bg-black/40 px-2 py-2 font-mono text-sm text-white outline-none focus:border-indigo-500/60"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                    <p className="text-[11px] text-slate-400">
                      {filteredItems.length} dari {totalRows} baris ditampilkan ·
                      Default bulan/tahun mengikuti Asia/Makassar.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {canEditItems && editable && (
                        <button
                          type="button"
                          disabled={creatingPerItem || items.length === 0}
                          onClick={() => void submitCreatePerItem()}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                          title={
                            items.length === 0
                              ? "Workflow belum memiliki item klaim."
                              : undefined
                          }
                        >
                          {creatingPerItem
                            ? "Memproses..."
                            : "Buat Paket per Baris / Item"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void loadDetail()}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table */}
                {totalRows === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-center text-sm text-slate-400">
                    Belum ada item klaim untuk workflow ini.
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-center text-sm text-slate-400">
                    Tidak ada baris yang cocok dengan filter saat ini.
                  </div>
                ) : (
                  <div className="overflow-auto rounded-xl border border-white/10">
                    <table className="min-w-[1700px] text-left text-sm">
                      <thead className="bg-black/40 text-[11px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">No.</th>
                          <th className="px-3 py-2 font-semibold">No Claim</th>
                          <th className="px-3 py-2 font-semibold">Perihal</th>
                          <th className="px-3 py-2 font-semibold">Periode</th>
                          <th className="px-3 py-2 font-semibold">Surat Program</th>
                          <th className="px-3 py-2 font-semibold">Outlet</th>
                          <th className="px-3 py-2 text-right font-semibold">DPP</th>
                          <th className="px-3 py-2 text-right font-semibold">PPN %</th>
                          <th className="px-3 py-2 text-right font-semibold">PPN Value</th>
                          <th className="px-3 py-2 text-right font-semibold">PPH %</th>
                          <th className="px-3 py-2 text-right font-semibold">PPH Value</th>
                          <th className="px-3 py-2 text-right font-semibold">Nilai Klaim</th>
                          <th className="px-3 py-2 font-semibold">No.2</th>
                          <th className="px-3 py-2 font-semibold">Bulan</th>
                          <th className="px-3 py-2 font-semibold">Dokumen</th>
                          <th className="px-3 py-2 text-right font-semibold">Paid</th>
                          <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredItems.map((item, idx) => {
                          const draft = excelRowDrafts[item.id];
                          if (!draft) return null;
                          const sub = submissions.find(
                            (s) => s.id === item.claimSubmissionId,
                          );
                          const dppNum = Number(draft.dpp || 0) || 0;
                          const ppnNum = Number(draft.ppnRate || 0) || 0;
                          const pphNum = Number(draft.pphRate || 0) || 0;
                          const ppnValue = +(dppNum * ppnNum / 100).toFixed(2);
                          const pphValue = +(dppNum * pphNum / 100).toFixed(2);
                          const nilaiKlaim = +(dppNum + ppnValue - pphValue).toFixed(2);
                          const taxDirty =
                            String(draft.dpp) !== String(draft.initialDpp) ||
                            String(draft.ppnRate) !== String(draft.initialPpnRate) ||
                            String(draft.pphRate) !== String(draft.initialPphRate);
                          const noClaimDirty =
                            draft.noClaimDraft.trim() !==
                            String(draft.initialNoClaim || "");
                          const dirty = taxDirty || noClaimDirty;
                          const docsCount = sub
                            ? getSubmissionDocumentsCompletedCount(sub)
                            : 0;
                          const remaining = sub
                            ? Number(sub.remainingAmount || 0)
                            : 0;
                          const paid = sub ? Number(sub.totalPaid || 0) : 0;
                          const updateDraft = (patch: Partial<ExcelRowDraft>) => {
                            setExcelRowDrafts((prev) => ({
                              ...prev,
                              [item.id]: { ...prev[item.id], ...patch },
                            }));
                          };
                          const generateNoClaim = () => {
                            const seq = formatNoClaimSequence(draft.sequence);
                            if (!seq) {
                              toast.error("Isi No.2 dulu untuk generate.");
                              return;
                            }
                            const month = draft.month.trim();
                            if (!/^(0[1-9]|1[0-2])$/.test(month)) {
                              toast.error("Bulan harus 01-12.");
                              return;
                            }
                            if (!/^\d{4}$/.test(excelYear.trim())) {
                              toast.error("Tahun harus 4 digit.");
                              return;
                            }
                            const distributor = excelDistributorCode.trim();
                            const principal = excelPrincipalCode.trim();
                            if (!distributor || !principal) {
                              toast.error("Distributor & Principal wajib di toolbar.");
                              return;
                            }
                            const generated = `${seq}/${distributor}-${principal}/${month}/${excelYear.trim()}`;
                            updateDraft({ noClaimDraft: generated });
                          };
                          const inputClass =
                            "w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm text-white outline-none focus:border-indigo-500/60";
                          const numberInputClass =
                            "w-24 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-right tabular-nums text-sm text-white outline-none focus:border-indigo-500/60";
                          const tinyInputClass =
                            "w-16 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-right tabular-nums text-sm text-white outline-none focus:border-indigo-500/60";
                          return (
                            <tr
                              key={item.id}
                              className={`text-slate-300 ${dirty ? "bg-amber-500/5" : ""}`}
                            >
                              <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                                {idx + 1}
                              </td>
                              <td className="px-3 py-2">
                                {sub ? (
                                  editable && canAssignNoClaim ? (
                                    <input
                                      type="text"
                                      value={draft.noClaimDraft}
                                      onChange={(event) =>
                                        updateDraft({
                                          noClaimDraft: event.target.value,
                                        })
                                      }
                                      placeholder="01/SUPER-GCPI/02/2026"
                                      className="w-44 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-emerald-200 outline-none focus:border-indigo-500/60"
                                    />
                                  ) : (
                                    <span className="font-mono text-xs text-emerald-200">
                                      {draft.noClaimDraft || "—"}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[11px] italic text-amber-300">
                                    Belum punya paket
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {item.jenisPromosi || "-"}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {item.periode || "-"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                                {item.noSurat || "-"}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {item.outlet || "-"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {editable ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={draft.dpp}
                                    onChange={(event) =>
                                      updateDraft({ dpp: event.target.value })
                                    }
                                    className={numberInputClass}
                                  />
                                ) : (
                                  rupiah(item.dpp)
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {editable ? (
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="any"
                                    value={draft.ppnRate}
                                    onChange={(event) =>
                                      updateDraft({ ppnRate: event.target.value })
                                    }
                                    className={tinyInputClass}
                                  />
                                ) : (
                                  `${item.ppnRate}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                                {rupiah(ppnValue)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {editable ? (
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="any"
                                    value={draft.pphRate}
                                    onChange={(event) =>
                                      updateDraft({ pphRate: event.target.value })
                                    }
                                    className={tinyInputClass}
                                  />
                                ) : (
                                  `${item.pphRate}%`
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                                {rupiah(pphValue)}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-white">
                                {rupiah(nilaiKlaim)}
                              </td>
                              <td className="px-3 py-2">
                                {editable && canAssignNoClaim ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={draft.sequence}
                                    onChange={(event) =>
                                      updateDraft({ sequence: event.target.value })
                                    }
                                    placeholder="01"
                                    className={`${inputClass} w-16 font-mono`}
                                  />
                                ) : (
                                  <span className="font-mono text-xs text-slate-400">
                                    {draft.sequence || "—"}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {editable && canAssignNoClaim ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={2}
                                    value={draft.month}
                                    onChange={(event) =>
                                      updateDraft({ month: event.target.value })
                                    }
                                    placeholder={excelDefaultMonth}
                                    className={`${inputClass} w-14 font-mono`}
                                  />
                                ) : (
                                  <span className="font-mono text-xs text-slate-400">
                                    {draft.month || "—"}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {sub ? (
                                  <span
                                    className={`text-xs font-bold ${docsCount === 3 ? "text-emerald-300" : "text-amber-300"}`}
                                    title="Letter / Summary / Kwitansi"
                                  >
                                    {docsCount}/3
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {sub ? rupiah(paid) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {sub
                                  ? remaining > 0
                                    ? (
                                      <span className="text-amber-200">
                                        {rupiah(remaining)}
                                      </span>
                                    )
                                    : (
                                      <span className="text-emerald-300">
                                        Lunas
                                      </span>
                                    )
                                  : "—"}
                              </td>
                              <td className="px-3 py-2">
                                {sub ? (
                                  <span
                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone(sub.status)}`}
                                  >
                                    {displayClaimStatusLabel(sub.status)}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-500">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-1.5">
                                  {editable && canAssignNoClaim && sub && (
                                    <button
                                      type="button"
                                      onClick={generateNoClaim}
                                      className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-bold text-indigo-200 hover:bg-indigo-500/20"
                                      title="Generate No Claim dari No.2 + Bulan + Toolbar"
                                    >
                                      Generate
                                    </button>
                                  )}
                                  {editable && (
                                    <button
                                      type="button"
                                      disabled={
                                        !dirty ||
                                        excelRowSavingId === item.id ||
                                        excelRowSavingId !== ""
                                      }
                                      onClick={() => void saveExcelRow(item)}
                                      className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-indigo-500 disabled:opacity-40"
                                    >
                                      {excelRowSavingId === item.id
                                        ? "Menyimpan…"
                                        : "Simpan"}
                                    </button>
                                  )}
                                  {sub && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedSubmissionId(sub.id);
                                        setSubmissionLayoutMode("master");
                                      }}
                                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-200 hover:bg-white/10"
                                      title="Buka Master Detail untuk paket ini"
                                    >
                                      Kelola Paket
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()
        ) : submissions.length === 0 ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-6 text-center">
            <p className="text-sm font-bold text-white">Belum ada Paket No Claim.</p>
            <p className="mt-1 text-xs text-slate-400">
              Buat paket pertama untuk mulai mengelompokkan item klaim.
            </p>
          </div>
        ) : submissionLayoutMode === "master" ? (
          /* Master Detail Layout */
          <div className="mt-5 grid gap-4 lg:grid-cols-12">
            {/* Left: package list */}
            <div className="space-y-3 lg:col-span-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Daftar Paket
              </p>
              <ul className="space-y-2" aria-label="Daftar Paket No Claim">
                {submissions.map((s) => {
                  const isSelected = selectedSubmissionId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedSubmissionId(s.id)}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          isSelected
                            ? "border-l-4 border-l-indigo-400 border-r-indigo-500/40 border-y-indigo-500/40 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                            : "border-white/10 bg-black/20 hover:bg-white/5"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SubmissionScopeStatusBadges submission={s} />
                        </div>
                        <p className="mt-2 text-sm font-bold text-white">
                          {getSubmissionTitle(s)}
                        </p>
                        <SubmissionNoClaimLine
                          submission={s}
                          className="mt-1 text-[11px]"
                        />
                        <div className="mt-2">
                          <SubmissionMetaRow submission={s} />
                        </div>
                        <div className="mt-2">
                          <SubmissionNextActionBadge submission={s} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            {/* Right: detail panel */}
            <div className="lg:col-span-8">
              {selectedSubmission ? (
                renderSubmissionDetailPanel(selectedSubmission)
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-center text-sm text-slate-400">
                  Pilih paket di kiri untuk melihat detailnya.
                </div>
              )}
            </div>
          </div>
        ) : submissionLayoutMode === "accordion" ? (
          /* Accordion Layout */
          <div className="mt-5 space-y-3">
            {submissions.map((s) => {
              const isOpen = openSubmissionIds.includes(s.id);
              return (
                <div
                  key={s.id}
                  className="overflow-hidden rounded-xl border border-white/10 bg-black/20"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenSubmissionIds((current) =>
                        current.includes(s.id)
                          ? current.filter((id) => id !== s.id)
                          : [...current, s.id],
                      )
                    }
                    className="flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:bg-white/5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <SubmissionScopeStatusBadges submission={s} />
                        <span className="text-sm font-bold text-white">
                          {getSubmissionTitle(s)}
                        </span>
                      </div>
                      <span
                        className="text-xs text-slate-400"
                        aria-hidden="true"
                      >
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      <SubmissionNoClaimLine
                        submission={s}
                        className="text-[11px]"
                      />
                      <SubmissionMetaRow submission={s} showItems={false} />
                      <SubmissionNextActionBadge submission={s} />
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/10 p-4">
                      {renderSubmissionDetailPanel(s)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : submissionLayoutMode === "card" ? (
          /* Kartu Layout — grid kartu 2-3 kolom + detail panel di bawah
             saat satu paket dipilih. Cocok untuk staff yang lebih suka
             scan visual. */
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {submissions.map((s) => {
                const docsCount = getSubmissionDocumentsCompletedCount(s);
                const remaining = getSubmissionRemainingAmount(s);
                const isSelected = selectedSubmissionId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedSubmissionId(s.id)}
                    className={`flex h-full flex-col gap-3 rounded-xl border p-4 text-left transition ${
                      isSelected
                        ? "border-indigo-400 bg-indigo-500/10 ring-2 ring-indigo-500/40"
                        : "border-white/10 bg-black/20 hover:bg-white/5"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SubmissionScopeStatusBadges submission={s} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">
                        {getSubmissionTitle(s)}
                      </p>
                      <SubmissionNoClaimLine
                        submission={s}
                        className="mt-1 text-[11px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <p className="text-slate-500">Total Claim</p>
                        <p className="font-bold text-white">
                          {rupiah(s.totalClaim)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Outstanding</p>
                        <p
                          className={`font-bold ${remaining > 0 ? "text-amber-200" : "text-emerald-200"}`}
                        >
                          {rupiah(remaining)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Items</p>
                        <p className="font-bold text-white">
                          {s.itemCount ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Dokumen</p>
                        <p
                          className={`font-bold ${docsCount === 3 ? "text-emerald-200" : "text-amber-200"}`}
                        >
                          {docsCount}/3
                        </p>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <SubmissionNextActionBadge submission={s} />
                      <span
                        className={`text-[11px] font-semibold ${isSelected ? "text-indigo-200" : "text-slate-500"}`}
                      >
                        {isSelected ? "Sedang dilihat" : "Klik untuk buka"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedSubmission ? (
              <div className="rounded-2xl border border-indigo-500/20 bg-black/20 p-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-200">
                  Detail Paket Terpilih
                </p>
                <div className="mt-3">
                  {renderSubmissionDetailPanel(selectedSubmission)}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-center text-sm text-slate-400">
                Pilih kartu paket di atas untuk melihat detailnya di sini.
              </div>
            )}
          </div>
        ) : submissionLayoutMode === "focus" ? (
          /* Fokus Layout — satu paket per layar dengan navigasi
             sebelumnya/berikutnya. Mode ini cocok untuk staff yang ingin
             menyelesaikan paket satu per satu tanpa distraksi. */
          (() => {
            const currentIndex = Math.max(
              0,
              submissions.findIndex((s) => s.id === selectedSubmissionId),
            );
            const safeIndex =
              currentIndex >= 0 && currentIndex < submissions.length
                ? currentIndex
                : 0;
            const current = submissions[safeIndex];
            const goPrev = () => {
              if (safeIndex > 0) {
                setSelectedSubmissionId(submissions[safeIndex - 1].id);
              }
            };
            const goNext = () => {
              if (safeIndex < submissions.length - 1) {
                setSelectedSubmissionId(submissions[safeIndex + 1].id);
              }
            };
            return (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={goPrev}
                      disabled={safeIndex === 0}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 disabled:opacity-40"
                      aria-label="Paket sebelumnya"
                    >
                      ← Sebelumnya
                    </button>
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={safeIndex === submissions.length - 1}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 disabled:opacity-40"
                      aria-label="Paket berikutnya"
                    >
                      Berikutnya →
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>
                      Paket {safeIndex + 1} dari {submissions.length}
                    </span>
                    {submissions.length > 1 && (
                      <select
                        value={current.id}
                        onChange={(event) =>
                          setSelectedSubmissionId(event.target.value)
                        }
                        className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/60"
                        aria-label="Pilih paket"
                      >
                        {submissions.map((s, idx) => (
                          <option key={s.id} value={s.id}>
                            {idx + 1}. {getSubmissionTitle(s)}
                            {s.noClaim ? ` · ${s.noClaim}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                {/* Progress dots */}
                {submissions.length > 1 && (
                  <div
                    className="flex flex-wrap items-center gap-1.5"
                    aria-hidden="true"
                  >
                    {submissions.map((s, idx) => {
                      const stage = getSubmissionLifecycleStage(s);
                      const dotColor =
                        stage === "done"
                          ? "bg-emerald-400"
                          : stage === "in_progress"
                            ? "bg-indigo-400"
                            : "bg-amber-400";
                      const isCurrent = idx === safeIndex;
                      return (
                        <span
                          key={s.id}
                          className={`h-2 w-6 rounded-full ${dotColor} ${isCurrent ? "ring-2 ring-white/40" : "opacity-50"}`}
                        />
                      );
                    })}
                  </div>
                )}
                {renderSubmissionDetailPanel(current)}
              </div>
            );
          })()
        ) : (
          /* Status Board Layout — 3 kolom per lifecycle stage. Kartu di
             setiap kolom bisa diklik untuk membuka detail di bawah board.
             Dirancang agar staff cepat melihat "apa yang harus dikerjakan
             dulu" tanpa membaca tabel besar. */
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 lg:grid-cols-3">
              {LIFECYCLE_STAGES.map((stage) => {
                const stageSubmissions = submissions.filter(
                  (s) => getSubmissionLifecycleStage(s) === stage.key,
                );
                return (
                  <div
                    key={stage.key}
                    className={`rounded-2xl border p-4 ${stage.cardClass}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">
                          {stage.title}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {stage.description}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${stage.badgeClass}`}
                      >
                        {stageSubmissions.length}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {stageSubmissions.length === 0 ? (
                        <p className="rounded-lg border border-white/5 bg-black/20 px-3 py-3 text-center text-[11px] italic text-slate-500">
                          Tidak ada paket di tahap ini.
                        </p>
                      ) : (
                        stageSubmissions.map((s) => {
                          const isSelected = selectedSubmissionId === s.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => setSelectedSubmissionId(s.id)}
                              className={`w-full rounded-lg border p-3 text-left transition ${
                                isSelected
                                  ? "border-indigo-400 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                                  : "border-white/10 bg-black/30 hover:bg-white/5"
                              }`}
                            >
                              <p className="text-sm font-bold text-white">
                                {getSubmissionTitle(s)}
                              </p>
                              <SubmissionNoClaimLine
                                submission={s}
                                className="mt-1 text-[11px]"
                              />
                              <div className="mt-2">
                                <SubmissionMetaRow
                                  submission={s}
                                  showItems={false}
                                  abbreviated
                                />
                              </div>
                              <div className="mt-2">
                                <SubmissionNextActionBadge submission={s} />
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedSubmission ? (
              <div className="rounded-2xl border border-indigo-500/20 bg-black/20 p-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-200">
                  Detail Paket Terpilih
                </p>
                <div className="mt-3">
                  {renderSubmissionDetailPanel(selectedSubmission)}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-center text-sm text-slate-400">
                Klik salah satu kartu di kolom mana pun untuk melihat detail
                paket di sini.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-white">Dokumen Klaim</h2>
            <p className="mt-1 text-sm text-slate-400">
              Tiga dokumen wajib di-generate sebelum Mark Ready: Claim Letter, Claim Summary, Kwitansi Claim.
            </p>
            {hasMultipleSubmissions && (
              <p className="mt-2 text-xs text-amber-200">
                Workflow memiliki {submissionCount} submission. Generate dokumen lewat tombol per submission di section "Claim Submissions / No Claim Groups". Tombol di section ini menolak request multi-submission (`MULTI_SUBMISSION_*_ROUTE_DISABLED`).
              </p>
            )}
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
                  <th scope="col" className="px-4 py-3 font-semibold">Submission</th>
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
                        {editable && submissions.length > 1 ? (
                          <select
                            value={item.claimSubmissionId || ""}
                            disabled={movingItemId === item.id}
                            onChange={(event) => {
                              const target = event.target.value;
                              if (target && target !== item.claimSubmissionId) {
                                void moveItemToSubmission(item.id, target);
                              }
                            }}
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/60 disabled:opacity-50"
                          >
                            {!item.claimSubmissionId && (
                              <option value="">- pilih submission -</option>
                            )}
                            {submissions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.scopeLabel || s.scope}
                                {s.noClaim ? ` | ${s.noClaim}` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {(() => {
                              const sub = submissions.find((s) => s.id === item.claimSubmissionId);
                              if (!sub) return "-";
                              return sub.noClaim || sub.scopeLabel || sub.scope;
                            })()}
                          </span>
                        )}
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-white">Pembayaran Principal / Paid</h2>
            <p className="mt-1 text-sm text-slate-400">
              Catat pembayaran yang masuk dari principal. Dukungan partial
              payment, tidak boleh overpayment. Void dipakai untuk koreksi tanpa hard-delete.
            </p>
          </div>
        </div>

        {paymentSummary && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-semibold text-slate-500">Total Claim</p>
              <p className="mt-2 text-sm font-bold text-white">{rupiah(paymentSummary.totalClaim)}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-xs font-semibold text-emerald-300">Total Paid</p>
              <p className="mt-2 text-sm font-bold text-emerald-200">{rupiah(paymentSummary.totalPaid)}</p>
            </div>
            <div className={`rounded-xl border p-3 ${paymentSummary.remainingAmount > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
              <p className={`text-xs font-semibold ${paymentSummary.remainingAmount > 0 ? "text-amber-300" : "text-emerald-300"}`}>Remaining / Outstanding</p>
              <p className={`mt-2 text-sm font-bold ${paymentSummary.remainingAmount > 0 ? "text-amber-200" : "text-emerald-200"}`}>{rupiah(paymentSummary.remainingAmount)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-semibold text-slate-500">Payment Status</p>
              <p className="mt-2 text-sm font-bold text-white">{displayClaimStatusLabel(paymentSummary.paymentStatus)}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                {paymentSummary.activePaymentCount} active · {paymentSummary.voidedPaymentCount} voided
              </p>
            </div>
          </div>
        )}

        {canRecordPayment ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
            <h3 className="text-sm font-semibold text-white">Catat Pembayaran Baru</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                Tanggal Bayar
                <input
                  type="date"
                  value={paymentDraft.paymentDate}
                  onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentDate: event.target.value })}
                  disabled={paymentSaving}
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                Nominal Bayar
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={paymentDraft.paymentAmount}
                  onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentAmount: event.target.value })}
                  disabled={paymentSaving}
                  placeholder={paymentSummary ? String(paymentSummary.remainingAmount) : "0"}
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-right font-mono text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                Jenis Pembayaran
                <input
                  type="text"
                  value={paymentDraft.paymentType}
                  onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentType: event.target.value })}
                  disabled={paymentSaving}
                  placeholder="Transfer / Tunai / Giro"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                Catatan
                <input
                  type="text"
                  value={paymentDraft.paymentNote}
                  onChange={(event) => setPaymentDraft({ ...paymentDraft, paymentNote: event.target.value })}
                  disabled={paymentSaving}
                  placeholder="Optional"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={paymentSaving}
                onClick={() => void submitPayment()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {paymentSaving ? "Menyimpan..." : "Catat Pembayaran"}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            {workflow.status === claimWorkflowStatuses.paid
              ? "Klaim sudah lunas."
              : workflow.status === claimWorkflowStatuses.closed
                ? "Workflow sudah closed."
                : workflow.status === claimWorkflowStatuses.submittedToPrincipal ||
                  workflow.status === claimWorkflowStatuses.partiallyPaid
                  ? "View-only. Hanya admin atau claim yang dapat mencatat pembayaran."
                  : "Pembayaran hanya bisa diinput setelah Submitted to Principal."}
          </p>
        )}

        <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-black/40 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Tanggal</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Nominal</th>
                <th scope="col" className="px-4 py-2 font-semibold">Jenis</th>
                <th scope="col" className="px-4 py-2 font-semibold">Catatan</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    Belum ada pembayaran tercatat.
                  </td>
                </tr>
              ) : (
                payments.map((payment) => {
                  const voided = payment.voidedAt !== null && payment.voidedAt !== undefined;
                  return (
                    <tr key={payment.id} className={voided ? "text-slate-500" : "text-slate-300"}>
                      <td className="whitespace-nowrap px-4 py-2 font-mono">{payment.paymentDate}</td>
                      <td className={`whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums ${voided ? "line-through" : "text-white"}`}>
                        {rupiah(Number(payment.paymentAmount || 0))}
                      </td>
                      <td className="px-4 py-2">{payment.paymentType || "-"}</td>
                      <td className="px-4 py-2">
                        {payment.paymentNote || "-"}
                        {voided && payment.voidReason && (
                          <p className="mt-1 text-xs text-rose-300">Void: {payment.voidReason}</p>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          voided
                            ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        }`}>
                          {voided ? "Voided" : "Active"}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {!voided && canVoidPayment ? (
                          <button
                            type="button"
                            disabled={voidingId === payment.id}
                            onClick={() => void voidPayment(payment.id)}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
                          >
                            {voidingId === payment.id ? "Memproses..." : "Void"}
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showCloseSection && (
      <section className="rounded-2xl border border-white/10 bg-[#1a1c23] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-white">Close Workflow</h2>
            <p className="mt-1 text-sm text-slate-400">
              Tutup Claim Workflow ketika klaim sudah lunas dan dokumen
              sudah lengkap. Workflow Closed bersifat read-only untuk
              payment/transition.
            </p>
          </div>
        </div>

        {workflow.status === claimWorkflowStatuses.closed ? (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-bold text-emerald-200">Closed</p>
            {workflow.closedAt && (
              <p className="mt-1 text-xs text-emerald-300">
                Closed at {dateText(workflow.closedAt)}
                {workflow.closedBy ? ` oleh ${workflow.closedBy}` : ""}
              </p>
            )}
            {workflow.closeNote && (
              <p className="mt-2 text-sm text-slate-200">
                Catatan: <span className="italic">{workflow.closeNote}</span>
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: "Status Paid", ok: workflow.status === claimWorkflowStatuses.paid },
                { label: "Outstanding = 0", ok: (paymentSummary?.remainingAmount ?? 0) === 0 },
                { label: "Total Paid >= Total Claim", ok: (paymentSummary?.totalPaid ?? 0) >= (paymentSummary?.totalClaim ?? 0) && (paymentSummary?.totalClaim ?? 0) > 0 },
                { label: "Active payment >= 1", ok: (paymentSummary?.activePaymentCount ?? 0) > 0 },
                { label: "No Claim ter-assign", ok: Boolean(workflow.noClaim && String(workflow.noClaim).trim()) },
                { label: "Claim Letter PDF", ok: Boolean(workflow.claimLetterPdfPath) },
                { label: "Summary PDF", ok: Boolean(workflow.summaryPdfPath) },
                { label: "Kwitansi Claim PDF", ok: Boolean(workflow.receiptPdfPath) },
              ].map((check) => (
                <div
                  key={check.label}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold ${
                    check.ok
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  <span>{check.label}</span>
                  <span className="font-mono uppercase tracking-wider">{check.ok ? "OK" : "PENDING"}</span>
                </div>
              ))}
            </div>

            {closeBlockers.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <p className="font-bold">Belum bisa Close:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {closeBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <label className="block text-xs font-semibold text-slate-300">
                Catatan Close (wajib)
                <textarea
                  value={closeNote}
                  onChange={(event) => setCloseNote(event.target.value)}
                  placeholder="Catatan final verifikasi, mis: dokumen lengkap, payment penuh per ..."
                  rows={3}
                  disabled={!canClose || closeSaving}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
              </label>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] italic text-slate-500">
                  {canClose
                    ? "Semua syarat terpenuhi. Pastikan catatan terisi sebelum Close."
                    : "Lengkapi syarat di atas untuk mengaktifkan tombol Close."}
                </p>
                <button
                  type="button"
                  disabled={!canClose || closeSaving || !closeNote.trim()}
                  onClick={() => void submitClose()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {closeSaving ? "Menutup..." : "Close Workflow"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      )}

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
