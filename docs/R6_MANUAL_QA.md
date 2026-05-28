# Phase R6 — Manual QA Checklist

Dokumen ini hanya untuk hardening Phase R6 (Mei 2026). Tidak ada fitur
baru. Tujuannya: memvalidasi bahwa Claim Workflow end-to-end + boundary
OFF tetap konsisten setelah patch R6.

Konvensi:
- Semua langkah dijalankan di environment lokal Windows (`D:\KULYEAH\AccAPI-main - Copy`).
- Database SQLite lokal harus sudah di-seed (`npm run seed:demo`) atau
  punya minimal satu OFF batch dengan `omStatus = "Approved"`.
- Setiap langkah disertai _expected result_. Tandai PASS / FAIL dengan
  catatan kalau ada deviation.

---

## A. Baseline Validation

| # | Step | Expected |
|---|------|----------|
| A1 | `git branch --show-current` | `chore/claim-workflow-hardening-r6` |
| A2 | `git status --short` | clean (kecuali patch R6 yang sedang dikerjakan) |
| A3 | `npm.cmd exec tsc -- --noEmit --pretty false` | exit 0, no output |
| A4 | `node --check scripts/init-db.mjs` | `init-db syntax OK` |
| A5 | `git grep -n -i "waiting_peka"` | 0 production refs (hanya docs/legacy fallback) |
| A6 | `git grep -n -i "claim_peka_report"` | 0 production refs (hanya docs + legacy cleanup) |

---

## B. Claim Workflow End-to-End (admin/claim role)

### B1. Create from OFF
1. Login sebagai `admin` atau `claim`.
2. Buka OFF batch dengan `omStatus = "Approved"` dan tanpa Claim
   Workflow yang ada.
3. Klik "Buat Claim Workflow dari OFF".

Expected:
- Workflow Claim baru tercipta dengan status `Draft`.
- Item OFF disalin ke `claim_workflow_item` dengan DPP/PPN/PPh.
- Audit `create_from_off` muncul di `claim_audit_log`.

### B2. Edit item / pajak (Draft)
1. Edit DPP atau ppnRate / pphRate satu item.

Expected:
- `nilaiKlaim`, `totalDpp`, `totalPpn`, `totalPph`, `totalClaim`
  ter-update di workflow.
- Audit `update_item_tax` muncul.
- Edit ditolak kalau workflow `Ready to Submit` / `Submitted to Principal`
  / `Paid` / `Closed`.

### B3. Assign No Claim
1. PATCH `/api/claim-workflow/[id]/no-claim` dengan `noClaim` non-empty
   (mis. `"CLM-2026-0001"`).

Expected:
- `claim_workflow.noClaim` ter-set.
- Semua `off_batch_item.noClaim` pada batch terkait disinkron.
- Dua audit ditulis: `no_claim_assigned` + `no_claim_synced_to_off`.
- Empty string ditolak `NO_CLAIM_EMPTY`.
- Duplicate dengan workflow lain ditolak `NO_CLAIM_DUPLICATE`.

### B4. Generate 3 dokumen
1. POST claim letter, summary, kwitansi (3 endpoint terpisah).

Expected:
- Tiga file PDF tersimpan di `runtime/claim-workflow/{letters,summaries,receipts}/`.
- Tiga audit ditulis: `claim_letter_generated`, `claim_summary_generated`,
  `claim_receipt_generated`.
- Window status: `Draft` / `Need Revision` / `Ready to Submit` /
  `Submitted to Principal` saja.

### B5. Mark Ready
1. POST status `mark_ready`.

Expected:
- Workflow → `Ready to Submit`.
- Tolak kalau `noClaim` kosong (`CLAIM_WORKFLOW_NO_CLAIM_REQUIRED`).
- Tolak kalau Claim Letter kosong (`CLAIM_WORKFLOW_CLAIM_LETTER_REQUIRED`).
- Tolak kalau Summary kosong (`CLAIM_WORKFLOW_SUMMARY_REQUIRED`).
- Tolak kalau Kwitansi kosong (`CLAIM_WORKFLOW_RECEIPT_REQUIRED`).
- Tolak kalau totalClaim = 0 atau ada item DPP/Nilai Klaim ≤ 0.

### B6. Return to Draft
1. POST status `return_to_draft` dengan `note` non-empty.

Expected:
- Workflow → `Draft`.
- Ketiga PDF di-invalidate (file dihapus, kolom path NULL).
- Audit metadata berisi `invalidatedClaimLetterPdfPath`,
  `invalidatedSummaryPdfPath`, `invalidatedReceiptPdfPath`.
- Tolak `note` kosong (`RETURN_TO_DRAFT_NOTE_REQUIRED`).

### B7. Submit to Principal
1. POST status `submit_to_principal` dari `Ready to Submit`.

Expected:
- Workflow → `Submitted to Principal`.
- `submittedToPrincipalAt` ter-set.

