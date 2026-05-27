# Setup Lokal AccAPI

Dokumen ini mencatat cara menjalankan AccAPI secara lokal di Windows (PowerShell), berdasarkan setup yang sudah berhasil dijalankan.

Aplikasi terdiri dari dua service:

- Frontend Next.js di port `3000`
- Backend FastAPI Python di port `8000`

## Prasyarat

- **Node.js 20 LTS atau lebih baru** direkomendasikan untuk stabilitas. Node 24 sudah teruji jalan, tapi bukan rekomendasi paling aman karena masih relatif baru.
- **Python 3.11 atau 3.12** direkomendasikan untuk stabilitas dependency. Versi yang lebih baru (3.13/3.14) boleh dipakai selama semua paket di `requirements.txt` berhasil di-install.
- PowerShell

Kalau Python belum ada, install dari https://www.python.org/downloads/ dan centang **Add python.exe to PATH** saat installer berjalan.

## Setup Pertama Kali

Jalankan dari root project (`D:\KULYEAH\AccAPI-main - Copy`).

### 1. Buka folder project

Sebelum menjalankan perintah apapun, pastikan PowerShell sudah berada di root project. Path yang diharapkan: `D:\KULYEAH\AccAPI-main - Copy`.

```powershell
cd "D:\KULYEAH\AccAPI-main - Copy"
Get-Location
```

`Get-Location` harus menampilkan path di atas. Semua step berikutnya berasumsi posisi shell ada di sini.

### 2. Install dependencies frontend

```powershell
npm install
```

### 3. Setup virtual environment + dependencies backend

```powershell
cd python_backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..
```

Catatan: pada mesin yang `python` masih mengarah ke stub Microsoft Store, gunakan `py` (Python launcher). Setelah venv aktif, semua perintah berikutnya pakai `.\.venv\Scripts\python.exe` atau aktifkan venv via `.\.venv\Scripts\Activate.ps1`.

### 4. Pastikan file `.env` ada

File `.env` sudah disiapkan di root project. Kalau belum, salin dari `.env.example`:

```powershell
Copy-Item .env.example .env
```

Nilai default `.env` sudah cukup untuk menjalankan lokal di `http://localhost:3000` dan `http://localhost:8000`. Jangan commit file ini.

### 5. Inisialisasi database SQLite

```powershell
node scripts/init-db.mjs
```

Output yang diharapkan: `SQLite tables are ready`. File `sqlite.db` akan dibuat di root project.

### 6. Verifikasi build & script

Setelah database dibuat, pastikan TypeScript dan script init tidak punya error:

```powershell
npm.cmd exec tsc -- --noEmit --pretty false
node --check scripts/init-db.mjs
```

`tsc --noEmit` harus selesai tanpa diagnostic apapun (tidak ada output error). `node --check` mem-validasi syntax script init-db tanpa menjalankannya. Kalau salah satu gagal, fix dulu sebelum lanjut ke seed.

### 7. Akun login default

Database sudah pre-seeded dengan akun lokal (lihat `scripts/temp-seed-admin.mjs`). Kalau database masih kosong, jalankan:

```powershell
node scripts/temp-seed-admin.mjs
```

Kredensial yang dibuat:

| Role | Email | Password |
|------|-------|----------|
| admin | `admin@local.test` | `Password123!` |
| claim | `claim@local.test` | `Password123!` |
| staff | `staff@local.test` | `Password123!` |

### 8. (Opsional) Seed demo data UI

Untuk mengisi seluruh stage OFF Program Control dan Claim Workflow dengan data
contoh supaya UI bisa langsung diuji per status (Claim Letter PDF, Summary,
Kwitansi Claim, dan claim payment), jalankan:

```powershell
node scripts/seed-demo-workflows.mjs
# atau
npm run seed:demo
```

Detail skenario, prefix, dan langkah verifikasi UI ada di
[`docs/DEMO_DATA.md`](./docs/DEMO_DATA.md). Seed ini local-only dan idempotent.

