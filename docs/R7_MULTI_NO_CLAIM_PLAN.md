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
| R7b   | API submission CRUD, item assignment, recalc submission totals, default submission tetap valid. | Pending  |
| R7c   | Generate Claim Letter / Summary / Kwitansi PDF per submission. PDF path workflow lama jadi pointer ke primary submission. | Pending  |
| R7d   | Payment + outstanding pindah ke level submission. `recalcPaymentTotals` per submission. Workflow totals di-derive. | Pending  |
| R7e   | Close per submission. Workflow `aggregate_status` derived. Reports basis berubah ke submission row. | Pending  |
| R7f   | Direct kwitansi / manual source. Butuh table rebuild SQLite (`off_batch_id` → nullable). **Deferred** sampai backup penuh + persetujuan bisnis. | Deferred |

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
