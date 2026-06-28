"use client";
/*
 * Tujuan: Error boundary untuk seluruh segmen dashboard — tangkap render error tak terduga
 *   agar user dapat halaman rapi + tombol "Coba lagi", bukan white screen / stack trace bocor.
 * Caller: Next.js App Router otomatis membungkus children app/(dashboard)/layout.tsx.
 * Dependensi: react (useEffect untuk log ke console saja, tidak menampilkan stack ke UI).
 * Main Functions: DashboardError.
 * Side Effects: console.error(error) untuk diagnosa dev; tidak ada I/O.
 */
import { useEffect } from "react";

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // ponytail: log ke console untuk dev; JANGAN render error.message/stack ke UI (bisa bocor detail)
        console.error(error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-5xl">⚠️</div>
            <h2 className="text-xl font-bold text-white">Terjadi kesalahan saat memuat halaman</h2>
            <p className="max-w-md text-sm text-slate-400">
                Maaf, ada gangguan teknis. Coba muat ulang halaman. Jika tetap bermasalah, hubungi admin.
            </p>
            <button
                onClick={reset}
                className="mt-2 rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-amber-400"
            >
                Coba lagi
            </button>
        </div>
    );
}
