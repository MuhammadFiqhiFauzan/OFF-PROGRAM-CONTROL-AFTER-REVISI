# Phase R7 Manual QA Checklist

End-to-end manual QA untuk Claim Workflow R7 (Multi No Claim + Direct
Source). Hasil pengembangan semua R7a–R7f dengan pengecualian R7f apply
yang HOLD sampai operator approve. Run integration test sebagai
prerequisite sebelum manual QA.

## Prerequisite

```
npm.cmd exec tsc -- --noEmit --pretty false
node --check scripts/init-db.mjs
node --check scripts/migrate-r7a-default-submission.mjs
node --check scripts/migrate-r7f-nullable-off-batch.mjs
node --check scripts/test-r7c-documents.mjs
node --check scripts/test-r7d-submission-payments.mjs
node --check scripts/test-r7e-close-reports.mjs
node --check scripts/test-r7f-direct-source.mjs
node scripts/test-r7c-documents.mjs        # 88 PASS
node scripts/test-r7d-submission-payments.mjs # 41 PASS
node scripts/test-r7e-close-reports.mjs    # 36 PASS
node scripts/test-r7f-direct-source.mjs    # 7 PASS, 9 SKIP (HOLD)
```

Semua harus exit 0.

---

## Section A — R7b Submission CRUD + Item Assignment

| # | Step | Expected |
|---|------|----------|
| A1 | Buat Claim Workflow dari OFF batch (`omStatus = "Approved"`) | Workflow created dengan 1 default submission (backfill atau create-from-OFF) |
| A2 | POST `/api/claim-workflow/[id]/submissions` dengan `scope=per_program`, `scopeLabel="Program A"`, `noClaim="CLM-001"` (admin/claim, status Draft) | 201, submission baru |
| A3 | POST submission tambahan ke workflow yang sama (admin/claim) | OK |
| A4 | POST `/api/claim-workflow/[id]/submissions/[subId]/items` dengan `itemIds=[itemA]` | Item A pindah ke submission baru, totals submission lama + baru di-recalc |
| A5 | PATCH `/api/claim-workflow/[id]/submissions/[subId]` ubah noClaim | OK; sync ke off_batch_item yang assigned ke submission ini |
| A6 | PATCH legacy `/[id]/no-claim` saat workflow multi-submission | 409 `MULTI_SUBMISSION_NO_CLAIM_ROUTE_DISABLED` |
| A7 | Staff (read-only) akses GET submissions | 200 |
| A8 | Staff POST submission | 403 |

---

## Section B — R7c Documents per Submission

| # | Step | Expected |
|---|------|----------|
| B1 | POST `/[id]/submissions/[subA]/claim-letter` dengan items yang assigned ke A | 201, file di `runtime/claim-workflow/{wfId}/submissions/{subA}/letter/...pdf`. Items hanya milik subA. |
| B2 | POST sama untuk `summary` dan `receipt` | 201 untuk masing-masing tipe |
| B3 | POST `/[id]/submissions/[subB]/claim-letter` | 201, file di submission B folder, items hanya milik subB |
| B4 | GET `/[id]/submissions/[subA]/claim-letter` | Stream PDF subA |
| B5 | GET legacy `/[id]/claim-letter` saat workflow multi-submission | 409 `MULTI_SUBMISSION_LETTER_ROUTE_DISABLED` (POST). GET path validation tetap berlaku jika cache workflow ada. |
| B6 | POST status `return_to_draft` | Cache workflow + semua kolom path PDF di setiap submission di-reset ke NULL; file di disk best-effort di-unlink |
| B7 | Workflow single-submission: POST legacy `/[id]/claim-letter` | OK, file di legacy dir + mirror ke submission tunggal |

---

## Section C — R7d Payment per Submission

| # | Step | Expected |
|---|------|----------|
| C1 | Submission A status Submitted to Principal, totalClaim 500k. POST `/[id]/submissions/[subA]/payments` 200k | 201, A.totalPaid=200k, A.remaining=300k, A.status `Partially Paid`, workflow aggregate `Partially Paid` |
| C2 | Submission B totalClaim 700k. POST submission B payment 700k | B.status `Paid`, B.remaining=0, A masih Partially Paid, workflow aggregate `Partially Paid` |
| C3 | POST submission A 300k (sisa) | A `Paid`, workflow aggregate `Paid` |
| C4 | POST submission A 1 (overpay) | 409 `CLAIM_PAYMENT_OVERPAYMENT` |
| C5 | POST `/[id]/submissions/[subB]/payments/[paymentId]/void` dengan reason | B revert ke Submitted to Principal, workflow aggregate `Partially Paid` (or Submitted) |
| C6 | POST legacy `/[id]/payments` saat multi | 409 `MULTI_SUBMISSION_PAYMENT_ROUTE_DISABLED` |
| C7 | POST legacy `/[id]/payments` di workflow single-submission | 201, payment ter-link ke submission tunggal |
| C8 | GET `/api/claim-workflow/outstanding` | Returns 1 row per submission yang remainingAmount > 0. Submission Paid/Closed excluded. |

