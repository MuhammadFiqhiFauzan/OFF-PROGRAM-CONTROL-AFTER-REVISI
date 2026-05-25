# Claim Workflow AI Context

## Purpose

Claim Workflow is the post-OFF web module for monitoring claims sent to a principal, PEKA processing, EC/CN receipt, payment, outstanding balances, and final closure. Phase 1 established its isolated foundation; Phase 2A added safe creation navigation, detail display, and draft tax editing. Phase 2B adds controlled status transitions before any future PDF generation.

## Separation From OFF Program Control

OFF Program Control owns approval and verification of the OFF program itself:

`Supervisor Draft -> Submitted to SM -> Approved by SM -> Claim Approved -> OM Approved -> Finance Paid -> Claim Final Verification -> Completed`

Claim Workflow begins after that flow is finished. PEKA, EC, CN, and post-submission claim-payment lifecycle states belong to `claim_workflow.status`, never to `off_batch.status`.

## Creation Gate

A Claim Workflow draft may be created from an OFF batch only when all conditions are true:

- `off_batch.status = "Completed"`
- `off_batch.finance_status = "Paid"` (`financeStatus` in Drizzle)
- `off_batch.final_status = "Completed"` (`finalStatus` in Drizzle)

Only one `claim_workflow` is allowed for an `offBatchId`.

Creation is an explicit privilege boundary: only a resolved OFF role of `admin` or `claim` may create a Claim Workflow from OFF. A user resolved as `staff` must never create one, even if broad or custom application RBAC data contains a create permission.

## Legacy Mapping

| Previous file/workbook role | Web foundation mapping |
| --- | --- |
| Excel `BASE` | `claim_workflow_item` source claim lines |
| Excel `SUMMARY` | Claim Workflow dashboard monitoring |
| Excel `Paid` | Future payment tab backed by `claim_payment` |
| Excel `Monitoring Outstanding` | Outstanding dashboard/status reporting |
| Excel `REPORT PEKA` | Future import into `claim_peka_report` and EC/CN matching |
| Word `SURAT CLAIM GODREJ.docx` | Future PDF claim letter generator |

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

PEKA imports, payment upload/actions, claim-letter PDF generation, and closure APIs are deliberately not implemented yet.

## Phase 2A UI

- Eligible completed OFF details show a small `Create Claim Workflow` action for `admin`/`claim`; the endpoint remains the authoritative creation gate.
- `/claim-workflow/[id]` displays the workflow header totals, OFF reference, item snapshot, and accessible Claim audit history.
- Items may be edited inline only for `Draft` or `Need Revision` workflows, and only the tax/DPP/note fields are changed in Phase 2A.

## Phase 2B Status Transitions

Phase 2B introduces controlled status transitions so claim users can lock a draft before any future PDF generation. PDF generation, PEKA import, EC/CN matching, payment entry, upload proof, close workflow, and overpayment fields remain intentionally deferred.

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
- `return_to_draft`: `Ready to Submit` → `Draft`.
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

`return_to_draft` only validates the source status. `submit_to_principal` only validates the source status (validation already happened at `mark_ready`); it does not generate any PDF, import any PEKA data, or create any payment.

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

### Future Phase 2C

Phase 2C will generate the claim-letter PDF from a workflow that is `Ready to Submit` or `Submitted to Principal`. PDF generation must remain blocked until Phase 2B status control exists, which is what this phase establishes.

## Calculations

On initial creation, each `off_batch_item.nominal` is treated as DPP by default. The initial `ppnRate` and `pphRate` are `0`; claim users can later edit rates before a claim letter is generated.

```text
ppnAmount = ROUND(dpp * ppnRate / 100)
pphAmount = ROUND(dpp * pphRate / 100)
nilaiKlaim = dpp + ppnAmount - pphAmount
remainingAmount = max(totalClaim - totalPaid, 0)
```

`remainingAmount` is clamped to zero in Phase 1. TODO: if overpayment reconciliation is required later, model it explicitly (for example with a dedicated overpaid amount) rather than representing it as negative remaining amount.

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
- Creation from a completed OFF batch is limited to resolved OFF roles `admin` or `claim`.
- `staff` may retain policy-approved read access, but must not create Claim Workflow records.
- Read monitoring currently follows existing OFF data-access eligibility so authorized operational viewers can inspect the downstream record.

## OFF Guardrails Required By Claim Workflow

- Duplicate No Surat detection remains active per principle; batches in the existing `Cancelled by OM` released status do not block a new use.
- A duplicate No Surat override is restricted to resolved `admin` or `claim` roles because No Surat is a future matching key for PEKA, EC, and CN.
- OFF batch `PATCH` must validate incoming header/item data and duplicate No Surat rules before any mutation, or perform the complete write atomically in a database transaction. A failed validation must not persist header changes while retaining old items.

## Future Phases

1. Phase 1 foundation: isolated tables, initialization SQL, helpers, authenticated base APIs, audit creation event, and monitoring page.
2. Phase 2A: safe creation action, detail page, and draft/revision item tax editing.
3. Phase 2B: safe status transitions before PDF generation (`mark_ready`, `return_to_draft`, `submit_to_principal`) with audit and item edit lock after `Ready to Submit`.
4. Phase 2C: generate claim letter PDF from `Ready to Submit` or `Submitted to Principal`, only after the DPP/PPN/PPH mapping has been verified by users.
5. Phase 3: PEKA import/matching.
6. Phase 4: payment/outstanding.
7. Phase 5: close workflow + audit hardening.

Do not start PDF generation until users have verified the DPP/PPN/PPH mapping. Do not implement PEKA import, EC/CN matching, payment entry, upload proof, close workflow, or overpayment field as part of Phase 2B.

## Important Warnings

- Do not put Claim Workflow statuses (`Ready to Submit`, `Submitted to Principal`, `Waiting PEKA`, `EC Received`, `CN Received`, `Partially Paid`, `Paid`, `Closed`) into `off_batch.status`.
- Do not put PEKA/CN/payment claim statuses into `off_batch.status`.
- Do not implement PEKA, payment, close, or overpayment lifecycles in Phase 2B.
- Do not depend on Excel filters.
- Do not depend on Word mail merge active record.
- Do not depend on `terbilang.xlam`.
- Do not treat No Surat as globally unique without validation.
- Do not allow supervisors to force a duplicate No Surat override.
- OFF nominal is currently treated as initial DPP until business confirms mapping.
