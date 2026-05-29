# R7 — Multi No Claim + Direct Claim Source Plan

Dokumen ini berisi rencana phased untuk R7. Phase R7a (sekarang) hanya
menambah schema + backfill compatibility. Tidak ada route, UI, atau
behavior existing yang berubah di R7a.

---

## Kenapa R7 ada

Asumsi lama menyatakan:

```
1 Claim Workflow = 1 No Claim
```

Real world ternyata berbeda:

1. Tidak semua data klaim berasal dari OFF Program Control. Ada yang
   masuk via kwitansi langsung / direct claim.
2. No Claim tidak selalu mengikuti No Pengajuan OFF.
3. Dalam satu pengajuan bisa ada beberapa No Claim.
4. No Claim dapat dibuat per pengajuan, per program, per toko, atau
   custom grouping manual.

Kesimpulan arsitektur:
- `claim_workflow` menjadi **container** umum untuk klaim.
- `claim_submission` menjadi entity baru yang menampung **satu No Claim**.
- Dokumen / payment / outstanding / close akan pindah bertahap ke level
  submission.

---

## Mapping konsep

| Konsep                         | Tabel                          |
|-------------------------------|--------------------------------|
| Container klaim (header)      | `claim_workflow`               |
| Satu No Claim utuh            | `claim_submission` (R7a)       |
| Item klaim (link item OFF)    | `claim_workflow_item` + `claim_submission_id` (R7a) |
| Payment principal             | `claim_payment` + `claim_submission_id` (R7a) |
| Audit                         | `claim_audit_log` + scope kolom (R7a) |
| OFF batch (sumber)            | `off_batch`, `off_batch_item`  |

`claim_workflow.noClaim` lama **dipertahankan** sebagai cache display
selama transisi. Source-of-truth pindah ke `claim_submission.noClaim`
mulai R7b ke depan.

---

## Phased plan

| Phase | Scope ringkas                                                             | Status   |
|-------|---------------------------------------------------------------------------|----------|
| R7a   | Schema additive: `claim_submission` table + kolom baru di workflow/item/payment/audit + backfill default submission. | DONE     |
| R7b   | API submission CRUD, item assignment, recalc submission totals, default submission tetap valid. | DONE     |
| R7c   | Generate Claim Letter / Summary / Kwitansi PDF per submission. PDF path workflow lama jadi pointer ke primary submission. | DONE     |
| R7d   | Payment + outstanding pindah ke level submission. `recalcPaymentTotals` per submission. Workflow totals di-derive. | Pending  |
| R7e   | Close per submission. Workflow `aggregate_status` derived. Reports basis berubah ke submission row. | Pending  |
| R7f   | Direct kwitansi / manual source. Butuh table rebuild SQLite (`off_batch_id` → nullable). **Deferred** sampai backup penuh + persetujuan bisnis. | Deferred |
| R7g   | Excel-style No Claim generator (pola Godrej `seq/SUPER-GCPI/MM/YYYY`) + scope `per_item` + endpoint `POST /[id]/submissions/from-items`. Tidak menyentuh schema; default month/year pakai zona `Asia/Makassar`. | DONE     |

Semua phase di atas additive. Tidak ada kolom dihapus / di-rename di
R7a-R7e. Tabel `claim_peka_report` / status PEKA tetap retired (lihat
`docs/CLAIM_WORKFLOW_AI_CONTEXT.md`).

---

## Schema R7a detail

### Tabel baru: `claim_submission`

Lihat `db/schema.ts` (`claimSubmission`) dan `scripts/init-db.mjs`
untuk DDL definitif. Highlights:

- `claim_workflow_id` FK NOT NULL — banyak submission per workflow.
- `no_claim` nullable. Partial unique index
  `idx_claim_submission_no_claim_unique` mencegah duplikasi global
  setelah di-assign.
- `scope` (default `per_pengajuan`) + `scope_label` mendokumentasikan
  cara grouping. Bukan untuk gating.
- Field totals/dokumen/close mirror `claim_workflow` agar future route
  per-submission bisa langsung dipakai.

### Kolom baru di tabel existing

- `claim_workflow.{source_type, source_ref_id, aggregate_status}` —
  metadata sumber + status agregat. Belum dipakai di R7a; siap untuk
  R7e/R7f.
