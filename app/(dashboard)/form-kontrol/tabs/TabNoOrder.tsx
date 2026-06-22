"use client";

// Kontrol Toko Tidak Order — kartu mobile-first konsisten dengan TabAo.
// Setiap toko = kartu dengan border-l-rose-500, form alasan di-stack vertikal,
// tap target min-h-[44px] pada select/input/button.

import { useCallback, useEffect, useState } from "react";
import { XCircle, Filter, AlertTriangle, Loader2, RefreshCw, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { type Scope, type AoRow, type Reason, PRINCIPLES, SectionTitle } from "../shared";

export default function TabNoOrder({ scope }: { scope: Scope }) {
    const [rows, setRows] = useState<AoRow[]>([]);
    const [reasons, setReasons] = useState<Reason[]>([]);
    const [loading, setLoading] = useState(true);
    const [edits, setEdits] = useState<Record<string, { reasonCode: string; note: string }>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [selectedPrinciple, setSelectedPrinciple] = useState(PRINCIPLES[0]);
    const [selectedSalesCode, setSelectedSalesCode] = useState(scope.salesCode ?? "");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ date: selectedDate, principle: selectedPrinciple });
            if (selectedSalesCode) p.set("salesCode", selectedSalesCode);
            const [aoRes, reasonRes] = await Promise.all([
                fetch(`/api/form-kontrol/ao-control?${p}`),
                fetch("/api/form-kontrol/reasons"),
            ]);
            const [aoData, reasonData] = await Promise.all([aoRes.json(), reasonRes.json()]);
            const allRows: AoRow[] = (aoData.rows ?? []).map((r: Record<string, unknown>) => ({
                id: r.id as string,
                salesCode: r.salesCode as string,
                custCode: r.custCode as string,
                custName: r.custName as string,
                principle: (r.principle as string) ?? selectedPrinciple,
                status: ((r.aoStatus ?? "not_visited") as AoRow["status"]),
                orderValueDpp: 0,
                isPriority: r.aoStatus === "priority",
                noOrderReasonCode: r.noOrderReasonCode as string | undefined,
                noOrderNote: r.noOrderNote as string | undefined,
                monthlyOrderCount: 0,
                needsAttention: false,
            }));
            const noOrderRows = allRows.filter(r => r.status === "not_order");
            setRows(noOrderRows);
            setReasons(reasonData.rows ?? []);
            const init: Record<string, { reasonCode: string; note: string }> = {};
            noOrderRows.forEach(r => { init[r.custCode] = { reasonCode: r.noOrderReasonCode ?? "", note: r.noOrderNote ?? "" }; });
            setEdits(init);
        } catch { toast.error("Gagal memuat data toko tidak order"); }
        finally { setLoading(false); }
    }, [selectedDate, selectedPrinciple, selectedSalesCode]);

    useEffect(() => { load(); }, [load]);

    async function handleSave(custCode: string) {
        const edit = edits[custCode];
        if (!edit?.reasonCode) { toast.error("Pilih alasan terlebih dahulu"); return; }
        const row = rows.find(r => r.custCode === custCode);
        if (!row) return;
        setSaving(custCode);
        try {
            const res = await fetch("/api/form-kontrol/ao-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    salesCode: row.salesCode,
                    custCode,
                    principle: selectedPrinciple,
                    date: selectedDate,
                    status: "not_order",
                    noOrderReasonCode: edit.reasonCode,
                    noOrderNote: edit.note,
                }),
            });
            if (!res.ok) throw new Error("Gagal menyimpan");
            toast.success("Alasan berhasil disimpan");
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
        } finally { setSaving(null); }
    }

    const missingReason = rows.filter(r => !edits[r.custCode]?.reasonCode).length;

    return (
        <div className="space-y-4">
            <SectionTitle icon={XCircle} no={3} title="Kontrol Toko Tidak Order"
                desc="Tidak boleh ada toko tanpa alasan — setiap toko wajib terdokumentasi" />

            <div className="flex flex-wrap items-center gap-2 bg-[#1a1c23]/60 border border-white/10 rounded-xl px-4 py-3">
                <Filter size={14} className="text-slate-400" />
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                    className="bg-black/40 border border-white/10 rounded-lg text-xs text-white px-2 py-1.5" />
                <select value={selectedPrinciple} onChange={e => setSelectedPrinciple(e.target.value)}
                    className="bg-black/40 border border-white/10 rounded-lg text-xs text-white px-2 py-1.5">
                    {PRINCIPLES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                {scope.allowedSalesCodes === null && (
                    <input value={selectedSalesCode} onChange={e => setSelectedSalesCode(e.target.value)}
                        placeholder="Kode Sales..." className="bg-black/40 border border-white/10 rounded-lg text-xs text-white px-2 py-1.5 w-32" />
                )}
                <button onClick={load} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2 py-1.5 ml-auto">
                    <RefreshCw size={13} /> Refresh
                </button>
            </div>

            {!loading && missingReason > 0 && (
                <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-lg px-4 py-2.5 text-rose-400 text-sm">
                    <AlertTriangle size={15} />
                    {missingReason} toko belum memiliki alasan
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                    <Loader2 size={18} className="animate-spin" /> Memuat...
                </div>
            ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2 bg-[#1a1c23]/60 border border-white/10 rounded-xl">
                    <CheckCircle2 size={32} className="opacity-30 text-emerald-500" />
                    <p className="text-sm">Semua toko sudah order hari ini!</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map(r => {
                        const saved = !!edits[r.custCode]?.reasonCode;
                        return (
                            <div key={r.custCode}
                                className="rounded-xl border border-white/10 border-l-4 border-l-rose-500 bg-[#1a1c23]/60 px-4 py-3 space-y-3">
                                {/* Toko header */}
                                <div className="flex items-start gap-2">
                                    <XCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-base font-semibold text-white truncate">{r.custName}</p>
                                        <p className="text-xs font-mono text-slate-500">{r.custCode} · {r.principle}</p>
                                    </div>
                                    {saved && (
                                        <span className="shrink-0 text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                                            Tersimpan
                                        </span>
                                    )}
                                </div>
                                {/* Form stacked */}
                                <select
                                    value={edits[r.custCode]?.reasonCode ?? ""}
                                    onChange={e => setEdits(prev => ({ ...prev, [r.custCode]: { ...prev[r.custCode], reasonCode: e.target.value } }))}
                                    className={`w-full bg-black/40 border rounded-lg text-sm text-white px-3 py-2.5 min-h-[44px] ${!edits[r.custCode]?.reasonCode ? "border-rose-500/50" : "border-white/10"}`}
                                >
                                    <option value="">— Pilih Alasan (Wajib) —</option>
                                    {reasons.map(reason => (
                                        <option key={reason.reasonCode} value={reason.reasonCode}>[{reason.category}] {reason.label}</option>
                                    ))}
                                </select>
                                <input
                                    value={edits[r.custCode]?.note ?? ""}
                                    onChange={e => setEdits(prev => ({ ...prev, [r.custCode]: { ...prev[r.custCode], note: e.target.value } }))}
                                    placeholder="Catatan tambahan..."
                                    className="w-full bg-black/40 border border-white/10 rounded-lg text-sm text-white px-3 py-2.5 min-h-[44px] placeholder-slate-500"
                                />
                                <div className="flex justify-end">
                                    <button onClick={() => handleSave(r.custCode)} disabled={saving === r.custCode}
                                        className="flex items-center gap-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-semibold min-h-[44px]">
                                        {saving === r.custCode ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
