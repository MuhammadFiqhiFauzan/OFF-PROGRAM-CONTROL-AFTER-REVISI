# Claim Workflow AI Context

## Purpose

Claim Workflow is the post-OFF web module for monitoring claims sent to a principal, PEKA processing, EC/CN receipt, payment, outstanding balances, and final closure. Phase 1 establishes database, API, calculation, access, audit, and monitoring-page foundations only.

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

PEKA imports, payment upload/actions, status transitions, claim-letter PDF generation, and closure APIs are deliberately not implemented in Phase 1.

## Calculations

On initial creation, each `off_batch_item.nominal` is treated as DPP by default. The initial `ppnRate` and `pphRate` are `0`; claim users can later edit rates before a claim letter is generated.

```text
ppnAmount = dpp * ppnRate / 100
pphAmount = dpp * pphRate / 100
nilaiKlaim = ROUND(dpp + ppnAmount - pphAmount)
remainingAmount = max(totalClaim - totalPaid, 0)
```

## Role And Access Assumptions

- Authentication follows the existing Better Auth/session helper used by OFF Program Control.
- Creation from a completed OFF batch is limited to resolved OFF roles `admin` or `claim`.
- Read monitoring currently follows existing OFF data-access eligibility so authorized operational viewers can inspect the downstream record.
- Dashboard navigation reuses the existing `off_program_control:view` application permission to avoid introducing an incompatible RBAC migration during foundation work.

## Future Phases

1. Phase 1 foundation: isolated tables, initialization SQL, helpers, authenticated base APIs, audit creation event, and monitoring page.
2. Phase 2 edit draft + generate claim letter PDF.
3. Phase 3 PEKA import/matching.
4. Phase 4 payment/outstanding.
5. Phase 5 close workflow + audit hardening.

## Important Warnings

- Do not put PEKA/CN/payment claim statuses into `off_batch.status`.
- Do not depend on Excel filters.
- Do not depend on Word mail merge active record.
- Do not depend on `terbilang.xlam`.
- Do not treat No Surat as globally unique without validation.
- OFF nominal is currently assumed as DPP default until business confirms mapping.