- `claim_workflow_item.claim_submission_id` (nullable) — backfill
  dilakukan oleh migration. Validasi 1 item → 1 submission diberlakukan
  di app layer mulai R7b.
- `claim_payment.claim_submission_id` (nullable) — pointer redundant.
  `claim_workflow_id` tetap dipertahankan sebagai cache.
- `claim_audit_log.{claim_submission_id, audit_scope}` — untuk audit
  yang scope-nya satu submission. Audit existing R1-R6 dibiarkan NULL /
  `audit_scope = "workflow"`.

---

## Backfill / migration instructions

### Prasyarat

1. DB lokal sudah punya schema R7a (tabel + kolom baru). Jalankan:
   ```
   node scripts/init-db.mjs
   ```
   Script ini idempotent (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD
   COLUMN). Aman di-run berkali-kali.

2. **Backup `sqlite.db`** sebelum lanjut — bukan karena R7a destruktif
   (R7a tidak destruktif), tapi sebagai best practice migrasi data:
   ```
   Copy-Item sqlite.db "sqlite-backup-r7a-$(Get-Date -Format yyyyMMdd-HHmmss).db"
   ```

### Jalankan backfill

Pakai npm script (preferred):
```
npm run migrate:r7a-submissions
```

Atau langsung:
```
node scripts/migrate-r7a-default-submission.mjs
```

### Apa yang dilakukan migration

Untuk setiap row `claim_workflow` lama, script:

1. Cek apakah workflow sudah punya minimal 1 `claim_submission`. Jika
   ya, **skip** (idempotent).
2. Insert satu default submission dengan:
   - `noClaim` + assigned metadata diturunkan dari workflow.
   - `scope = "per_pengajuan"`, `scopeLabel = claimWorkflowNo` (atau
     `"Pengajuan utama"`).
   - Status, totals, paths dokumen, close metadata mirror workflow.
3. Update `claim_workflow_item.claim_submission_id` untuk semua item di
   workflow itu yang masih NULL.
4. Update `claim_payment.claim_submission_id` untuk semua payment di
   workflow itu yang masih NULL.
5. Set `claim_workflow.source_type = "off_program"`,
   `source_ref_id = off_batch_id`, `aggregate_status = status` jika
   kolom-kolom tersebut masih kosong.

Migrasi dijalankan dalam **satu transaksi**. Jika ada error (mis. unique
conflict pada `no_claim`), transaksi rollback total dan tidak ada
perubahan partial.

### Verifikasi sesudah backfill

Cek di SQLite:

```sql
-- Setiap workflow harus punya minimal 1 submission.
SELECT COUNT(*) AS workflows_without_submission
FROM claim_workflow w
LEFT JOIN claim_submission s ON s.claim_workflow_id = w.id
WHERE s.id IS NULL;

-- Semua item harus sudah ter-link.
SELECT COUNT(*) AS items_unlinked
FROM claim_workflow_item
WHERE claim_submission_id IS NULL;

-- Semua payment harus sudah ter-link.
SELECT COUNT(*) AS payments_unlinked
FROM claim_payment
WHERE claim_submission_id IS NULL;
```

Ketiga query harus return 0 setelah backfill sukses.

---

## Yang tidak berubah di R7a

- Route OFF Program Control: tetap memvalidasi `claim_workflow.noClaim`
  untuk OFF Completed.
- Route Claim Workflow: assign No Claim, generate dokumen, payment,
  close, outstanding, reports — semuanya tetap operate di level
  workflow. Tidak menyentuh tabel `claim_submission` di R7a.
- UI: tidak ada perubahan.
- PDF path / file: tidak dipindah.
- Audit lama (`claim_audit_log` workflow-scope) tidak diubah.

---

## Phase R7b — Submission grouping + item assignment (DONE)

R7b menambah **API CRUD submission** dan helper recalc, serta minimal
UI section di detail page. Behavior R1-R6 tetap dipertahankan.

### Endpoint baru

