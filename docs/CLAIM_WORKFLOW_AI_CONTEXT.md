# Claim Workflow AI Context

## Purpose

Claim Workflow is the post-OFF web module for monitoring claims sent to a principal, PEKA processing, EC/CN receipt, payment, outstanding balances, and final closure. Phase 1 established its isolated foundation; Phase 2A added safe creation navigation, detail display, and draft tax editing. Phase 2B added controlled status transitions, and Phase 2C generates a claim-letter PDF from approved Claim Workflow data.

## Currently Implemented Phases

### Phase 1 — foundation
- Separate Claim Workflow tables (`claim_workflow`, `claim_workflow_item`, `claim_payment`, `claim_peka_report`, `claim_audit_log`).
- `POST /api/claim-workflow/from-off-batch/[offBatchId]` create-from-OFF gate.
- `GET /api/claim-workflow` list endpoint and `/claim-workflow` monitoring page.
- Audit foundation with `claim_audit_log` and `create_from_off` action.

### Phase 2A — detail page and tax editing
- `/claim-workflow/[id]` detail page showing header totals, OFF reference, items, and audit history.
- `PATCH /api/claim-workflow/[id]/items/[itemId]` for editing `dpp`, `ppnRate`, `pphRate`, and `note` while the workflow is `Draft` or `Need Revision`.
- Recalculation of per-item amounts and workflow totals on each edit.
- `update_item_tax` audit entry written in the same transaction as the update.

### Phase 2B — safe status transitions before PDF
- `POST /api/claim-workflow/[id]/status` with three guarded actions:
  - `mark_ready`: `Draft` → `Ready to Submit`, or `Need Revision` → `Ready to Submit`.
  - `return_to_draft`: `Ready to Submit` → `Draft`.
  - `submit_to_principal`: `Ready to Submit` → `Submitted to Principal`.
- `submittedToPrincipalAt` is set when `submit_to_principal` succeeds.
- Item tax editing is locked at API and UI layers once the workflow reaches `Ready to Submit` or `Submitted to Principal`.
- Audit actions written for each transition: `mark_ready`, `return_to_draft`, `submit_to_principal`.

### Phase 2C - claim letter PDF generation
- `POST /api/claim-workflow/[id]/claim-letter` generates the claim letter that replaces the old Word mail merge file `SURAT CLAIM GODREJ.docx`.
- Generation is `admin`/`claim` only and is allowed only from `Ready to Submit` or `Submitted to Principal`, never `Draft` or `Need Revision`.
- The PDF uses stored Claim Workflow items/totals rather than an Excel filter or Word active record. It does not depend on `terbilang.xlam`.
- The PDF is generic per principle: recipient, subject, and body all derive from `claim_workflow.principleName`. Godrej-specific text has been removed; if `principleName` is missing, the letter falls back to `PRINCIPAL TERKAIT`.
- Generated file metadata is stored on `claim_workflow`, and successful generation writes the `claim_letter_generated` audit action.
- `GET /api/claim-workflow/[id]/claim-letter` serves the previously generated PDF to actors permitted to view that workflow.
- Only the latest active PDF is retained. After successful regeneration, the previous active PDF file under `runtime/claim-workflow/letters/` is deleted; its path is preserved in `claim_audit_log.metadata.previousClaimLetterPdfPath` for traceability.

> Future audit-grade document versioning should use a separate document/version table if the business requires every historical PDF to remain accessible. Until then, treat the active PDF as the only authoritative artifact.

## Separation From OFF Program Control

OFF Program Control owns approval and verification of the OFF program itself:

`Supervisor Draft -> Submitted to SM -> Approved by SM -> Claim Approved -> OM Approved -> Finance Paid -> Claim Final Verification -> Completed`

Claim Workflow begins after that flow is finished. PEKA, EC, CN, and post-submission claim-payment lifecycle states belong to `claim_workflow.status`, never to `off_batch.status`.

## Creation Gate

A Claim Workflow draft may be created from an OFF batch only when the OFF
batch has reached `omStatus = "Approved"`. Phase R1 deliberately decoupled
Claim Workflow creation from OFF Completed so that claim users can prepare
tax editing, assign No Claim, and generate the Claim Letter PDF in parallel
with the Finance/Final verification work that still happens on the OFF
side.

