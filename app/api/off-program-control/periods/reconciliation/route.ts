/*
 * Tujuan: API endpoint untuk generate dan serve PDF rekonsiliasi periode OFF Program.
 * Caller: PeriodClosurePanel di halaman OFF Program Control (tombol Download Rekonsiliasi).
 * Dependensi: lib/off-program-control/reconciliation-pdf, access control.
 * Main Functions: GET handler.
 * Side Effects: DB read untuk fetch batch data, generate PDF on-the-fly.
 */

import { NextResponse } from "next/server";
import { canActorAccessOffData, requireOffSession } from "@/lib/off-program-control";
import { generateReconciliationPdf } from "@/lib/off-program-control/reconciliation-pdf";

export async function GET(request: Request) {
    const actor = await requireOffSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!canActorAccessOffData(actor)) {
        return NextResponse.json({ ok: false, error: "Role Anda tidak memiliki akses." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const principleCode = searchParams.get("principleCode");
    const bulan = searchParams.get("bulan");
    const tahun = searchParams.get("tahun");

    if (!principleCode || !bulan || !tahun) {
        return NextResponse.json(
            { ok: false, error: "Parameter principleCode, bulan, dan tahun wajib diisi." },
            { status: 400 },
        );
    }

    try {
        const result = await generateReconciliationPdf(principleCode, bulan, tahun);
        if (!result) {
            return NextResponse.json(
                { ok: false, error: "Tidak ada data batch untuk periode ini." },
                { status: 404 },
            );
        }

        return new NextResponse(new Uint8Array(result.pdf), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${encodeURIComponent(result.fileName)}"`,
                "Cache-Control": "no-cache",
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Gagal generate PDF rekonsiliasi.";
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
}