| Endpoint | Method | Akses | Keterangan |
|----------|--------|-------|------------|
| `/api/claim-workflow/[id]/submissions` | GET | `canActorReadClaimWorkflow` | List submission per workflow + itemCount per submission. |
| `/api/claim-workflow/[id]/submissions` | POST | admin/claim, workflow Draft / Need Revision | Buat submission baru dengan scope, scopeLabel, optional noClaim. |
| `/api/claim-workflow/[id]/submissions/[submissionId]` | GET | read access | Detail submission + items yang ditugaskan. |
| `/api/claim-workflow/[id]/submissions/[submissionId]` | PATCH | admin/claim | Update scope / scopeLabel / noClaim (dengan partial unique check + sync ke off_batch_item untuk item submission). |
| `/api/claim-workflow/[id]/submissions/[submissionId]/items` | POST | admin/claim, workflow Draft / Need Revision | Pindahkan satu atau lebih item ke submission target. Recalc totals submission lama + target + workflow aggregate. |

### Helper baru di `lib/claim-workflow/submissions.ts`

- `getWorkflowSubmissions(workflowId, executor?)` — list ordered.
- `getOrCreateDefaultSubmission(executor, workflow, now?)` — idempotent
  fallback untuk workflow lama yang belum di-backfill (juga link item
  + payment yang masih NULL).
- `recalcSubmissionTotals(executor, submissionId, now?)` — sum dari
  item ditugaskan, update totalDpp/Ppn/Pph/Claim + remainingAmount.
  totalPaid submission masih dipertahankan apa adanya (R7d).
- `recalcWorkflowAggregateFromSubmissions(executor, workflowId, now?)` —
  sum submissions ke cache `claim_workflow.totalDpp/Ppn/Pph/Claim` +
  `aggregate_status` mirror dari `status`. totalPaid + remainingAmount
  workflow tetap pakai formula R3 sampai R7d.
- `assertSubmissionBelongsToWorkflow(submissionId, workflowId, executor?)` —
  guard standard.
- `isSubmissionEditableWorkflowStatus(status)` — true untuk Draft /
  Need Revision.

### Behavior change kecil (terdokumentasi)

- `PATCH /api/claim-workflow/[id]/items/[itemId]` (edit pajak):
  - Setelah update item totals, helper `getOrCreateDefaultSubmission`
    dipanggil bila item belum punya `claim_submission_id`. Kemudian
    `recalcSubmissionTotals` + `recalcWorkflowAggregateFromSubmissions`
    dijalankan dalam transaksi yang sama.
  - Audit `update_item_tax` sekarang membawa `claim_submission_id` +
    `audit_scope = "submission"` bila terkait submission.

- `PATCH /api/claim-workflow/[id]/no-claim` (legacy route):
  - Bila workflow punya >1 submission → tolak `409` dengan code
    `MULTI_SUBMISSION_NO_CLAIM_ROUTE_DISABLED`. User wajib pakai
    endpoint submission-specific.
  - Bila workflow punya 1 submission → mirror nilai noClaim ke
    submission tersebut secara atomic.
  - Bila workflow belum punya submission (DB lokal lama belum
    di-backfill) → tetap menulis cache workflow saja.

- `GET /api/claim-workflow/[id]` (detail):
  - Response sekarang membawa `submissions[]`, `submissionCount`,
    `hasMultipleSubmissions`, `noClaimList[]`, dan `noClaimDisplay`.
  - Field workflow lama (`noClaim`, totals, PDF paths, payment)
    tidak berubah.

### UI

- Detail page menambah section **Claim Submissions / No Claim Groups**
  read-only table + form create submission untuk admin/claim saat
  Draft / Need Revision. Kolom **Submission** ditambahkan di tabel
  item dengan dropdown untuk memindahkan item antar submission saat
  workflow editable dan ada >1 submission.
- Banner peringatan: dokumen klaim dan pembayaran principal masih
  berjalan di workflow-level sampai R7c/R7d.

---

## Phase R7c — Documents per submission (DONE)

R7c memindahkan generator Claim Letter / Summary / Kwitansi ke level
submission. Cache workflow tetap dipertahankan untuk Mark Ready / Close
gate (akan dipindah di R7d/R7e).

### Endpoint baru