- Required: `off_batch.om_status = "Approved"` (`omStatus` in Drizzle).
- Not required at creation time: `off_batch.status = "Completed"`,
  `off_batch.finance_status = "Paid"`, or `off_batch.final_status = "Completed"`.

Only one `claim_workflow` is allowed for an `offBatchId`.

Creation is an explicit privilege boundary: only a resolved OFF role of
`admin` or `claim` may create a Claim Workflow from OFF. A user resolved as
`staff` must never create one, even if broad or custom application RBAC
data contains a create permission.

OFF Completed (`final-claim` action `complete`) now requires the matching
Claim Workflow to have a `noClaim` value, and every `off_batch_item`
under the batch to have its `no_claim` synced. See Phase R1 below.

## Phase R1 — Rewire OFF ↔ Claim No Claim

Phase R1 unifies the No Claim source-of-truth at the Claim Workflow header
and synchronises it down to OFF items, instead of asking Claim users to
type No Claim manually inside the OFF Final Claim screen.

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

### Mark Ready validation (Phase R1 additions)

`POST /api/claim-workflow/[id]/status` action `mark_ready` keeps the
existing item/total checks and adds two more required-fields checks
before allowing `Draft` or `Need Revision` → `Ready to Submit`:

- `claim_workflow.no_claim` must be present (after trim).
- `claim_workflow.claim_letter_pdf_path` must be present.

If either is missing the route returns `422` with code
`CLAIM_WORKFLOW_NO_CLAIM_REQUIRED` or `CLAIM_WORKFLOW_CLAIM_LETTER_REQUIRED`
respectively. `mark_ready` does **not** auto-generate the PDF; the user
must hit the Claim Letter generation endpoint first.

### Claim Letter PDF generation in Draft / Need Revision

`POST /api/claim-workflow/[id]/claim-letter` is now allowed from `Draft`
and `Need Revision` (in addition to `Ready to Submit` and
`Submitted to Principal`) so the user can satisfy the Mark Ready PDF
prerequisite without first transitioning the workflow. Validation on
items/totals stays the same.

### OFF Completed gate (Phase R1 additions)

`POST /api/off-program-control/batches/[id]/final-claim` action `complete`
keeps the existing rules (Finance Paid, payments have proofs, totals
match) and adds:

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

### Status separation

PEKA / EC / CN / payment / closed lifecycle remains exclusively in
`claim_workflow.status`. OFF status fields stay limited to OFF approval
+ Finance + final-verification states. This was already a guardrail, and
Phase R1 reaffirms it because the new cross-link via No Claim could
otherwise tempt future contributors to push Claim status into OFF.

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

1. Claim Letter (Phase 2C, unchanged file layout, but now generatable
   from `Draft` / `Need Revision` per Phase R1).
2. Claim Summary (R2 new).
3. Kwitansi Claim — pre-submission receipt (R2 new).

The Kwitansi Claim is not a principal payment receipt. It is a
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

- Claim Letter → `runtime/claim-workflow/letters/{safe}-claim-letter-{timestamp}.pdf`
  (existing, unchanged).
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

Same as Claim Letter post-R1: `Draft`, `Need Revision`,
`Ready to Submit`, `Submitted to Principal`. Other statuses return 409.
This lets users generate / regenerate before Mark Ready and replace a
PDF after submission if the principal asks for a clean copy.

### Mark Ready validation (R2 additions)

`mark_ready` keeps the Phase R1 checks and now also requires:

- `summary_pdf_path` is present (`CLAIM_WORKFLOW_SUMMARY_REQUIRED`).
- `receipt_pdf_path` is present (`CLAIM_WORKFLOW_RECEIPT_REQUIRED`).

The complete Mark Ready prerequisite set is therefore:

- `noClaim` present
- `claimLetterPdfPath` present
- `summaryPdfPath` present
- `receiptPdfPath` present
- `totalClaim > 0`
- Every item `dpp > 0` and `nilaiKlaim > 0`
- At least one item

### `return_to_draft` invalidation (R2 additions)

When a workflow is returned to Draft, all three documents are now
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

