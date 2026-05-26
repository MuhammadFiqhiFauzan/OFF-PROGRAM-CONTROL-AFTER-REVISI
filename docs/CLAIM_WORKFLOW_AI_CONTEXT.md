# Claim Workflow AI Context

## Purpose

Claim Workflow is the post-OFF web module for monitoring claims sent to a
principal: pengajuan klaim (BASE), ringkasan klaim (SUMMARY), pembayaran
dari principal (PAID), dan monitoring outstanding (MONITOR OUTSTANDING).
Phase 1 established its isolated foundation; Phase 2A added safe creation
navigation, detail display, and draft tax editing. Phase 2B added
controlled status transitions, Phase 2C generates a Claim Letter PDF,
Phase R1 rewires No Claim sync between OFF dan Claim, dan Phase R2
menambah Claim Summary + Kwitansi Claim sebagai dokumen klaim wajib.

> **PEKA / EC / CN cleanup (Mei 2026).** Workflow lama yang sempat
> mempunyai tahap `Waiting PEKA`, `EC Received`, `CN Received`, beserta
> import REPORT PEKA dan matching EC/CN telah retired dari core production.
> Lihat bagian "Cleanup PEKA / EC / CN" di akhir dokumen ini sebelum
> menulis fitur baru.

## Currently Implemented Phases

### Phase 1 — foundation
- Separate Claim Workflow tables (`claim_workflow`, `claim_workflow_item`,
  `claim_payment`, `claim_audit_log`).
- `POST /api/claim-workflow/from-off-batch/[offBatchId]` create-from-OFF
  gate.
- `GET /api/claim-workflow` list endpoint and `/claim-workflow` monitoring
  page.
- Audit foundation with `claim_audit_log` and `create_from_off` action.

### Phase 2A — detail page and tax editing
- `/claim-workflow/[id]` detail page showing header totals, OFF reference,
  items, and audit history.
- `PATCH /api/claim-workflow/[id]/items/[itemId]` for editing `dpp`,
  `ppnRate`, `pphRate`, and `note` while the workflow is `Draft` or
  `Need Revision`.
- Recalculation of per-item amounts and workflow totals on each edit.
- `update_item_tax` audit entry written in the same transaction as the
  update.

### Phase 2B — safe status transitions before PDF
- `POST /api/claim-workflow/[id]/status` with three guarded actions:
  - `mark_ready`: `Draft` → `Ready to Submit`, or `Need Revision` →
    `Ready to Submit`.
  - `return_to_draft`: `Ready to Submit` → `Draft`.
  - `submit_to_principal`: `Ready to Submit` → `Submitted to Principal`.
- `submittedToPrincipalAt` is set when `submit_to_principal` succeeds.
- Item tax editing is locked at API and UI layers once the workflow
  reaches `Ready to Submit` or `Submitted to Principal`.
- Audit actions written for each transition: `mark_ready`,
  `return_to_draft`, `submit_to_principal`.

### Phase 2C — Claim Letter PDF generation
- `POST /api/claim-workflow/[id]/claim-letter` generates the claim letter
  that replaces the old Word mail merge file `SURAT CLAIM GODREJ.docx`.
- Generation is `admin`/`claim` only and is allowed from `Draft`,
  `Need Revision`, `Ready to Submit`, or `Submitted to Principal` (Phase
  R1 broadens the window so users can satisfy the Mark Ready PDF
  prerequisite without first transitioning the workflow).
- The PDF uses stored Claim Workflow items/totals rather than an Excel
  filter or Word active record. It does not depend on `terbilang.xlam`.
- The PDF is generic per principle: recipient, subject, and body all
  derive from `claim_workflow.principleName`. Godrej-specific text has
  been removed; if `principleName` is missing, the letter falls back to
  `PRINCIPAL TERKAIT`.
- Generated file metadata is stored on `claim_workflow`, and successful
  generation writes the `claim_letter_generated` audit action.
- `GET /api/claim-workflow/[id]/claim-letter` serves the previously
  generated PDF to actors permitted to view that workflow.