| Endpoint | Method | Akses | Keterangan |
|----------|--------|-------|------------|
| `/api/claim-workflow/[id]/submissions/[submissionId]/claim-letter` | POST | admin/claim | Generate Claim Letter PDF per submission. Items difilter `claim_submission_id`. |
| `/api/claim-workflow/[id]/submissions/[submissionId]/claim-letter` | GET | read access | Stream PDF dari `claim_submission.claimLetterPdfPath`. |
| `/api/claim-workflow/[id]/submissions/[submissionId]/summary` | POST/GET | admin/claim / read access | Sama untuk Summary. |
| `/api/claim-workflow/[id]/submissions/[submissionId]/receipt` | POST/GET | admin/claim / read access | Sama untuk Kwitansi. |

### Path layout

```
runtime/claim-workflow/
  {workflowId}/submissions/{submissionId}/letter/{slug}-letter-{ts}.pdf
                                          /summary/{slug}-summary-{ts}.pdf
                                          /receipt/{slug}-receipt-{ts}.pdf
  letters/                ← LEGACY workflow-level (pra-R7c)
  summaries/              ← LEGACY workflow-level
  receipts/               ← LEGACY workflow-level
```

- Folder utama submission selalu pakai `submissionId` (immutable).
- `slug` di-derive dari `slugifyNoClaim(noClaim)`. Bila noClaim NULL/
  empty, fallback ke `submissionId`.
- Path validator umum `isPathInsideClaimDocumentRoot` menerima legacy
  dir maupun submission tree.

### Helper baru di `lib/claim-workflow/document-paths.ts`

- `CLAIM_DOCUMENT_ROOT_DIR`, `LEGACY_DOCUMENT_DIRS`.
- `getSubmissionDocumentDir(workflowId, submissionId, type)`.
- `slugifyNoClaim(value)`.
- `formatDocumentTimestamp(date)`.
- `buildSubmissionDocumentFilePath({ workflowId, submissionId, type, noClaim, generatedAt })`.
- `isPathInsideClaimDocumentRoot(path)`.
- `isPathInsideLegacyDir(path, type)`.
- `isPathInsideSubmissionDocumentDir({ workflowId, submissionId, type, targetPath })`.

### Constants baru di `lib/claim-workflow/constants.ts`

- `claimDocumentTypes = { letter, summary, receipt }`.
- `claimDocumentTypeList`, `isClaimDocumentType`, `ClaimDocumentType`.

### PDF generator signature change

`generateClaimLetterPdf(workflow, items, generatedAt, options?)`,
`generateClaimSummaryPdf(workflow, items, generatedAt, options?)`,
`generateClaimReceiptPdf(workflow, items, generatedAt, options?)` —
`options.submission?: ClaimSubmissionRow | null`.

- Bila submission disuplai: header PDF override `noClaim` + totals
  pakai data submission. Items WAJIB sudah difilter caller. File path
  ditulis di submission tree.
- Tanpa submission: legacy workflow-level path + header workflow.

### Behavior change kecil

- `POST /[id]/{claim-letter,summary,receipt}` (legacy):
  - Multi-submission → 409 `MULTI_SUBMISSION_LETTER_ROUTE_DISABLED` /
    `..._SUMMARY_..._DISABLED` / `..._RECEIPT_..._DISABLED`.
  - Single submission → tulis cache workflow + mirror ke submission
    tunggal (atomic) supaya kedua source-of-truth konsisten.
  - Workflow tanpa submission → tulis cache workflow saja (audit pakai
    `audit_scope = "workflow"`).
- `POST /[id]/status` `return_to_draft`:
  - Tetap invalidate 3 PDF cache workflow.
  - **R7c**: juga loop semua submission → reset 3 path PDF + unlink
    file di submission tree (best-effort).
  - Audit metadata `invalidatedSubmissionPdfPaths` mencantumkan
    `{submissionId, type, path}` per file yang di-invalidate.

### Audit

Audit action tetap sama (`claim_letter_generated`, `claim_summary_generated`,
`claim_receipt_generated`). Metadata baru: `workflowId`, `submissionId`,
`noClaim`, `itemCount`, `totalClaim`, `documentType`, `filePath`,
`workflowMirror` (saat lewat route legacy), `viaLegacyWorkflowRoute`.

### UI