### Audit actions added

- `claim_summary_generated` — metadata: `pdfPath`, `itemCount`,
  `totalClaim`, `noClaim`, `generatedBy`, optional `previousPdfPath`.
- `claim_receipt_generated` — metadata: same fields as Summary.
- The existing `return_to_draft` audit row also carries the new
  `invalidatedSummaryPdfPath` / `invalidatedReceiptPdfPath` fields.

### Detail page UI

The detail page now exposes a single "Dokumen Klaim" section with three
cards (Claim Letter, Claim Summary, Kwitansi Claim). Each card shows
generated/not-generated badge, generated timestamp (when present),
"Open PDF" link (when present), and "Generate" / "Regenerate" button for
admin/claim. Staff sees read-only with no action buttons. A reminder
message under the section flags that all three documents are required
for Mark Ready while the workflow is in `Draft` or `Need Revision`.

### Demo seed

`scripts/seed-demo-workflows.mjs` now generates stub PDFs for Summary
and Kwitansi Claim alongside the Claim Letter for any demo workflow at
`Ready to Submit` or beyond, mirroring the Phase R1 noClaim seed
pattern. Stub PDFs use the `runtime/claim-workflow/{summaries,receipts}`
directories. Demo audit rows include `claim_summary_generated` and
`claim_receipt_generated` events when the stubs succeed.

## Legacy Mapping

| Previous file/workbook role | Web foundation mapping |
| --- | --- |
| Excel `BASE` | `claim_workflow_item` source claim lines |
| Excel `SUMMARY` | Claim Workflow dashboard monitoring |
| Excel `Paid` | Future payment tab backed by `claim_payment` |
| Excel `Monitoring Outstanding` | Outstanding dashboard/status reporting |
| Excel `REPORT PEKA` | Future import into `claim_peka_report` and EC/CN matching |
| Word `SURAT CLAIM GODREJ.docx` | Replaced by Phase 2C Claim Letter PDF generation |

## Status Lifecycle

Nominal lifecycle:

`OFF Completed -> Draft -> Ready to Submit -> Submitted to Principal -> Waiting PEKA -> EC Received -> CN Received -> Partially Paid / Paid -> Closed`

Defined initial statuses:

- `Draft`
- `Ready to Submit`
- `Submitted to Principal`
- `Waiting PEKA`
- `EC Received`
- `CN Received`
- `Partially Paid`
- `Paid`
- `Outstanding`
- `Closed`
- `Need Revision`
- `Cancelled`

## Database Responsibilities

- `claim_workflow`: one post-OFF claim header per completed OFF batch, with lifecycle status and aggregate money fields.
- `claim_workflow_item`: claim line snapshot derived from `off_batch_item`, later editable for tax rates and EC/CN references.
- `claim_payment`: future claim payment transactions and proof references.
- `claim_peka_report`: future imported external PEKA report rows used for EC/CN matching.
- `claim_audit_log`: Claim Workflow-only activity trail, independent of OFF audit history.

## API Responsibilities

- `GET /api/claim-workflow`: authenticated monitoring list, including OFF No Pengajuan where available.
- `POST /api/claim-workflow/from-off-batch/[offBatchId]`: `admin`/`claim` creation endpoint; enforces OFF completion gate, prevents duplicate drafts, copies OFF items, calculates header totals, and logs `create_from_off`.
- `GET /api/claim-workflow/[id]`: authenticated header, line item, and future payment detail response.
- `GET /api/claim-workflow/[id]/audit`: authenticated Claim Workflow audit history.
- `PATCH /api/claim-workflow/[id]/items/[itemId]`: `admin`/`claim` only; updates `dpp`, `ppnRate`, `pphRate`, and `note` while the workflow is `Draft` or `Need Revision`, then logs `update_item_tax`.
- `POST /api/claim-workflow/[id]/status`: `admin`/`claim` only; safe status transitions before PDF generation (Phase 2B). See section below.
- `POST /api/claim-workflow/[id]/claim-letter`: `admin`/`claim` only; creates an A4 claim-letter PDF from a `Ready to Submit` or `Submitted to Principal` workflow and logs `claim_letter_generated`.
- `GET /api/claim-workflow/[id]/claim-letter`: serves the stored PDF to authorized workflow viewers without regenerating it.

