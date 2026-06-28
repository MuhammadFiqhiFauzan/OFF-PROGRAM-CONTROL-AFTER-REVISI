import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/*
 * Tujuan: Pesan "Akses ditolak" eksplisit pengganti redirect senyap ke "/".
 * Caller: app/(dashboard)/layout.tsx (guard path), admin/groups & admin/users (guard permission).
 * Dependensi: next/link, lucide-react.
 */
export default function AccessDenied({
    message = "Anda tidak memiliki izin untuk membuka halaman ini.",
}: {
    message?: string;
}) {
    return (
        <div className="flex min-h-[60vh] items-center justify-center px-4">
            <div className="max-w-md w-full rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 text-center shadow-xl">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
                    <ShieldAlert size={28} />
                </div>
                <h2 className="text-xl font-black text-white">Akses ditolak</h2>
                <p className="mt-2 text-sm text-slate-400">{message}</p>
                <p className="mt-1 text-xs text-slate-500">
                    Hubungi admin bila Anda merasa seharusnya punya akses.
                </p>
                <Link
                    href="/"
                    className="mt-6 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-bold text-slate-200 hover:bg-white/10"
                >
                    Kembali ke Dashboard
                </Link>
            </div>
        </div>
    );
}