---

## Section D — R7e Close per Submission + Workflow Aggregate

| # | Step | Expected |
|---|------|----------|
| D1 | Submission A Paid + 3 PDF + 1 active payment, POST `/[id]/submissions/[subA]/close` dengan note | A `Closed`, workflow aggregate masih bukan Closed (B belum Closed) |
| D2 | Submission B belum Paid → POST `/[id]/submissions/[subB]/close` | 409 `CLAIM_CLOSE_NOT_PAID` |
| D3 | Pay B full + B punya 3 PDF, POST close B | B `Closed`, workflow aggregate `Closed`, workflow status mirror `Closed`, workflow.closed_at terisi |
| D4 | POST legacy `/[id]/close` saat multi-submission | 409 `MULTI_SUBMISSION_CLOSE_ROUTE_DISABLED` |
| D5 | Workflow single-submission: POST legacy close | OK, mirror cache workflow + status submission Closed |
| D6 | GET `/api/claim-workflow/reports/summary` | 1 row per submission, kolom `submissionId`, `noClaim`, `scope`, `submissionStatus`, `workflowAggregateStatus` |
| D7 | GET `/api/claim-workflow/reports/paid` | 1 row per payment dengan `submissionId`, `noClaim`, `scope`, `scopeLabel` |
| D8 | GET `/api/claim-workflow/reports/outstanding` | Submission rows dengan remainingAmount > 0; Closed/Paid excluded |
| D9 | Export CSV ketiga report | UTF-8 BOM, escape comma/quote/newline, Content-Disposition filename `claim-<name>-report-YYYYMMDD.csv` |

---

## Section E — R7f Direct/Manual Source (HOLD)

R7f saat ini berstatus **HOLD**. Schema masih `off_batch_id NOT NULL`.
Migration script tersedia tapi belum di-apply. Direct create route belum
di-implement untuk mencegah half-implementation.

| # | Step | Expected |
|---|------|----------|
| E1 | `node scripts/migrate-r7f-nullable-off-batch.mjs` (dry-run) | Print rencana eksekusi, no DB changes |
| E2 | `node scripts/test-r7f-direct-source.mjs` | 7 PASS + 9 SKIP, 0 FAIL |
| E3 | (Future) Apply migration: `node scripts/migrate-r7f-nullable-off-batch.mjs --apply` | Backup auto + rebuild table + foreign_key_check pass + row count sama. **Hanya jalankan dengan persetujuan operator + verifikasi backup.** |
| E4 | (Future, after E3) `POST /api/claim-workflow/from-direct` | Belum di-implement; route akan dibuat di phase berikut setelah E3 sukses |

**Tidak boleh apply E3 dalam manual QA tanpa konfirmasi eksplisit.**

---

## Section F — Compatibility & Boundary

| # | Step | Expected |
|---|------|----------|
| F1 | OFF Program Control flow tidak terpengaruh | OFF batch create/approve/payment/complete normal |
| F2 | OFF Completed gate tetap memvalidasi `claim_workflow.noClaim` + per-item `off_batch_item.noClaim` | Reject 409 `OFF_FINAL_NO_CLAIM_REQUIRED` jika belum ter-assign |
| F3 | `off_batch.status` tidak pernah berisi status Claim (`Submitted to Principal` / `Partially Paid` / `Paid` / `Closed`) | Inspect manual via `SELECT DISTINCT status FROM off_batch` |
| F4 | Status Claim tidak pernah masuk OFF status | sama sebaliknya |
| F5 | PEKA grep classification: production refs = 0 | `git grep -i "waiting_peka"`, `git grep -i "ec_received"`, `git grep -i "cn_received"`, `git grep -i "claim_peka_report"`, `git grep -i "peka-matches"` semua hanya hit docs retired / legacy cleanup script |

---

## Section G — RBAC Final Review

| Endpoint | admin/claim | staff (claim_workflow.view) | role lain |
|----------|-------------|------------------------------|-----------|
| GET `/api/claim-workflow/[id]` | ✓ | ✓ | 403 |
| GET `/api/claim-workflow/[id]/submissions` | ✓ | ✓ | 403 |
| POST `/api/claim-workflow/[id]/submissions` | ✓ | 403 | 403 |
| PATCH submission | ✓ | 403 | 403 |
| POST item assign | ✓ | 403 | 403 |
| POST submission docs (letter/summary/receipt) | ✓ | 403 | 403 |
| POST submission payment | ✓ | 403 | 403 |
| POST submission void payment | ✓ | 403 | 403 |
| POST submission close | ✓ | 403 | 403 |
| GET reports | ✓ | ✓ | 403 |
| GET outstanding | ✓ | ✓ | 403 |

---

## Sign-off

| Section | Status | Notes |
|---------|--------|-------|
| A. R7b CRUD + items | | |
| B. R7c documents per submission | | |
| C. R7d payment per submission | | |
| D. R7e close + reports per submission | | |
| E. R7f HOLD verification | | |
| F. Compatibility & boundary | | |
| G. RBAC | | |

QA dijalankan oleh: ___________________  Tanggal: __________