PEKA imports, EC/CN matching, payment upload/actions, and closure APIs are deliberately not implemented yet.

## Phase 2A UI

- Eligible completed OFF details show a small `Create Claim Workflow` action for `admin`/`claim`; the endpoint remains the authoritative creation gate.
- `/claim-workflow/[id]` displays the workflow header totals, OFF reference, item snapshot, and accessible Claim audit history.
- Items may be edited inline only for `Draft` or `Need Revision` workflows, and only the tax/DPP/note fields are changed in Phase 2A.

## Phase 2B Status Transitions

Phase 2B introduced controlled status transitions so claim users can lock a draft before Phase 2C PDF generation. PEKA import, EC/CN matching, payment entry, upload proof, close workflow, and overpayment fields remain intentionally deferred.

### Endpoint

`POST /api/claim-workflow/[id]/status`

Request body:

```json
{ "action": "mark_ready" | "return_to_draft" | "submit_to_principal", "note": "optional" }
```

Successful response shape:

```json
{ "ok": true, "success": true, "workflow": { "id": "...", "status": "...", "totalClaim": 0, "submittedToPrincipalAt": "...", "itemCount": 0 } }
```

### Allowed Transitions

- `mark_ready`: `Draft` → `Ready to Submit`, or `Need Revision` → `Ready to Submit`.
- `return_to_draft`: `Ready to Submit` → `Draft`. Requires a non-empty `note` (alasan) in the request body; the backend rejects blank notes with HTTP 400 and code `RETURN_TO_DRAFT_NOTE_REQUIRED`. The reason is mandatory because returning to Draft invalidates the active Claim Letter PDF and reopens tax editing, so the audit log must capture why.
- `submit_to_principal`: `Ready to Submit` → `Submitted to Principal`. Sets `claim_workflow.submitted_to_principal_at` to the transition timestamp.

No other transitions (`Waiting PEKA`, `EC Received`, `CN Received`, `Partially Paid`, `Paid`, `Outstanding`, `Closed`, `Cancelled`) are implemented in this phase.

### Role Access

Only resolved OFF role `admin` or `claim` may invoke status transitions. `staff` and `supervisor` must not. The endpoint enforces this regardless of broader RBAC permissions.

### Validation For `mark_ready`

- Current status must be `Draft` or `Need Revision`.
- Workflow must contain at least one `claim_workflow_item`.
- `claim_workflow.totalClaim` must be `> 0`.
- Every item `dpp` must be `> 0`.
- Every item `nilaiKlaim` must be `> 0`.
- `note` is optional.

### Validation For `return_to_draft`

- Current status must be `Ready to Submit`.
- `note` (alasan) is **required** and must be a non-empty string after trim. The backend returns HTTP 400 with code `RETURN_TO_DRAFT_NOTE_REQUIRED` and message "Alasan wajib diisi saat mengembalikan Claim Workflow ke Draft." when missing or blank.
- The detail page UI must prompt the user for the reason and refuse to call the API with a blank input.

`submit_to_principal` only validates the source status (validation already happened at `mark_ready`); it does not generate any PDF, import any PEKA data, or create any payment.

### Audit

Each successful transition writes a `claim_audit_log` row with the action name (`mark_ready`, `return_to_draft`, or `submit_to_principal`), `fromStatus`, `toStatus`, and metadata containing `totalDpp`, `totalPpn`, `totalPph`, `totalClaim`, `totalPaid`, `remainingAmount`, and `itemCount`. The status update and audit insert run in the same database transaction so the lifecycle never advances without a paired audit entry.

### Item Edit Lock

After a workflow reaches `Ready to Submit` or `Submitted to Principal`, item tax editing is locked at both layers:

- API: `PATCH /api/claim-workflow/[id]/items/[itemId]` returns 409 unless the workflow is `Draft` or `Need Revision`.
- UI: `/claim-workflow/[id]` only renders inline tax inputs and the `Edit Tax` button while the workflow is `Draft` or `Need Revision`.

