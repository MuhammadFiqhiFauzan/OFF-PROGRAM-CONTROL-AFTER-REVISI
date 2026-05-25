import type { ClaimAmountCalculation } from "./types";

function finiteAmount(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

/**
 * Hitung komponen DPP/PPN/PPh/Nilai Klaim per item.
 *
 * Strategi pembulatan:
 * - PPN dan PPh dibulatkan ke rupiah penuh terlebih dahulu agar konsisten
 *   dengan praktik faktur pajak Indonesia (no fractional rupiah).
 * - `nilaiKlaim = dpp + ppnAmount - pphAmount` dihitung dari nilai yang
 *   sudah dibulatkan, sehingga sum-of-items selalu konsisten dengan
 *   `totalDpp + totalPpn - totalPph` (tidak ada drift float).
 */
export function calculateClaimAmount(
    dpp: number,
    ppnRate: number,
    pphRate: number,
): ClaimAmountCalculation {
    const normalizedDpp = finiteAmount(dpp);
    const normalizedPpnRate = finiteAmount(ppnRate);
    const normalizedPphRate = finiteAmount(pphRate);
    const ppnAmount = Math.round(normalizedDpp * normalizedPpnRate / 100);
    const pphAmount = Math.round(normalizedDpp * normalizedPphRate / 100);

    return {
        dpp: normalizedDpp,
        ppnRate: normalizedPpnRate,
        ppnAmount,
        pphRate: normalizedPphRate,
        pphAmount,
        nilaiKlaim: normalizedDpp + ppnAmount - pphAmount,
    };
}

/**
 * Selisih antara totalClaim dan totalPaid. Tidak di-clamp ke 0 supaya
 * overpayment tetap terlihat sebagai nilai negatif (dapat ditampilkan
 * sebagai "Lebih Bayar" di UI atau memicu alert reconciliation).
 */
export function calculateRemainingAmount(totalClaim: number, totalPaid: number): number {
    return finiteAmount(totalClaim) - finiteAmount(totalPaid);
}