Detail page section "Claim Submissions / No Claim Groups" sekarang
menampilkan **3 chip per submission**: Letter / Summary / Kwitansi.
Setiap chip:
- Link "PDF" hijau bila path tersedia (download via endpoint per submission).
- Tombol "Gen / Re" indigo untuk generate / regenerate (admin/claim,
  workflow editable, items > 0, totalClaim > 0).

Banner amber di section "Dokumen Klaim" workflow-level mengingatkan user
bila workflow multi-submission.

### Yang BELUM diubah

- Mark Ready gate (workflow cache).
- Close gate (workflow cache).
- Reports / Outstanding (workflow basis).
- OFF Program Control PDF (terpisah total).

---

## R7f deferred — direct kwitansi / manual

- `claim_workflow.off_batch_id` saat ini `NOT NULL UNIQUE`. SQLite
  tidak punya `ALTER COLUMN DROP NOT NULL` — perubahannya butuh table
  rebuild (CREATE NEW + COPY + RENAME).
- R7f akan dijalankan terpisah dengan **backup penuh** SQLite + verifikasi
  row count sebelum/sesudah.
- Sebelum R7f, direct kwitansi/manual claim **belum didukung** oleh
  schema. Jangan mencoba membuat workflow tanpa OFF batch sampai R7f
  selesai.

---

## Phase R7g — Excel-style No Claim Generator + Per Item Package (DONE)

R7g membawa pola No Claim sheet BASE Godrej ke web tanpa menyentuh
schema. Tidak ada migration baru. Source-of-truth tetap
`claim_submission.noClaim`.

### Pola No Claim

```
{sequence}/{distributorCode}-{principalCode}/{MM}/{YYYY}
```

Contoh: `01/SUPER-GCPI/02/2026`, `130/SUPER-GCPI/04/2026`.

Aturan formatting sequence di UI:
- Trim spasi.
- Numeric `1`-`9` → pad menjadi 2 digit (`01`-`09`).
- Numeric `10` ke atas dipertahankan apa adanya (tidak dipaksa 3 digit).
- String non-numeric dibiarkan apa adanya.

Default principal code untuk Godrej: `GCPI` (helper `guessPrincipalCode`
mendeteksi kata "godrej" / "gcpi" di `workflow.principleName`, fallback
tetap `GCPI`).

### Default Bulan/Tahun — Asia/Makassar

Helper `getMakassarDateParts(date = new Date())` mengembalikan
`{ year, month, day }` (4/2/2 digit) memakai
`Intl.DateTimeFormat` dengan `timeZone: "Asia/Makassar"`. Default
generator memakai bulan/tahun Makassar saat user pertama kali masuk
mode "Generate dari Excel".

User tetap bebas mengganti bulan/tahun setelahnya. Helper hanya untuk
default, bukan untuk memaksa data lama berubah.

### UI Generator (per submission)

- Editor No Claim per paket sekarang punya toggle:
  - **Input Manual** (default) — perilaku lama.
  - **Generate dari Excel** — form 5 field (Nomor Urut, Kode Distributor,
    Kode Principal, Bulan, Tahun) + preview live + tombol "Gunakan No
    Claim Ini" yang menyalin preview ke draft input manual. User tetap
    klik **Save** memakai handler PATCH submission existing — tidak ada
    auto-save.
- Validasi client-side: sequence wajib, distributor wajib, principal
  wajib, bulan format `^\d{2}$` dan range 01-12, tahun format `^\d{4}$`.
  Validasi backend tetap lewat PATCH submission (no_claim non-empty,
  unique).

### Scope Baru: `per_item`

- Konstanta: `claimSubmissionScopes.perItem = "per_item"`.
- Label UI: **"Per Baris / Item"**.
- Helper text:
  > Satu item/baris klaim menjadi satu Paket No Claim. Ini paling mirip
  > sheet BASE di Excel.
- Scope ini hanya nilai string; tidak ada perubahan schema. Semua aturan
  R7b–R7e (CRUD, dokumen, payment, close, reports) berjalan sama untuk
  scope ini.

### Endpoint Baru: Buat Paket per Item

```
POST /api/claim-workflow/[id]/submissions/from-items
```

Body:

