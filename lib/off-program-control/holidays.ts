/*
 * Tujuan: Daftar hari libur nasional Indonesia (tanggal merah) untuk perhitungan
 *         SLA "Pengajuan Bermasalah" berbasis HARI KERJA. Dipakai oleh
 *         lib/off-program-control/problematic.ts (businessDaysSince).
 * Caller: problematic.ts.
 * Dependensi: Tidak ada — murni data + fungsi string in-memory.
 *
 * PENTING — PEMELIHARAAN:
 * - Tanggal libur nasional & cuti bersama mengikuti SKB Pemerintah dan dapat
 *   berubah/bergeser tiap tahun (terutama hari raya berbasis kalender lunar).
 * - Perbarui daftar di bawah setiap awal tahun sesuai SKB resmi.
 * - Format wajib "YYYY-MM-DD" (zona waktu lokal). Tahun yang TIDAK terdaftar
 *   tetap aman: hanya Sabtu/Minggu yang dikecualikan untuk tahun tersebut.
 */

// Catatan: daftar 2025–2026 di bawah berdasarkan SKB/perkiraan dan WAJIB
// dikonfirmasi ulang dengan SKB resmi. Termasuk cuti bersama.
const NATIONAL_HOLIDAYS: readonly string[] = [
    // --- 2025 ---
    "2025-01-01", // Tahun Baru Masehi
    "2025-01-27", // Isra Mikraj (cuti bersama 28 Jan)
    "2025-01-28",
    "2025-01-29", // Tahun Baru Imlek
    "2025-03-28", // Cuti bersama Nyepi
    "2025-03-29", // Hari Raya Nyepi
    "2025-03-31", // Idul Fitri
    "2025-04-01", // Idul Fitri
    "2025-04-02", // Cuti bersama Idul Fitri
    "2025-04-03",
    "2025-04-04",
    "2025-04-07",
    "2025-04-18", // Wafat Isa Almasih
    "2025-04-20", // Paskah
    "2025-05-01", // Hari Buruh
    "2025-05-12", // Hari Raya Waisak
    "2025-05-13", // Cuti bersama Waisak
    "2025-05-29", // Kenaikan Isa Almasih
    "2025-05-30", // Cuti bersama
    "2025-06-01", // Hari Lahir Pancasila
    "2025-06-06", // Idul Adha
    "2025-06-09", // Cuti bersama Idul Adha
    "2025-06-27", // Tahun Baru Islam (1 Muharram)
    "2025-08-17", // Hari Kemerdekaan
    "2025-09-05", // Maulid Nabi
    "2025-12-25", // Hari Raya Natal
    "2025-12-26", // Cuti bersama Natal

    // --- 2026 (perkiraan — konfirmasi SKB) ---
    "2026-01-01", // Tahun Baru Masehi
    "2026-02-17", // Tahun Baru Imlek
    "2026-02-18", // Isra Mikraj (perkiraan)
    "2026-03-19", // Hari Raya Nyepi (perkiraan)
    "2026-03-20", // Idul Fitri (perkiraan)
    "2026-03-21",
    "2026-03-23",
    "2026-03-24",
    "2026-04-03", // Wafat Isa Almasih (perkiraan)
    "2026-05-01", // Hari Buruh
    "2026-05-14", // Kenaikan Isa Almasih (perkiraan)
    "2026-05-27", // Idul Adha (perkiraan)
    "2026-05-31", // Hari Raya Waisak (perkiraan)
    "2026-06-01", // Hari Lahir Pancasila
    "2026-06-16", // Tahun Baru Islam (perkiraan)
    "2026-08-17", // Hari Kemerdekaan
    "2026-08-25", // Maulid Nabi (perkiraan)
    "2026-12-25", // Hari Raya Natal
];

const HOLIDAY_SET: Set<string> = new Set(NATIONAL_HOLIDAYS);

/** Format Date -> "YYYY-MM-DD" memakai komponen tanggal LOKAL (bukan UTC). */
export function toLocalDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/** True bila tanggal adalah hari libur nasional/cuti bersama (tanggal merah). */
export function isNationalHoliday(date: Date): boolean {
    return HOLIDAY_SET.has(toLocalDateKey(date));
}

/** True bila Sabtu (6) atau Minggu (0). */
export function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
}

/** True bila hari kerja (bukan weekend dan bukan tanggal merah). */
export function isBusinessDay(date: Date): boolean {
    return !isWeekend(date) && !isNationalHoliday(date);
}