---

## C. Principal Payment + Outstanding

### C1. Partial payment
1. POST `/api/claim-workflow/[id]/payments` dengan `paymentAmount` <
   `totalClaim`.

Expected:
- Status workflow → `Partially Paid`.
- `totalPaid`, `remainingAmount` ter-recalc.
- Audit `payment_created` + `payment_status_recalculated`.

### C2. Overpayment
1. POST `paymentAmount` > sisa outstanding.

Expected:
- 409 `CLAIM_PAYMENT_OVERPAYMENT`.

### C3. Full payment (Rp1 dead-end check)
1. POST payment final yang persis menutup outstanding ke 0.

Expected:
- Status → `Paid`.
- `remainingAmount = 0` tepat (tidak ada toleransi Rp1).

### C4. Void payment
1. POST `/api/claim-workflow/[id]/payments/[paymentId]/void` dengan
   `reason` non-empty.

Expected:
- Payment `voidedAt` terisi (soft delete).
- Status diturunkan kembali otomatis (Paid → Partially Paid /
  Submitted to Principal).
- Tolak void setelah `Closed` (`CLAIM_PAYMENT_VOID_CLOSED`).

### C5. Outstanding report
1. Buka `/api/claim-workflow/outstanding`.

Expected:
- Hanya workflow dengan `remainingAmount > 0`.
- `totalPaid` = sum active payments (recalc fresh).
- Status legacy PEKA tidak boleh muncul di filter / output production.

---

## D. Close Workflow

### D1. Close success
1. POST `/api/claim-workflow/[id]/close` dengan `note` non-empty saat
   workflow `Paid` + 3 PDF + active payment ≥ 1.

Expected:
- Status → `Closed`, `closedAt`/`closedBy`/`closeNote` ter-set.
- Audit `claim_closed` ditulis dalam transaksi yang sama.
- Response berisi snapshot dari dalam transaksi (R6 — tidak ada
  re-fetch terpisah; pastikan response `workflow.status === "Closed"`
  dan totals match).

### D2. Close blockers
- Tolak kalau status != Paid (`CLAIM_CLOSE_NOT_PAID`).
- Tolak kalau ketiga PDF kurang (Letter / Summary / Receipt).
- Tolak kalau no_claim kosong.
- Tolak kalau active payment = 0.
- Tolak kalau totalPaid < totalClaim.
- Tolak `note` kosong (`CLAIM_CLOSE_NOTE_REQUIRED`).

### D3. No Claim locked after Close
1. Setelah Closed, PATCH `/api/claim-workflow/[id]/no-claim`.

Expected:
- 409 `NO_CLAIM_CLOSED_LOCKED`.

### D4. Race condition (No Claim vs Close)
- Race window kecil; manual: jalankan close + assign No Claim hampir
  bersamaan (bisa pakai dua tab). Pastikan salah satu menang dan yang
  lain return `NO_CLAIM_CLOSED_LOCKED` tanpa data inconsistency.
- Pengecekan status `Closed` dilakukan ulang di dalam transaksi update
  No Claim (bukan hanya pre-check).

---

## E. OFF ↔ Claim Boundary

### E1. OFF Completed butuh No Claim
1. OFF batch sudah Finance Paid + verification, Claim Workflow ada
   tetapi belum assign No Claim.
2. POST `/api/off-program-control/batches/[id]/final-claim` action
   `complete`.

Expected:
- 409 `OFF_FINAL_NO_CLAIM_REQUIRED`.

### E2. OFF Completed konsisten setelah race
1. (R6 hardening) Pre-check noClaim + sync sudah lulus, lalu sebelum
   commit OFF Completed seseorang me-reset `off_batch_item.noClaim`
   secara manual.

Expected:
- Transaksi rollback.
- Response 409 dengan code `OFF_FINAL_NO_CLAIM_RACE` atau
  `OFF_FINAL_NO_CLAIM_NOT_SYNCED_RACE`.
- Status OFF tidak berubah jadi `Completed`.

### E3. OFF status tidak tercemar Claim status
- `off_batch.status` harus salah satu dari OFF statuses (`Draft`,
  `Submitted to SM`, `Approved by SM`, `Claim Approved`, `OM Approved`,
  `Paid`, `Completed`, `Returned by SM`, `Returned by Claim`,
  `Returned to Finance`, `Cancelled by OM`).
- Tidak boleh berisi `Submitted to Principal` / `Partially Paid` /
  `Paid` (claim workflow) / `Closed`.

---

## F. RBAC Final Review

### F1. Read endpoints (claim_workflow.view atau admin/claim)
- `GET /api/claim-workflow` → list
- `GET /api/claim-workflow/[id]` → detail
- `GET /api/claim-workflow/outstanding`
- `GET /api/claim-workflow/reports/{summary,paid,outstanding}`
- `GET /api/claim-workflow/reports/{summary,paid,outstanding}/export`
- `GET /api/claim-workflow/[id]/audit` → admin/claim atau
  `claim_workflow.approve`