```json
{ "mode": "all_unassigned" | "all_items" }
```

- Default mode: `all_unassigned` (UI memakai ini).
- Akses: admin/claim only. Workflow harus berstatus `Draft` atau
  `Need Revision`. Workflow `Closed` ditolak (`CLAIM_SUBMISSION_WORKFLOW_CLOSED`).
- Behavior:
  1. Ambil semua `claim_workflow_item` untuk workflow.
  2. Skip item yang sudah berada di submission scope `per_item` (untuk
     kedua mode di R7g — idempotent guarantee).
  3. Untuk setiap target item:
     - Insert `claim_submission` dengan `scope = per_item`,
       `noClaim = null`, `scopeLabel` di-derive dari item (prioritas:
       `outlet` → `jenisPromosi` → `periode` → `noSurat` → fallback
       `Item Klaim {short id}`).
     - Update `claim_workflow_item.claim_submission_id` ke submission
       baru.
     - Recalc totals submission baru via `recalcSubmissionTotals`.
  4. Recalc totals submission lama yang ditinggalkan.
  5. Recalc workflow aggregate via `recalcWorkflowAggregateFromSubmissions`.
  6. Audit `claim_submissions_created_per_item` dengan metadata
     `mode`, `createdCount`, `createdSubmissionIds`, `affectedItemIds`,
     `previousSubmissionIds`, `workflowAggregate`.
- Return: `{ ok, createdCount, skippedCount, createdSubmissionIds,
  affectedItemIds }`.
- **Tidak** auto-generate No Claim. User mengisi belakangan via
  generator/manual editor.
- Submission lama (mis. `per_pengajuan` default) **tidak** dihapus
  walau tertinggal kosong — preserve audit history.

### UI Action

Card "Buat Paket per Baris / Item" tampil di section Paket No Claim
(hanya saat `canEditItems` + workflow editable). Tombol memanggil
endpoint di atas dengan `mode = all_unassigned`. Toast sukses:
"{N} paket per item dibuat." atau "Semua item sudah memiliki paket."
saat `createdCount = 0`.

### Test

`scripts/test-r7g-excel-no-claim.mjs` — 36 assertion:

- Helper `getMakassarDateParts` (year/month/day format + fixed instant
  2026-02-15 UTC = 2026-02-15 WITA).
- Generator formatting (sequence 1/9/10/130 + month/year).
- Validasi (empty sequence, month 13, month abc, year 26, missing
  distributor, valid draft).
- Endpoint `from-items` (2 item → 2 paket per_item, totals benar,
  workflow aggregate benar, idempotent rerun → 0 baru, workflow kosong
  → 0 baru).

Cleanup memakai prefix `R7G-TEST-`.

### Yang TIDAK diubah

- Schema database (tidak ada ALTER/DROP/RENAME).
- Payment / outstanding / close / reports behavior.
- Dokumen behavior R7c.
- Source-of-truth `claim_submission.noClaim` (tetap).
- `claim_workflow.noClaim` legacy/cache untuk single-submission.
- PEKA / EC / CN tetap retired.
- R7f direct/manual source masih deferred.

---

## No PEKA — tetap retired

R7 tidak mengembalikan PEKA / PVT / EC / CN. Status legacy tersebut
hanya boleh muncul sebagai fallback display di UI lama (`isLegacyPekaStatus`,
`displayClaimStatusLabel`) untuk row DB yang masih menyimpannya.

---

## Referensi file

- `db/schema.ts` — definisi `claimSubmission` + kolom baru.
- `scripts/init-db.mjs` — DDL schema + ALTER tables.
- `scripts/migrate-r7a-default-submission.mjs` — backfill.
- `scripts/reset-data.mjs` — cleanup order termasuk `claim_submission`.
- `lib/claim-workflow/constants.ts` — `claimSubmissionScopes`,
  `claimSubmissionStatuses`, `claimWorkflowSourceTypes`,
  `claimAuditScopes`.
- `lib/claim-workflow/types.ts` — `ClaimSubmissionRow`.
- `lib/claim-workflow/submissions.ts` — pure helper
  `buildDefaultSubmissionFromWorkflow`.
- `lib/claim-workflow/index.ts` — re-export.