## Menjalankan Aplikasi

Butuh dua terminal PowerShell terpisah.

### Terminal 1: Backend FastAPI

```powershell
cd python_backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Backend siap saat muncul `Uvicorn running on http://127.0.0.1:8000`.

### Terminal 2: Frontend Next.js

```powershell
npm run dev
```

Frontend siap saat muncul `Ready in ...ms`.

## Akses Aplikasi

- Frontend (UI utama): http://localhost:3000
- Login page: http://localhost:3000/login
- Backend API docs (Swagger): http://localhost:8000/docs

Login pakai salah satu akun di tabel di atas. Halaman utama akan redirect ke `/login` saat belum ada session.

## Cek Status Service

```powershell
Get-NetTCPConnection -LocalPort 3000,8000 -State Listen | Select-Object LocalPort, State, OwningProcess
```

Dua-duanya harus muncul dengan state `Listen`.

## Stop Service

```powershell
Get-NetTCPConnection -LocalPort 3000,8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Reset Data (Opsional)

Kalau perlu mengosongkan data transaksional (OFF batch, Claim Workflow, audit log) tanpa menghapus akun login:

```powershell
node scripts/reset-data.mjs
```

Script ini hanya jalan untuk database lokal (DATABASE_URL `file:sqlite.db`).

## Status Workflow Saat Ini

### OFF Program Control

Flow lengkap dari **Draft sampai Completed** (7 step approval) sudah diimplementasi.

### Claim Workflow (current implemented flow)

```
OFF OM Approved
  -> Create Claim Workflow
  -> Draft / Need Revision
  -> Edit DPP / PPN / PPH (BASE)
  -> Assign No Claim (sync ke OFF item)
  -> Generate Claim Letter PDF
  -> Generate Claim Summary PDF
  -> Generate Kwitansi Claim PDF
  -> Mark Ready (Ready to Submit)
  -> Submit to Principal
