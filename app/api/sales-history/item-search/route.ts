/*
 * Tujuan: Pencarian item flat Sales History (1 baris = 1 produk + No Faktur) untuk tabel history.
 * Caller: app/(dashboard)/sales-history/page.tsx (tabel item, muncul setelah kode/nama produk diketik).
 * Dependensi: lib/sales-history/service.ts, RBAC resolve.
 * Main Functions: GET.
 * Side Effects: DB read-only sales-history-inv.db (SQLite fuzzy: kamus + IN-clause berindeks).
 * Catatan: pagination server-side. Tanpa parameter 'product' mengembalikan list kosong (item hanya tampil saat dicari).
 *   product/kodeCust di-clamp 100 char di trust boundary (fuzzy matcher alokasi O(n*m) — cegah spike memori).
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePermissionH } from "@/lib/rbac/resolve";
import { isValidSalesHistoryYear, searchSalesHistoryItems, normalizePositiveInt } from "@/lib/sales-history/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const gate = await requirePermissionH("sales_history.view");
    if (gate.response) return gate.response;

    try {
        const { searchParams } = new URL(request.url);
        const year = (searchParams.get("year") || "").trim();
        if (!isValidSalesHistoryYear(year)) {
            return NextResponse.json({ ok: false, error: "Parameter 'year' tidak valid." }, { status: 400 });
        }
        const result = await searchSalesHistoryItems({
            year,
            principal: (searchParams.get("principal") || "").trim(),
            kodeCust: (searchParams.get("kodeCust") || "").trim().slice(0, 100),
            product: (searchParams.get("product") || "").trim().slice(0, 100),
            page: normalizePositiveInt(searchParams.get("page"), 1, 1000000),
            limit: normalizePositiveInt(searchParams.get("limit"), 50, 200),
        });
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        console.error("[SALES HISTORY ITEM SEARCH ERROR]", error);
        return NextResponse.json({ ok: false, error: "Gagal memuat item." }, { status: 500 });
    }
}
