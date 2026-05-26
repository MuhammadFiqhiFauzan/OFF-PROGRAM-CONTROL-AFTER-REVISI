# Demo Data Lokal — OFF Program Control & Claim Workflow

Dokumen ini menjelaskan seed data demo lokal untuk menguji UI dashboard
OFF Program Control dan Claim Workflow tanpa perlu menjalankan flow approval
dari awal.

> **Local-only.** Seed script HANYA boleh dijalankan terhadap database
> SQLite lokal (`file:sqlite.db`). Jangan jalankan terhadap database
> produksi/staging.

---

## Tujuan

- Mengisi seluruh stage OFF (Draft → Submitted to SM → Approved by SM →
  Returned by SM/Claim → Claim Approved → Cancelled by OM → OM Approved →
  Partial Paid → Paid → Completed) dengan batch contoh.
- Mengisi seluruh status Claim Workflow yang sudah didefinisikan di
  `lib/claim-workflow/constants.ts`: Draft, Need Revision, Ready to Submit,
  Submitted to Principal, Waiting PEKA, EC Received, CN Received,
  Partially Paid, Paid, Closed.
- Membuat file Claim Letter PDF aktual di
  `runtime/claim-workflow/letters/` untuk Claim Workflow yang seharusnya
  punya PDF (Ready to Submit dan setelahnya).
- Mengisi `claim_peka_report` dengan 5 skenario matching agar PEKA
  Preview UI dapat diuji.

---

## Cara Menjalankan

```powershell
node scripts/seed-demo-workflows.mjs
# atau
npm run seed:demo
```

Script akan:

1. Memverifikasi `DATABASE_URL` adalah SQLite lokal. Kalau bukan, abort
   dengan exit code 2.
2. Membersihkan demo lama berdasarkan prefix (idempotent — bisa
   di-rerun berapa kali pun).
3. Insert OFF batches per status.
4. Insert Claim Workflow records.
5. Insert PEKA rows.
6. Generate Claim Letter PDF demo (kalau `pdf-lib` tersedia).

---

## Demo Prefix

Semua data demo memakai prefix yang jelas supaya mudah dibedakan dari
data nyata:

| Prefix          | Dipakai di                                        |
|-----------------|---------------------------------------------------|
| `DEMO-OFF-`     | `off_batch.no_pengajuan`                          |
| `DEMO-CLAIM-`   | `claim_workflow.claim_workflow_no` dan `noSurat`  |
| `DEMO-PEKA-`    | `claim_peka_report.source_file` & `claim_no`      |
| `DEMO-PAYMENT-` | catatan di `claim_payment.payment_note`           |
| `DEMO-EC-` / `DEMO-CN-` | demo EC/CN value pada Claim Workflow item |

---

## Status yang Dicover

### OFF Program Control

`Draft`, `Submitted to SM`, `Returned by SM`, `Approved by SM`,
`Returned by Claim`, `Claim Approved`, `Cancelled by OM`, `OM Approved`,
`Partial Paid`, `Paid`, `Completed`.

### Claim Workflow

`Draft`, `Need Revision`, `Ready to Submit`, `Submitted to Principal`,
`Waiting PEKA`, `EC Received`, `CN Received`, `Partially Paid`, `Paid`,
`Closed`.

> Status di luar `lib/claim-workflow/constants.ts` di-skip dengan log
> warning. Saat ini semua di atas sudah terdaftar di constants, jadi
> tidak ada yang di-skip.

### PEKA Preview Skenario

| Skenario          | Penjelasan                                                                  |
|-------------------|----------------------------------------------------------------------------|
| `matched`         | 1 PEKA row cocok 1 Claim Workflow item (EC + CN terisi).                   |
| `unmatched`       | PEKA row dengan No Surat yang tidak ada di item klaim mana pun.            |
| `duplicate_match` | 2 PEKA rows dengan No Surat sama → preview menampilkan duplicate warning.  |
| `CN missing`      | EC ada, CN kosong; matched ke item kedua claim Submitted to Principal.     |
| `Pending`         | `pendingUser` + `leadTime` + `age` terisi pada PEKA row.                   |

---

## Verifikasi UI

Setelah seed selesai:

1. Buka `/off-program-control` — daftar batch demo per status muncul.
2. Buka `/claim-workflow` — daftar Claim Workflow demo per status muncul,
   plus panel PEKA Manual Import (visible kalau login sebagai admin/claim).
3. Klik salah satu Claim Workflow → buka detail page → klik
   **Load PEKA Matches**. Pastikan:
   - Item dari Submitted to Principal demo menampilkan status `Matched`
     dengan EC `DEMO-EC-MATCHED-001` dan CN `DEMO-CN-MATCHED-001`.
   - Item dari Waiting PEKA demo menampilkan status `Duplicate (2)` dengan
     warning "perlu review manual sebelum apply".
   - Item lain (atau workflow yang tidak punya PEKA) menampilkan
     `Belum cocok`.
4. Untuk Claim Workflow yang punya PDF (Ready to Submit dan setelahnya),
   tombol **Open Claim Letter PDF** membuka file di `runtime/claim-workflow/letters/`.

---

## Catatan Penting

- Seed **TIDAK** menulis `ec_peka` / `cn_number` ke `claim_workflow_item`
  untuk Phase 3A. Field tersebut hanya diisi pada simulasi status lanjutan
  (EC Received dan setelahnya) untuk display read-only — bukan hasil dari
  apply EC/CN dari PEKA preview.
- Seed **TIDAK** mengubah API/UI route. Hanya mengisi data tabel.
- Audit log demo ditandai dengan metadata `{"demo": true}` sehingga
  mudah disaring saat audit reporting nanti.
- File PDF di `runtime/claim-workflow/letters/` mengandung label "DEMO"
  yang jelas dan keterangan bahwa ini bukan dokumen klaim sebenarnya.
- `runtime/` sudah di-`.gitignore`, jadi PDF demo tidak akan ikut commit.
- `sqlite.db` juga di-`.gitignore`. Jangan commit `sqlite.db` atau
  `webhook_events.log*`.

## Re-run / Cleanup

Karena seed idempotent, jalankan ulang `npm run seed:demo` kapan pun
untuk reset demo data ke kondisi awal. Untuk hapus semua demo tanpa
re-seed, jalankan ulang script lalu skip step insert dengan cara
manual — atau gunakan `node scripts/reset-data.mjs` untuk reset
full data transaksional (akan hapus data nyata juga, hati-hati).

## Peringatan

- Jangan jalankan terhadap database produksi. Script akan refuse jika
  `DATABASE_URL` mengarah ke `/app/...` (path container produksi
  default).
- Jangan commit `sqlite.db`, `runtime/`, `webhook_events.log*`, atau
  PDF demo ke repo. `.gitignore` sudah mencakup semua ini.