- Only the latest active PDF is retained. After successful regeneration,
  the previous active PDF file under `runtime/claim-workflow/letters/`
  is deleted; its path is preserved in
  `claim_audit_log.metadata.previousClaimLetterPdfPath` for
  traceability.

### Phase R1 — Rewire OFF ↔ Claim No Claim
See dedicated section below.

### Phase R2 — Claim Documents (Summary + Kwitansi)
See dedicated section below.

## Separation From OFF Program Control

OFF Program Control owns approval and verification of the OFF program
itself:

`Supervisor Draft -> Submitted to SM -> Approved by SM -> Claim Approved -> OM Approved -> Finance Paid -> Claim Final Verification -> Completed`

Claim Workflow begins after that flow has reached **OM Approved** (lihat
"Creation Gate" di bawah) dan jalan **paralel** terhadap Finance/Final
verification OFF. Submission ke principal, payment dari principal, dan
closure semua hidup di `claim_workflow.status`, **tidak pernah** di
`off_batch.status`.

## Creation Gate

A Claim Workflow draft may be created from an OFF batch only when the OFF
batch has reached `omStatus = "Approved"`. Phase R1 deliberately decoupled
Claim Workflow creation from OFF Completed so that claim users can prepare
tax editing, assign No Claim, and generate the claim documents in
parallel with the Finance/Final verification work that still happens on
the OFF side.

- Required: `off_batch.om_status = "Approved"` (`omStatus` in Drizzle).
- Not required at creation time: `off_batch.status = "Completed"`,
  `off_batch.finance_status = "Paid"`, or `off_batch.final_status = "Completed"`.

Only one `claim_workflow` is allowed for an `offBatchId`.

Creation is an explicit privilege boundary: only a resolved OFF role of
`admin` or `claim` may create a Claim Workflow from OFF. A user resolved
as `staff` must never create one, even if broad or custom application
RBAC data contains a create permission.

OFF Completed (`final-claim` action `complete`) requires the matching
Claim Workflow to have a `noClaim` value, and every `off_batch_item`
under the batch to have its `no_claim` synced. See Phase R1 below.

## Phase R1 — Rewire OFF ↔ Claim No Claim

Phase R1 unifies the No Claim source-of-truth at the Claim Workflow
header and synchronises it down to OFF items, instead of asking Claim
users to type No Claim manually inside the OFF Final Claim screen.

### Schema additions

`claim_workflow` gains three new columns:

- `no_claim TEXT` — main No Claim for this Claim Workflow.
- `no_claim_assigned_at INTEGER` — timestamp of last assignment.
- `no_claim_assigned_by TEXT` — actor user id of last assignment.

A partial unique index `idx_claim_workflow_no_claim_unique` enforces
uniqueness of `no_claim` across `claim_workflow` rows, but only when
`no_claim IS NOT NULL AND no_claim <> ''`. NULL values may repeat freely
(many drafts without a No Claim). Backend rejects empty strings before
writing.

`scripts/init-db.mjs` is updated to add the columns and index to fresh
local DBs, and to ALTER existing DBs without dropping data.

### Endpoint: assign / update No Claim

`PATCH /api/claim-workflow/[id]/no-claim` — `admin`/`claim` only.

Request body:

```json
{ "noClaim": "09/SUPER-GCPI/02/2026" }
```

Validation:

- `noClaim` must be a non-empty string after trim, max 120 characters.
- `noClaim` must be unique across `claim_workflow` (other rows). The
  endpoint pre-checks and also catches the SQLite UNIQUE constraint as a
  defensive fallback for race conditions.
- The Claim Workflow must exist; the actor must have access.

Side effects (single transaction):

1. Update `claim_workflow` with `noClaim`, `noClaimAssignedAt`,
   `noClaimAssignedBy`, `updatedAt`.
2. `UPDATE off_batch_item SET no_claim = ? WHERE batch_id = ?` for the
   linked `off_batch_id` so every OFF item under the batch is synced.
3. Insert audit `no_claim_assigned` (metadata: previousNoClaim,
   newNoClaim, offBatchId, assignedBy).
4. Insert audit `no_claim_synced_to_off` (metadata: previousNoClaim,
   newNoClaim, offBatchId, syncedItemCount, assignedBy).