To resume editing after `Ready to Submit`, an authorized user must first invoke `return_to_draft`. Once `submit_to_principal` has been performed, no current Phase 2B transition can move it back; that decision is intentionally deferred until later phases model revision/cancellation paths.

### Detail Page UI

- `Draft` or `Need Revision`: header shows a `Mark Ready` button.
- `Ready to Submit`: header shows `Return to Draft` and `Submit to Principal`. `Submit to Principal` requires an in-page confirmation before the request is sent.
- All other statuses: no transition buttons are shown in this phase.

## Phase 2C Claim Letter PDF

Phase 2C generates an A4 claim-letter PDF as the web replacement for `SURAT CLAIM GODREJ.docx`. It uses persisted `claim_workflow` and `claim_workflow_item` values, including DPP, PPN, PPH, and `nilaiKlaim`; it does not depend on Word mail merge, Excel filters, or `terbilang.xlam`. Generation remains blocked for `Draft` and `Need Revision`.

The letter is generic per principle: the recipient line, subject (`Perihal`), and body all use `claim_workflow.principleName`. Godrej-specific text has been removed. If `principleName` is missing or blank for any reason, the letter falls back to `PRINCIPAL TERKAIT` so the workflow does not break for non-Godrej principles. The signature block remains `CV. Surya Perkasa / Distributor Makassar`.

The detail page displays generation state and a link to the stored PDF after generation. `claim_workflow.claim_letter_pdf_path`, `claim_letter_generated_at`, and `claim_letter_generated_by` store the current generated artifact metadata, while `claim_audit_log.action = "claim_letter_generated"` records each successful generation.

If a generated `Ready to Submit` workflow is returned to `Draft`, its active claim-letter metadata is cleared so a revised draft cannot expose a stale PDF as current. The `return_to_draft` audit metadata retains the invalidated file path for traceability.

### PDF Storage Behavior

- Only the latest active Claim Letter PDF is retained. After a successful regeneration, the previous active PDF file under `runtime/claim-workflow/letters/` is deleted, and its path is recorded in `claim_audit_log.metadata.previousClaimLetterPdfPath` for traceability.
- After `return_to_draft`, the active PDF metadata on `claim_workflow` is cleared and the file (if it still resides under `runtime/claim-workflow/letters/`) is deleted; the path is preserved in `claim_audit_log.metadata.invalidatedClaimLetterPdfPath`.
- Old PDF *content* is not guaranteed to remain accessible after regeneration or `return_to_draft`. Only the audit metadata path is retained.
- TODO: Future audit-grade document versioning should use a separate document/version table if the business requires every historical PDF to remain accessible. Phase 2C deliberately keeps a single active artifact.

## Current Active Flow

```
OFF Completed
  -> Create Claim Workflow (admin/claim)
  -> Draft
  -> Edit DPP / PPN / PPH (admin/claim, items in Draft / Need Revision)
  -> Ready to Submit (mark_ready, requires totalClaim > 0 and every item DPP/Nilai Klaim > 0)
  -> Generate Claim Letter PDF (admin/claim, generic per principleName)
  -> Submitted to Principal (submit_to_principal)
```

`return_to_draft` is the only backwards transition currently allowed (`Ready to Submit` → `Draft`); it requires a non-empty `note` and clears the active Claim Letter PDF metadata.

## Phase 3A PEKA Manual Import And Matching Preview

Phase 3A introduces the foundation for replacing the Excel `REPORT PEKA` workbook. It is **preview-only**: PEKA rows are imported into `claim_peka_report`, but EC/CN values are NOT yet written into `claim_workflow_item` and Claim Workflow status is NOT changed by import or preview.

### Import endpoint

`POST /api/claim-workflow/peka/import` (admin/claim only)