Expected:
- Role `staff` tanpa permission → 403.
- Role `claim` / `admin` → 200.
- Role lain dengan `claim_workflow.view` → 200 untuk read; tidak punya
  `claim_workflow.approve` → 403 untuk audit.

### F2. Write endpoints (admin/claim only, hard-coded)
- `POST /api/claim-workflow/from-off-batch/[offBatchId]`
- `PATCH /api/claim-workflow/[id]/no-claim`
- `PATCH /api/claim-workflow/[id]/items/[itemId]`
- `POST /api/claim-workflow/[id]/{summary,claim-letter,receipt}`
- `POST /api/claim-workflow/[id]/status`
- `POST /api/claim-workflow/[id]/payments`
- `POST /api/claim-workflow/[id]/payments/[paymentId]/void`
- `POST /api/claim-workflow/[id]/close`

Expected:
- Role lain (termasuk `staff` dengan `claim_workflow.view`) → 403 untuk
  write. Hanya `admin` / `claim` yang lulus.

---

## G. CSV / Report Polish

### G1. CSV escaping
1. Buat workflow dengan field yang berisi koma, double quote, newline
   (mis. `paymentNote = 'baris 1\nbaris 2, "kutipan"'`).
2. Export Paid CSV.

Expected:
- Cell terbungkus `"…"`.
- `"` di dalam value digandakan jadi `""`.
- `\n` tetap di dalam quoted cell, baris CSV tidak pecah.
- File mulai dengan UTF-8 BOM (`\uFEFF`).

### G2. Filename + headers
- `Content-Disposition: attachment; filename="claim-<name>-report-YYYYMMDD.csv"`.
- `Content-Type: text/csv; charset=utf-8`.
- `Cache-Control: no-store`.

### G3. Filters tidak crash
- Status invalid (mis. `?status=Waiting%20PEKA`) → return 0 rows
  (production reports tidak boleh menampilkan legacy).
- Date filter invalid (`?dateFrom=foo`) → diabaikan, tidak crash.

### G4. UI Reports `/claim-workflow/reports`
- Empty state, loading state, error state semua tampil wajar.
- Preview maksimal 200 baris; dataset lengkap hanya via Export CSV.
- Toggle `onlyOpen` (Summary) dan `includeVoided` (Paid) berfungsi.

---

## H. UI Polish (claim detail page)

### H1. Disabled states
- Tombol "Mark Ready" disabled jika ketiga PDF kurang / noClaim kosong /
  totalClaim 0 / item invalid.
- Tombol "Submit to Principal" disabled jika status != `Ready to Submit`.
- Tombol "Close" disabled jika `closeBlockers` non-empty (cek detail
  response `canClose === false` dan list blocker terlihat).
- Tombol "Void" disabled jika workflow `Closed`.

### H2. closeBlockers
- Detail GET `/api/claim-workflow/[id]` mengembalikan array
  `closeBlockers` dengan pesan user-friendly:
  - "Workflow belum berstatus Paid."
  - "No Claim belum diisi."
  - "Belum ada pembayaran aktif."
  - "Total Paid belum mencapai Total Claim."
  - "Outstanding belum 0."
  - "Claim Letter PDF belum dibuat."
  - "Summary PDF belum dibuat."
  - "Kwitansi Claim PDF belum dibuat."

---

## I. Audit Trail Spot Check

Setelah seluruh checklist B-D dijalankan, di Workflow ID yang sama:

```
SELECT action, from_status, to_status, actor_role, created_at
FROM claim_audit_log
WHERE claim_workflow_id = '<id>'
ORDER BY created_at ASC;
```

Expected sequence (minimal):
1. `create_from_off`
2. `update_item_tax` (n kali)
3. `no_claim_assigned`
4. `no_claim_synced_to_off`
5. `claim_letter_generated`
6. `claim_summary_generated`
7. `claim_receipt_generated`
8. `mark_ready`
9. `submit_to_principal`
10. `payment_created` + (opsional) `payment_status_recalculated`
11. `payment_created` (full) + `payment_status_recalculated` (→ Paid)
12. `claim_closed`

Audit `payment_voided` muncul kalau ada void.

Append-only: row audit lama tidak boleh di-update / di-delete.

---

## Sign-off

| Checklist | Status | Notes |
|-----------|--------|-------|
| A. Baseline validation | | |
| B. Claim end-to-end | | |
| C. Payment + outstanding | | |
| D. Close | | |
| E. OFF ↔ Claim boundary | | |
| F. RBAC | | |
| G. CSV / reports | | |
| H. UI polish | | |
| I. Audit trail | | |

QA dijalankan oleh: ___________________  Tanggal: __________