If any step fails, the transaction rolls back and neither the workflow
header nor the OFF items are updated.

### OFF Completed gate (Phase R1 additions)

`POST /api/off-program-control/batches/[id]/final-claim` action
`complete` keeps the existing rules (Finance Paid, payments have proofs,
totals match) and adds:

- A Claim Workflow must exist for the OFF batch
  (`claim_workflow.off_batch_id`). Otherwise `409` with code
  `OFF_FINAL_CLAIM_WORKFLOW_REQUIRED`.
- The Claim Workflow must have `no_claim` assigned. Otherwise `409` with
  code `OFF_FINAL_NO_CLAIM_REQUIRED`.
- Every `off_batch_item` row that has a `noSurat` must have a non-empty
  `no_claim`. Otherwise `409` with code `OFF_FINAL_NO_CLAIM_NOT_SYNCED`.

OFF Completed does **not** require Claim Workflow to be `Submitted to
Principal`. The two workflows progress independently; the only crossover
is the No Claim sync.

The body field `claimRefs[].noClaim` is no longer used by the backend
(the OFF item `no_claim` is read from the row already synced from Claim
Workflow). Existing callers can keep sending it, but it has no effect.
The OFF Final Claim UI now renders the No Claim column read-only and
shows a hint to assign / update No Claim in Claim Workflow.

### UI changes

- Claim Workflow detail page (`/claim-workflow/[id]`) gains a "No Claim"
  section that displays the value and assignment metadata when present,
  and exposes input + Assign/Update buttons for `admin`/`claim`. Other
  roles see read-only.
- OFF Final Claim form (`/off-program-control` Claim tab → final claim
  panel) shows the No Claim column read-only with a hint pointing at
  Claim Workflow as the source of truth.

## Phase R2 — Claim Documents

Phase R2 introduces two new mandatory PDFs alongside the existing Claim
Letter, so Claim Workflow always ships a complete document package:

1. Claim Letter (Phase 2C, unchanged file layout, generatable from
   `Draft` / `Need Revision` / `Ready to Submit` / `Submitted to
   Principal`).
2. Claim Summary (R2 new).
3. Kwitansi Claim — pre-submission receipt (R2 new).

The Kwitansi Claim is **not** a principal payment receipt. It is a
distributor-side document that accompanies the Claim Letter + Summary
when the claim package is sent to the principal. It does **not** depend
on `claim_payment`.

### Architecture decision

Phase R2 follows Option A: extend `claim_workflow` with column metadata
for each document. We deliberately do **not** introduce a separate
`claim_workflow_document` table yet; the existing pattern for Claim
Letter is mirrored 1:1 per document type. If business later asks for
full per-document versioning, regeneration history, or signature
attestation across all old PDFs, the `claim_workflow_document` table
should be revisited.

### Schema additions

Six nullable columns on `claim_workflow`:

- `summary_pdf_path TEXT`
- `summary_generated_at INTEGER`
- `summary_generated_by TEXT`
- `receipt_pdf_path TEXT`
- `receipt_generated_at INTEGER`
- `receipt_generated_by TEXT`

`scripts/init-db.mjs` adds matching `ALTER TABLE` migrations idempotent
with the existing pattern.

### File storage

- Claim Letter → `runtime/claim-workflow/letters/{safe}-claim-letter-{timestamp}.pdf`.
- Claim Summary → `runtime/claim-workflow/summaries/{safe}-summary-{timestamp}.pdf`.
- Kwitansi Claim → `runtime/claim-workflow/receipts/{safe}-receipt-{timestamp}.pdf`.

Each route validates that the persisted path resolves inside its own
directory (`isPathInsideSummaryDir`, `isPathInsideReceiptDir`) before
serving or deleting the file. Paths outside the allowed directory are
refused with 400.

### Endpoints

- `POST /api/claim-workflow/[id]/summary` — admin/claim only. Generates
  the Summary PDF, atomically updates `summary_pdf_path` /
  `summary_generated_at` / `summary_generated_by`, and writes a
  `claim_summary_generated` audit row in the same transaction. The new
  PDF is written to disk first; if the transaction rolls back the new
  file is deleted. After commit the previous active PDF (if any) is
  deleted best-effort.