- Accepts `multipart/form-data` with field `file` (`.xlsx` or `.csv`, ≤ 10 MB).
- Parses the first worksheet using the existing `xlsx` package.
- Header matching is tolerant via `normalizeHeader`: `CLAIM NO.`, `CLAIM NO`, `Jenis Klaim`, `RD NAME`, `PERIODE`, `NO. SURAT RD`, `NO SURAT RD`, `TOTAL CLAIM`, `CN NUMBER`, `CN`, `REQUESTOR`, `LAST PROCESSED/RECIVE DATE`, `LAST PROCESSED/RECEIVE DATE`, `PENDING USER`, `LEAD TIME`, `AGE`, `NOTE`, `EC`.
- Rows whose `noSuratRd` is blank after `normalizeNoSurat` are skipped and counted in `skippedCount`.
- Non-numeric `TOTAL CLAIM` cells are stored as `0` and reported as warnings; date-ish columns are kept as text in this phase.
- Insert is wrapped in a single transaction so import is all-or-nothing.
- Response: `{ ok, success, importedCount, skippedCount, warningCount, warnings[≤20], sourceFile }`.
- The endpoint never updates `claim_workflow_item` and never changes `claim_workflow.status`.

### Matching preview endpoint

`GET /api/claim-workflow/[id]/peka-matches` (any user allowed to read the workflow)

- Loads workflow items and PEKA rows.
- Indexes PEKA rows by `normalizeNoSurat(no_surat_rd)`.
- For each item, returns a preview row with `matchedCount` and `status`:
  - `matchedCount = 0` → `unmatched`.
  - `matchedCount = 1` → `matched` with `bestMatch` (EC, CN, claimNo, totalClaim, pendingUser, leadTime, age, note, sourceFile, importedAt).
  - `matchedCount > 1` → `duplicate_match`. The most recently imported row is exposed as `bestMatch`; the rest go into `conflictMatches` for manual review.
- The endpoint is **read-only**: no DB writes, no audit row.

### Detail page UI

`/claim-workflow/[id]` adds a "PEKA Preview" section with a `Load PEKA Matches` button, a per-item table (No Surat, Jenis Promosi, Nilai Klaim, status pill, EC, CN, Pending User, Lead Time, Source File), and an explicit duplicate-match warning. Apply/update buttons are intentionally absent in Phase 3A.

### List page UI

`/claim-workflow` shows a "PEKA Manual Import" panel only for resolved OFF roles `admin` or `claim`. Staff and other roles never see the upload control.

### Normalization rule

Both endpoints use `normalizeNoSurat` from `lib/claim-workflow/peka.ts`: trim, collapse whitespace, normalise spacing around `/`, then uppercase. Empty/blank inputs become an empty string and are excluded from index/matching.

### Deferred until later phases

- Applying EC/CN to `claim_workflow_item` (writing `ecPeka`, `cnNumber`).
- Auto-resolving duplicate matches.
- Transitioning Claim Workflow status to `Waiting PEKA`, `EC Received`, or `CN Received`.
- Payment entry, payment proof upload, close workflow, overpayment field.
- Automatic sync from a network folder.

## Calculations

On initial creation, each `off_batch_item.nominal` is treated as DPP by default. The initial `ppnRate` and `pphRate` are `0`; claim users can later edit rates before a claim letter is generated.

```text
ppnAmount = ROUND(dpp * ppnRate / 100)
pphAmount = ROUND(dpp * pphRate / 100)
nilaiKlaim = dpp + ppnAmount - pphAmount
remainingAmount = max(totalClaim - totalPaid, 0)
```

`remainingAmount` is intentionally clamped to zero in this phase via `Math.max(totalClaim - totalPaid, 0)` so outstanding can never go negative on a UI dashboard. Overpayment is **not** modelled in Phase 2B. When overpayment reconciliation becomes a real requirement, model it explicitly with a separate field, for example:

```text
overpaidAmount = max(totalPaid - totalClaim, 0)
remainingAmount = max(totalClaim - totalPaid, 0)
```

Do not represent overpayment as a negative `remainingAmount`.

After each tax edit, the item amounts are recalculated with the same calculation helper and the header is recomputed from all workflow items:

```text
totalDpp = sum(item.dpp)
totalPpn = sum(item.ppnAmount)
totalPph = sum(item.pphAmount)
totalClaim = sum(item.nilaiKlaim)
remainingAmount = max(totalClaim - totalPaid, 0)
```

The item update, header aggregate update, and `update_item_tax` audit entry are written together in a transaction.

## Role And Access Assumptions

