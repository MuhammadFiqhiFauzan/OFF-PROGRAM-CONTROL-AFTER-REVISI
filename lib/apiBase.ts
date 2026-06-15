/**
 * Resolusi base URL backend FastAPI dengan PENGAMAN dev.
 *
 * Tujuan: mencegah frontend lokal (localhost:3000) tanpa sengaja menembak
 * backend PRODUKSI. Insiden sebelumnya: cache Turbopack lama membakar IP
 * produksi (43.156.118.114:8000) ke bundle, sehingga upload/hapus dari
 * localhost masuk ke "web ori".
 *
 * Aturan:
 * - DEVELOPMENT (`next dev`): SELALU `http://localhost:8000`, tanpa syarat.
 *   Nilai NEXT_PUBLIC_FASTAPI_BASE_URL dan window.location diabaikan agar IP
 *   remote (mis. produksi) MUSTAHIL bocor ke dev — apa pun isi env/cache/host.
 * - PRODUCTION: pakai NEXT_PUBLIC_FASTAPI_BASE_URL bila di-set; jika kosong,
 *   turunkan dari host yang dibuka (protocol+hostname:8000) saat di browser,
 *   atau localhost saat SSR.
 *
 * Catatan: NODE_ENV & NEXT_PUBLIC_* di-inline saat build. Guard ini berlaku
 * berdasarkan mode build (`next dev` = development, `next build`/`start` =
 * production); tidak bisa di-override via env saat runtime.
 */
export function resolveApiBase(): string {
  const isDev = process.env.NODE_ENV !== "production";

  // Pengaman dev: kunci ke localhost, abaikan env & window sepenuhnya.
  if (isDev) {
    return "http://localhost:8000";
  }

  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return process.env.NEXT_PUBLIC_FASTAPI_BASE_URL || `${protocol}//${hostname}:8000`;
  }
  // SSR / build-time (production)
  return process.env.NEXT_PUBLIC_FASTAPI_BASE_URL || "http://localhost:8000";
}