- `GET /api/claim-workflow/[id]/summary` — `canActorReadClaimWorkflow`
  gate. Streams the active PDF inline.
- `POST /api/claim-workflow/[id]/receipt` — admin/claim only, same
  semantics. Audit action `claim_receipt_generated`.
- `GET /api/claim-workflow/[id]/receipt` — viewer access, mirrors the
  Summary GET.

### Generation window

`Draft`, `Need Revision`, `Ready to Submit`, `Submitted to Principal`.
Other statuses return 409. This lets users generate / regenerate before
Mark Ready and replace a PDF after submission if the principal asks for
a clean copy.

### Mark Ready validation (full set after R2)

`mark_ready` requires:

- At least one `claim_workflow_item`.
- `claim_workflow.totalClaim > 0`.
- Every item `dpp > 0` and `nilaiKlaim > 0`.
- `noClaim` present (`CLAIM_WORKFLOW_NO_CLAIM_REQUIRED`).
- `claimLetterPdfPath` present (`CLAIM_WORKFLOW_CLAIM_LETTER_REQUIRED`).
- `summaryPdfPath` present (`CLAIM_WORKFLOW_SUMMARY_REQUIRED`).
- `receiptPdfPath` present (`CLAIM_WORKFLOW_RECEIPT_REQUIRED`).

`mark_ready` does **not** auto-generate any PDF; the user must hit each
generation endpoint first.

### `return_to_draft` invalidation (R2 additions)

When a workflow is returned to Draft, all three documents are
invalidated atomically:

- DB columns reset to NULL: `claim_letter_pdf_path` / `summary_pdf_path` /
  `receipt_pdf_path` (plus their `*_generated_at` and `*_generated_by`
  pairs).
- Files on disk are deleted best-effort, only when the path resolves
  inside the corresponding allowed directory.
- Audit metadata records the previous paths under
  `invalidatedClaimLetterPdfPath`, `invalidatedSummaryPdfPath`, and
  `invalidatedReceiptPdfPath` for traceability.

This avoids any stale "valid" PDF from being shipped to the principal
after the underlying tax/items have been revised in Draft.

`return_to_draft` also requires a non-empty `note` (alasan); the backend
rejects blank notes with HTTP 400 and code `RETURN_TO_DRAFT_NOTE_REQUIRED`.

### Audit actions added

- `claim_summary_generated` — metadata: `pdfPath`, `itemCount`,
  `totalClaim`, `noClaim`, `generatedBy`, optional `previousPdfPath`.
- `claim_receipt_generated` — metadata: same fields as Summary.
- The `return_to_draft` audit row carries the `invalidatedClaimLetterPdfPath`,
  `invalidatedSummaryPdfPath`, dan `invalidatedReceiptPdfPath` fields.

### Detail page UI

The detail page exposes a single "Dokumen Klaim" section with three
cards (Claim Letter, Claim Summary, Kwitansi Claim). Each card shows
generated/not-generated badge, generated timestamp (when present),
"Open PDF" link (when present), and "Generate" / "Regenerate" button for
admin/claim. Staff sees read-only with no action buttons. A reminder
message under the section flags that all three documents are required
for Mark Ready while the workflow is in `Draft` or `Need Revision`.

## Status Lifecycle (Production)

Production status set, dari `lib/claim-workflow/constants.ts`:

```
Draft
Need Revision
Ready to Submit
Submitted to Principal
Partially Paid
Paid
Outstanding
Closed
Cancelled
```

Allowed transitions (Phase 2B + R3 plan):

1. `Draft` / `Need Revision` → `Ready to Submit` (`mark_ready`).
2. `Ready to Submit` → `Draft` (`return_to_draft`, requires note;
   invalidates all three documents).
3. `Ready to Submit` → `Submitted to Principal` (`submit_to_principal`).
4. `Submitted to Principal` → `Partially Paid` ketika
   `totalPaid > 0 AND totalPaid < totalClaim` (R3, payment workflow).
5. `Submitted to Principal` → `Paid` ketika `totalPaid >= totalClaim`
   (R3, payment workflow).