- Authentication follows the existing Better Auth/session helper used by OFF Program Control.
- Claim Workflow has its own RBAC/access module (`lib/claim-workflow/access.ts`) for creation, detail, and audit decisions.
- Creation from a completed OFF batch is limited to resolved OFF roles `admin` or `claim`. The gate `canActorCreateClaimWorkflow` does **not** fall back to the broad RBAC `canAccess("claim_workflow", "create", ...)` — even if a custom permission map accidentally grants `claim_workflow:create`, only `admin`/`claim` may use the create-from-OFF endpoint.
- `staff` Claim Workflow permissions in `rolePermissionPresets` are intentionally view-only (`["view"]`). Staff must not have `create`, `edit`, `update`, or `submit` for `claim_workflow` in the role preset; if a custom permission map adds these for a specific user, server endpoints still reject the action because they require resolved role `admin` or `claim`.
- `supervisor`, `viewer`, `manager`, and `finance` likewise must not be allowed to create or transition Claim Workflow.
- Read monitoring currently follows existing OFF data-access eligibility so authorized operational viewers can inspect the downstream record.

## OFF Guardrails Required By Claim Workflow

- Duplicate No Surat detection remains active per principle; batches in the existing `Cancelled by OM` released status do not block a new use.
- A duplicate No Surat override is restricted to resolved `admin` or `claim` roles because No Surat is a future matching key for PEKA, EC, and CN.
- OFF batch `PATCH` must validate incoming header/item data and duplicate No Surat rules before any mutation, or perform the complete write atomically in a database transaction. A failed validation must not persist header changes while retaining old items.

## Implementation Roadmap

1. Phase 1 foundation: isolated tables, initialization SQL, helpers, authenticated base APIs, audit creation event, and monitoring page.
2. Phase 2A: safe creation action, detail page, and draft/revision item tax editing.
3. Phase 2B: safe status transitions before PDF generation (`mark_ready`, `return_to_draft`, `submit_to_principal`) with audit and item edit lock after `Ready to Submit`.
4. Phase 2C implemented: generate claim letter PDF from `Ready to Submit` or `Submitted to Principal` using Claim Workflow database data.
5. Phase 3: PEKA import/matching.
6. Phase 4: payment/outstanding (including the dedicated `overpaidAmount` field if business confirms overpayment is in scope).
7. Phase 5: close workflow + audit hardening.

### Intentionally Deferred Features

The following remain deferred after Phase 2C:

- PEKA import (Phase 3).
- EC/CN matching (Phase 3).
- Payment entry (Phase 4).
- Upload payment proof (Phase 4).
- Close workflow lifecycle and `Cancelled` transitions (Phase 5).
- `overpaidAmount` field — keep `remainingAmount` clamped to zero until then.
- Full transactional refactor of OFF Program Control `PATCH` beyond what is already in place.

Claim-letter PDF generation must only be allowed from `Ready to Submit` or `Submitted to Principal` - never from `Draft` or `Need Revision`.

## Important Warnings

- Do not put Claim Workflow statuses (`Ready to Submit`, `Submitted to Principal`, `Waiting PEKA`, `EC Received`, `CN Received`, `Partially Paid`, `Paid`, `Closed`) into `off_batch.status`.
- Do not put PEKA/CN/payment claim statuses into `off_batch.status`.
- Do not implement PEKA, payment, close, or overpayment lifecycles in Phase 2C.
- `staff` Claim Workflow permission preset must remain `["view"]` only. Do not re-add `create`, `edit`, `update`, or `submit` to `rolePermissionPresets.staff.claim_workflow`.
- `canActorCreateClaimWorkflow` must not fall back to broad RBAC `canAccess("claim_workflow", "create", ...)`. Resolved role must be `admin` or `claim`.
- `remainingAmount` must remain `max(totalClaim - totalPaid, 0)`. Negative outstanding is forbidden in this phase.
- Do not depend on Excel filters.
- Do not depend on Word mail merge active record.
- Do not depend on `terbilang.xlam`.
- Do not treat No Surat as globally unique without validation.
- Do not allow supervisors to force a duplicate No Surat override.
- OFF item nominal is currently treated as initial DPP until business confirms mapping.
- Claim-letter PDF generation is allowed only from `Ready to Submit` or `Submitted to Principal`, not `Draft`.
