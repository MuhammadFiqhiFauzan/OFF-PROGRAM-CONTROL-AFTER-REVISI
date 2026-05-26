/*
 * Tujuan: Helper Phase 3A untuk normalisasi dan parsing PEKA report rows.
 * Caller: app/api/claim-workflow/peka/import/route.ts (insert ke claim_peka_report)
 *         dan app/api/claim-workflow/[id]/peka-matches/route.ts (preview matching).
 * Dependensi: Tidak ada runtime dependency lain. Pure data normalization.
 * Main Functions: normalizeNoSurat, normalizeHeader, parsePekaRows.
 * Side Effects: Tidak ada. Tidak menulis ke DB. Tidak update claim_workflow_item.
 */

export type PekaParsedRow = {
    sourceFile: string;
    claimNo: string | null;
    jenisKlaim: string | null;
    rdName: string | null;
    periode: string | null;
    noSuratRd: string;
    totalClaim: number;
    cnNumber: string | null;
    requestor: string | null;
    lastProcessedDate: string | null;
    pendingUser: string | null;
    leadTime: number | null;
    age: number | null;
    note: string | null;
    ecNumber: string | null;
};

export type PekaParseWarning = {
    rowIndex: number;
    field: string;
    message: string;
};

export type PekaParseResult = {
    rows: PekaParsedRow[];
    warnings: PekaParseWarning[];
    skippedCount: number;
};

/**
 * Normalisasi nilai No Surat untuk matching antara
 * `claim_workflow_item.noSurat` dan `claim_peka_report.noSuratRd`.
 *
 * Rule: trim, collapse whitespace internal, normalisasi spasi di sekitar
 * `/`, lalu uppercase. Nilai null/blank dikembalikan sebagai string kosong
 * supaya pemanggil bisa menyaring tanpa harus cek tipe.
 */
export function normalizeNoSurat(value: unknown): string {
    if (value === null || value === undefined) return "";
    const text = String(value).trim();
    if (!text) return "";
    const collapsed = text
        .replace(/\s+/g, " ")
        .replace(/\s*\/\s*/g, "/");
    return collapsed.toUpperCase();
}

/**
 * Normalisasi header kolom dari sheet/CSV agar matching tahan terhadap
 * variasi titik, spasi ganda, dan kapitalisasi (mis. "CLAIM NO." vs
 * "claim no" vs "Claim No.").
 */
export function normalizeHeader(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value)
        .trim()
        .toUpperCase()
        .replace(/\./g, "")
        .replace(/\s+/g, " ");
}

const HEADER_ALIASES: Record<string, keyof PekaParsedRow> = {
    "CLAIM NO": "claimNo",
    "JENIS KLAIM": "jenisKlaim",
    "RD NAME": "rdName",
    "PERIODE": "periode",
    "NO SURAT RD": "noSuratRd",
    "TOTAL CLAIM": "totalClaim",
    "CN NUMBER": "cnNumber",
    "CN": "cnNumber",
    "REQUESTOR": "requestor",
    "LAST PROCESSED/RECIVE DATE": "lastProcessedDate",
    "LAST PROCESSED/RECEIVE DATE": "lastProcessedDate",
    "PENDING USER": "pendingUser",
    "LEAD TIME": "leadTime",
    "AGE": "age",
    "NOTE": "note",
    "EC": "ecNumber",
};

function pickField(
    row: Record<string, unknown>,
    headerIndex: Map<string, string>,
    target: keyof PekaParsedRow,
): unknown {
    for (const [normalized, original] of headerIndex) {
        if (HEADER_ALIASES[normalized] === target) {
            return row[original];
        }
    }
    return undefined;
}

function asTextOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

function parseNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value).trim();
    if (!text) return null;
    // Tolerate Indonesian thousand separator "." and decimal ",":
    // "1.234.567,89" -> 1234567.89
    const hasComma = text.includes(",");
    const hasDot = text.includes(".");
    let normalized = text.replace(/[^\d,.\-]/g, "");
    if (hasComma && hasDot) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if (hasComma) {
        normalized = normalized.replace(/,/g, ".");
    }
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
}

/**
 * Parse rows dari workbook/CSV ke bentuk siap insert ke `claim_peka_report`.
 *
 * Skip rule: row tanpa `noSuratRd` (setelah normalisasi) di-skip dan
 * dihitung di `skippedCount`. `totalClaim` non-numeric di-set 0 dan
 * mencatat warning per row supaya import tidak gagal hanya karena cell
 * format aneh.
 */
export function parsePekaRows(
    rows: unknown[],
    sourceFile: string,
): PekaParseResult {
    const result: PekaParseResult = { rows: [], warnings: [], skippedCount: 0 };
    if (!Array.isArray(rows)) return result;

    rows.forEach((raw, index) => {
        if (!raw || typeof raw !== "object") {
            result.skippedCount += 1;
            return;
        }
        const row = raw as Record<string, unknown>;
        const headerIndex = new Map<string, string>();
        for (const original of Object.keys(row)) {
            const normalized = normalizeHeader(original);
            if (!headerIndex.has(normalized)) {
                headerIndex.set(normalized, original);
            }
        }

        const noSuratRaw = pickField(row, headerIndex, "noSuratRd");
        const noSuratNormalized = normalizeNoSurat(noSuratRaw);
        if (!noSuratNormalized) {
            result.skippedCount += 1;
            return;
        }

        const totalClaimRaw = pickField(row, headerIndex, "totalClaim");
        const totalClaimParsed = parseNumberOrNull(totalClaimRaw);
        let totalClaim = 0;
        if (totalClaimParsed === null) {
            if (totalClaimRaw !== undefined && totalClaimRaw !== null && String(totalClaimRaw).trim() !== "") {
                result.warnings.push({
                    rowIndex: index,
                    field: "totalClaim",
                    message: `Nilai TOTAL CLAIM "${String(totalClaimRaw)}" bukan angka, di-set 0.`,
                });
            }
        } else {
            totalClaim = totalClaimParsed;
        }

        const parsed: PekaParsedRow = {
            sourceFile,
            claimNo: asTextOrNull(pickField(row, headerIndex, "claimNo")),
            jenisKlaim: asTextOrNull(pickField(row, headerIndex, "jenisKlaim")),
            rdName: asTextOrNull(pickField(row, headerIndex, "rdName")),
            periode: asTextOrNull(pickField(row, headerIndex, "periode")),
            noSuratRd: noSuratNormalized,
            totalClaim,
            cnNumber: asTextOrNull(pickField(row, headerIndex, "cnNumber")),
            requestor: asTextOrNull(pickField(row, headerIndex, "requestor")),
            lastProcessedDate: asTextOrNull(pickField(row, headerIndex, "lastProcessedDate")),
            pendingUser: asTextOrNull(pickField(row, headerIndex, "pendingUser")),
            leadTime: parseNumberOrNull(pickField(row, headerIndex, "leadTime")),
            age: parseNumberOrNull(pickField(row, headerIndex, "age")),
            note: asTextOrNull(pickField(row, headerIndex, "note")),
            ecNumber: asTextOrNull(pickField(row, headerIndex, "ecNumber")),
        };

        result.rows.push(parsed);
    });

    return result;
}