6. `Partially Paid` → `Paid` ketika `totalPaid >= totalClaim` (R3).
7. `Paid` → `Closed` via close endpoint (R4).

`Outstanding` adalah label monitoring untuk klaim yang lewat deadline
tanpa pembayaran lengkap. Akan dipakai oleh dashboard Monitor Outstanding
(R3); tidak menggantikan status payment biasa.

`Cancelled` disisakan untuk skenario pembatalan eksplisit oleh admin.
Tidak ada UI transisi otomatis di phase saat ini.

### Mapping ke Excel sumber

| Excel sheet/file        | Web mapping                                          |
|-------------------------|------------------------------------------------------|
| `BASE`                  | `claim_workflow_item` (DPP / PPN / PPH / Nilai Klaim)|
| `SUMMARY`               | Claim Summary PDF + dashboard `/claim-workflow`      |
| `Paid`                  | `claim_payment` (R3)                                 |
| `Monitoring Outstanding`| Outstanding dashboard berbasis `remainingAmount` (R3)|
| `SURAT CLAIM`           | Claim Letter PDF (Phase 2C)                          |

## Database Responsibilities

- `claim_workflow`: one post-OFF claim header per OM-approved OFF batch,
  with lifecycle status, aggregate money fields, three document path
  metadata sets, dan No Claim utama.
- `claim_workflow_item`: claim line snapshot derived from
  `off_batch_item`, editable for tax rates and notes saat workflow
  Draft/Need Revision.
- `claim_payment`: claim payment transactions dari principal (R3).
- `claim_audit_log`: Claim Workflow-only activity trail, independent of
  OFF audit history.

## API Responsibilities

- `GET /api/claim-workflow`: authenticated monitoring list, including
  OFF No Pengajuan where available.
- `POST /api/claim-workflow/from-off-batch/[offBatchId]`: `admin`/`claim`
  creation endpoint; enforces OFF OM Approved gate, prevents duplicate
  drafts, copies OFF items, calculates header totals, dan logs
  `create_from_off`.
- `GET /api/claim-workflow/[id]`: authenticated header, line item, dan
  payment list.
- `GET /api/claim-workflow/[id]/audit`: authenticated Claim Workflow
  audit history.
- `PATCH /api/claim-workflow/[id]/items/[itemId]`: `admin`/`claim` only;
  updates `dpp`, `ppnRate`, `pphRate`, dan `note` while the workflow is
  `Draft` or `Need Revision`, then logs `update_item_tax`.
- `POST /api/claim-workflow/[id]/status`: `admin`/`claim` only; safe
  status transitions (`mark_ready`, `return_to_draft`,
  `submit_to_principal`).
- `PATCH /api/claim-workflow/[id]/no-claim`: assign / update No Claim
  utama dan sync ke OFF items.
- `POST /api/claim-workflow/[id]/claim-letter`: `admin`/`claim` only;
  generates Claim Letter PDF; logs `claim_letter_generated`.
- `GET /api/claim-workflow/[id]/claim-letter`: serves stored PDF.
- `POST /api/claim-workflow/[id]/summary` / `GET .../summary`: Summary
  PDF (R2).
- `POST /api/claim-workflow/[id]/receipt` / `GET .../receipt`: Kwitansi
  Claim PDF (R2).

Payment entry, payment proof upload, outstanding dashboard, dan close
APIs adalah scope R3/R4 dan belum diimplementasi.

## Calculations

On initial creation, each `off_batch_item.nominal` is treated as DPP by
default. The initial `ppnRate` and `pphRate` are `0`; claim users can
later edit rates before a claim letter is generated.

```text
ppnAmount = ROUND(dpp * ppnRate / 100)
pphAmount = ROUND(dpp * pphRate / 100)
nilaiKlaim = dpp + ppnAmount - pphAmount
remainingAmount = max(totalClaim - totalPaid, 0)
```

`remainingAmount` is intentionally clamped to zero so outstanding can
never go negative on a UI dashboard. Overpayment is **not** modelled
yet. When overpayment reconciliation becomes a real requirement, model
it explicitly with a separate field, for example:

```text
overpaidAmount = max(totalPaid - totalClaim, 0)
remainingAmount = max(totalClaim - totalPaid, 0)
```