```

Pembayaran dari principal (Partially Paid → Paid → Closed) dan dashboard
Outstanding masuk roadmap berikutnya (R3 Principal Payment + Outstanding,
R4 Close Workflow).

### Cleanup PEKA / EC / CN

Workflow lama yang sempat memiliki tahap `Waiting PEKA`, `EC Received`,
`CN Received`, beserta import REPORT PEKA / matching EC-CN sudah **retired**
dari core production. Aplikasi tidak lagi:

- Mengimpor file PEKA atau menampilkan "Load PEKA Matches".
- Mensyaratkan EC/CN sebagai gate `Mark Ready`, payment, outstanding,
  atau close.
- Menampilkan tombol transisi `Waiting PEKA` / `EC Received` /
  `CN Received`.

Database lokal lama yang masih punya tabel `claim_peka_report` atau kolom
`ec_peka` / `cn_number` di `claim_workflow_item` tetap aman: aplikasi
tidak lagi membaca/menulis ke sana. Untuk DB bersih, reset:

```powershell
node scripts/reset-data.mjs
node scripts/init-db.mjs
npm run seed:demo
```

### Roadmap berikutnya

- **R3** — Principal Payment + Outstanding (input pembayaran dari
  principal lewat `claim_payment`, dashboard Monitor Outstanding). ✅
  Implemented.
- **R4** — Close Workflow (transisi `Paid` → `Closed`, gate
  `remainingAmount = 0` + dokumen lengkap + active payment + note). ✅
  Implemented via `POST /api/claim-workflow/[id]/close`.
- **R5 (next)** — Reporting / Export.
- **R6** — Hardening.

## Struktur Folder Penting

- `app/` - halaman dan API routes Next.js (App Router)
- `python_backend/` - service FastAPI (auth, payments, validator, SPPD generator)
- `lib/` - logic shared (claim-workflow, off-program-control, dll)
- `db/` - schema Drizzle ORM untuk SQLite
- `scripts/` - utility dev (init DB, seed user, reset data)
- `runtime/` - output runtime (PDF kwitansi, bukti pembayaran). Auto-dibuat saat dibutuhkan.
- `runtime/claim-workflow/letters` - output PDF Surat Claim dari Claim Workflow
- `sqlite.db` - database SQLite lokal

File yang TIDAK di-commit (lihat `.gitignore`): `.env`, `node_modules/`, `.next/`, `python_backend/.venv/`, `runtime/`, `sqlite.db`.

## Checklist Tes Lokal

Setelah backend & frontend running, jalankan checklist berikut untuk memastikan flow Claim Workflow utuh:

- [ ] Login sebagai **admin** (`admin@local.test`)
- [ ] Buat atau cek satu OFF Program Control yang sudah berstatus **Completed**
- [ ] Dari OFF Completed tersebut, **Create Claim Workflow**
- [ ] Pada status **Draft**, edit nilai **DPP / PPN / PPH**
- [ ] Mark claim workflow sebagai **Ready to Submit**
- [ ] Konfirmasi field tax (DPP / PPN / PPH) sudah **terkunci** (tidak bisa diedit lagi setelah Ready)
- [ ] **Generate Claim Letter PDF**
- [ ] Buka PDF dan pastikan isinya sesuai
- [ ] **Submit to Principal** (transisi ke Submitted to Principal)
- [ ] Logout, login sebagai **staff** (`staff@local.test`), dan konfirmasi staff TIDAK bisa create / edit / generate PDF / melakukan transisi pada Claim Workflow

## Troubleshooting

### Port 3000 sudah dipakai

```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Stop-Process -Id <PID> -Force
```

### Turbopack panic / Unexpected type in cell

Hapus cache Turbopack lalu start ulang:

```powershell
Remove-Item -Recurse -Force .next
npm run dev
```

### `python` not found / mengarah ke Microsoft Store stub

Pakai `py` sebagai pengganti, atau aktifkan venv terlebih dahulu (`.\.venv\Scripts\Activate.ps1`) supaya `python` di-resolve ke binary venv.

### Login error 403 dengan pesan `MISSING_OR_NULL_ORIGIN`

Ini terjadi kalau memanggil endpoint Better Auth tanpa header `Origin`. Saat login lewat browser ini tidak terjadi. Saat login lewat script (curl/Invoke-RestMethod), tambahkan header `Origin: http://localhost:3000`.

### Bootstrap admin returns 409 Conflict

Endpoint `/api/admin/bootstrap` hanya jalan saat tabel `user` masih kosong. Karena database sudah pre-seeded dengan akun lokal, langsung pakai akun di atas saja. Untuk mengganti password manual, edit script `scripts/temp-seed-admin.mjs` lalu jalankan ulang.

### Tombol "Generate Claim Letter PDF" tidak muncul

Tombol generate hanya tampil kalau dua syarat terpenuhi:

- **Role** user harus `admin` atau `claim` (staff tidak bisa generate).
- **Status** claim workflow ada di `Draft`, `Need Revision`,
  `Ready to Submit`, atau `Submitted to Principal`. Aturan yang sama
  berlaku untuk Claim Summary dan Kwitansi Claim.

Kalau tombol tidak muncul padahal role & status sudah benar, refresh halaman supaya state claim workflow ter-fetch ulang.

### Claim Letter PDF mengembalikan 404

Endpoint download PDF butuh file fisik di disk dan path-nya tercatat di metadata claim workflow. Kalau dapat 404:

1. Pastikan PDF sudah di-**generate** dulu (klik tombol Generate, jangan langsung Download).
2. Cek folder `runtime/claim-workflow/letters` di root project. File PDF harus ada di sana.
3. Cek metadata claim workflow di database, field `claim_letter_pdf_path` harus terisi dengan path relatif ke file PDF tersebut.

Kalau file ada tapi metadata kosong (atau sebaliknya), generate ulang PDF supaya keduanya sinkron.
