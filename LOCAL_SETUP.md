# Setup Lokal AccAPI

Dokumen ini mencatat cara menjalankan AccAPI secara lokal di Windows (PowerShell), berdasarkan setup yang sudah berhasil dijalankan.

Aplikasi terdiri dari dua service:

- Frontend Next.js di port `3000`
- Backend FastAPI Python di port `8000`

## Prasyarat

- Node.js 20+ (sudah teruji dengan v24)
- Python 3.11+ (sudah teruji dengan 3.14.5)
- PowerShell

Kalau Python belum ada, install dari https://www.python.org/downloads/ dan centang **Add python.exe to PATH** saat installer berjalan.

## Setup Pertama Kali

Jalankan dari root project (`D:\KULYEAH\AccAPI-main - Copy`).

### 1. Install dependencies frontend

```powershell
npm install
```

### 2. Setup virtual environment + dependencies backend

```powershell
cd python_backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..
```

Catatan: pada mesin yang `python` masih mengarah ke stub Microsoft Store, gunakan `py` (Python launcher). Setelah venv aktif, semua perintah berikutnya pakai `.\.venv\Scripts\python.exe` atau aktifkan venv via `.\.venv\Scripts\Activate.ps1`.

### 3. Pastikan file `.env` ada

File `.env` sudah disiapkan di root project. Kalau belum, salin dari `.env.example`:

```powershell
Copy-Item .env.example .env
```

Nilai default `.env` sudah cukup untuk menjalankan lokal di `http://localhost:3000` dan `http://localhost:8000`. Jangan commit file ini.

### 4. Inisialisasi database SQLite

```powershell
node scripts/init-db.mjs
```

Output yang diharapkan: `SQLite tables are ready`. File `sqlite.db` akan dibuat di root project.

### 5. Akun login default

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

## Status Workflow Saat Ini

Flow OFF Program Control sudah lengkap dari Draft sampai Completed (7 step approval).

Flow Claim Workflow saat ini hanya mengimplementasikan transisi awal:

```
Draft -> Ready to Submit -> Submitted to Principal
```

Status berikutnya (`Waiting PEKA`, `EC Received`, `CN Received`, `Partially Paid`, `Paid`, `Closed`) belum diimplementasi di build saat ini. Tabel database-nya sudah disiapkan, tapi endpoint dan UI-nya masuk fase pengembangan berikutnya.

## Struktur Folder Penting

- `app/` - halaman dan API routes Next.js (App Router)
- `python_backend/` - service FastAPI (auth, payments, validator, SPPD generator)
- `lib/` - logic shared (claim-workflow, off-program-control, dll)
- `db/` - schema Drizzle ORM untuk SQLite
- `scripts/` - utility dev (init DB, seed user, reset data)
- `runtime/` - output runtime (PDF kwitansi, bukti pembayaran). Auto-dibuat saat dibutuhkan.
- `sqlite.db` - database SQLite lokal

File yang TIDAK di-commit (lihat `.gitignore`): `.env`, `node_modules/`, `.next/`, `python_backend/.venv/`, `runtime/`, `sqlite.db`.