Do not represent overpayment as a negative `remainingAmount`.

After each tax edit, the item amounts are recalculated with the same
calculation helper and the header is recomputed from all workflow
items:

```text
totalDpp = sum(item.dpp)
totalPpn = sum(item.ppnAmount)
totalPph = sum(item.pphAmount)
totalClaim = sum(item.nilaiKlaim)
remainingAmount = max(totalClaim - totalPaid, 0)
```

The item update, header aggregate update, and `update_item_tax` audit
entry are written together in a transaction.

Catatan untuk MONITOR OUTSTANDING: Excel kadang memakai konvensi tanda
`Sisa = Nilai Bayar - Nilai`. Aplikasi web **tidak** mengikuti konvensi
tanda tersebut. Outstanding di web selalu `max(totalClaim - totalPaid, 0)`.

## Role And Access Assumptions

- Authentication follows the existing Better Auth/session helper used by
  OFF Program Control.
- Claim Workflow has its own RBAC/access module
  (`lib/claim-workflow/access.ts`) for creation, detail, and audit
  decisions.
- Creation from OM-approved OFF is limited to resolved OFF roles `admin`
  or `claim`. The gate `canActorCreateClaimWorkflow` does **not** fall
  back to the broad RBAC `canAccess("claim_workflow", "create", ...)` —
  even if a custom permission map accidentally grants
  `claim_workflow:create`, only `admin`/`claim` may use the
  create-from-OFF endpoint.
- `staff` Claim Workflow permissions in `rolePermissionPresets` are
  intentionally view-only (`["view"]`). Staff must not have `create`,
  `edit`, `update`, or `submit` for `claim_workflow` in the role preset;
  if a custom permission map adds these for a specific user, server
  endpoints still reject the action because they require resolved role
  `admin` or `claim`.
- `supervisor`, `viewer`, `manager`, and `finance` likewise must not be
  allowed to create or transition Claim Workflow.
- Read monitoring currently follows existing OFF data-access eligibility
  so authorized operational viewers can inspect the downstream record.

## OFF Guardrails Required By Claim Workflow

- Duplicate No Surat detection remains active per principle; batches in
  the existing `Cancelled by OM` released status do not block a new use.
- A duplicate No Surat override is restricted to resolved `admin` or
  `claim` roles karena No Surat ikut dipakai sebagai referensi di
  Claim Letter dan dokumen klaim lainnya.
- OFF batch `PATCH` must validate incoming header/item data and
  duplicate No Surat rules before any mutation, or perform the complete
  write atomically in a database transaction. A failed validation must
  not persist header changes while retaining old items.

## Cleanup PEKA / EC / CN (Mei 2026)

Semua artefak workflow PEKA/EC/CN yang sebelumnya direncanakan untuk
Phase 3+ telah retired:

- Status `Waiting PEKA`, `EC Received`, `CN Received` dihapus dari
  `claim_workflow_statuses`. Mereka tetap dikenali sebagai
  `LEGACY_PEKA_STATUSES` dan ditampilkan oleh UI sebagai fallback
  `Submitted to Principal` agar workflow lama tidak crash.
- API routes `POST /api/claim-workflow/peka/import` dan
  `GET /api/claim-workflow/[id]/peka-matches` dihapus.
- File helper `lib/claim-workflow/peka.ts` dihapus.
- Tabel `claim_peka_report` dan kolom `claim_workflow_item.ec_peka` /
  `cn_number` / `nomor_ec_internal` dihapus dari skema Drizzle aktif.
  Database SQLite lokal lama mungkin masih memiliki tabel/kolom tersebut
  secara fisik; aplikasi tidak lagi merujuk ke sana. Untuk DB bersih,
  reset:
  ```powershell
  node scripts/reset-data.mjs
  node scripts/init-db.mjs
  npm run seed:demo
  ```
- Demo seed di `scripts/seed-demo-workflows.mjs` tidak lagi membuat baris
  PEKA, EC, atau CN.
- UI `/claim-workflow` dan `/claim-workflow/[id]` tidak lagi memunculkan
  "PEKA Manual Import", "Load PEKA Matches", atau aksi transisi
  `Waiting PEKA` / `EC Received` / `CN Received`.

**Aturan untuk kontributor masa depan:**

- Jangan menambahkan kembali status PEKA/EC/CN ke
  `claim_workflow_statuses`.
- Jangan menjadikan EC/CN sebagai gate `mark_ready`, payment,
  outstanding, atau close.
- Jangan menambahkan import PEKA atau matching EC/CN sebagai fitur
  aktif.
- Jangan memasukkan status Claim Workflow ke `off_batch.status`.
- Jangan memasukkan status OFF ke `claim_workflow.status`.

## Implementation Roadmap

1. **Phase 1** — foundation: tabel terpisah, init SQL, helpers, base API,
   audit, monitoring page. ✅
2. **Phase 2A** — creation action, detail page, draft tax editing. ✅
3. **Phase 2B** — safe status transitions + item edit lock. ✅
4. **Phase 2C** — Claim Letter PDF dari data Claim Workflow. ✅
5. **Phase R1** — rewire OFF ↔ Claim No Claim sync. ✅
6. **Phase R2** — Claim Summary + Kwitansi Claim PDF. ✅
7. **Phase R3 (next)** — Principal Payment + Outstanding:
   `claim_payment` API/UI, Monitor Outstanding dashboard berbasis
   `remainingAmount = max(totalClaim - totalPaid, 0)`, transisi
   `Submitted to Principal` → `Partially Paid` / `Paid` berbasis total
   pembayaran masuk.
8. **Phase R4** — Close Workflow: transisi `Paid` → `Closed` dengan
   gate `remainingAmount = 0` dan dokumen lengkap.
9. **Phase R5** — Reporting / Export.
10. **Phase R6** — Hardening (perf, audit retention, RBAC review).

### Future R3 — Principal Payment + Outstanding

Untuk dipertimbangkan saat membangun R3:

- Endpoint `POST /api/claim-workflow/[id]/payments` untuk role
  admin/claim:
  - Body: `paymentDate`, `paymentAmount`, `paymentType`, `paymentNote`,
    optional `proofPath` (upload bisa menyusul).
  - Insert ke `claim_payment`, hitung ulang `totalPaid` dan
    `remainingAmount`, dan otomatis transisi status workflow:
    `Submitted to Principal` / `Partially Paid` → `Partially Paid` jika
    `totalPaid > 0 AND totalPaid < totalClaim`; → `Paid` jika
    `totalPaid >= totalClaim`. Audit `payment_recorded` plus transisi
    audit yang sesuai.
- Outstanding dashboard berbasis filter status + `remainingAmount > 0`
  dan deadline (kalau dimodelkan). Tidak butuh EC/CN.
- Payment endpoint **tidak boleh** mensyaratkan EC/CN.

### Future R4 — Close Workflow

- Endpoint `POST /api/claim-workflow/[id]/close` untuk admin/claim.
- Gate: `status = Paid`, `remainingAmount = 0`, dokumen lengkap, audit
  lengkap, optional final note.
- Audit `close_workflow`. Set `closed_at`.

## Important Warnings

- Do not put Claim Workflow statuses (`Ready to Submit`, `Submitted to
  Principal`, `Partially Paid`, `Paid`, `Outstanding`, `Closed`) into
  `off_batch.status`.
- Do not implement payment, close, or overpayment lifecycles outside the
  scope of R3/R4.
- `staff` Claim Workflow permission preset must remain `["view"]` only.
- `canActorCreateClaimWorkflow` must not fall back to broad RBAC
  `canAccess("claim_workflow", "create", ...)`. Resolved role must be
  `admin` or `claim`.
- `remainingAmount` must remain `max(totalClaim - totalPaid, 0)`.
  Negative outstanding is forbidden.
- Do not depend on Excel filters, Word mail merge active record, or
  `terbilang.xlam`.
- Do not treat No Surat as globally unique without validation.
- Do not allow supervisors to force a duplicate No Surat override.
- OFF item nominal is currently treated as initial DPP until business
  confirms mapping.
- See "Cleanup PEKA / EC / CN" section. Do not reintroduce PEKA / EC /
  CN flows.
