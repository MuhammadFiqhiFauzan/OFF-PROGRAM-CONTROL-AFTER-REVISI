import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { claimPekaReport } from "@/db/schema";
import {
    parsePekaRows,
    requireClaimSession,
} from "@/lib/claim-workflow";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB cap
const MAX_WARNINGS_RETURNED = 20;

function parseWorkbookBuffer(buffer: Buffer): unknown[] {
    // XLSX.read otomatis mendeteksi format dari magic bytes/struktur file,
    // jadi .xlsx dan .csv ditangani helper yang sama. Sheet pertama dipakai
    // sebagai sumber data PEKA.
    const workbook = XLSX.read(buffer, {
        type: "buffer",
        raw: false,
        cellDates: false,
    });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
}

export async function POST(request: Request) {
    const actor = await requireClaimSession();
    if (!actor) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (actor.role !== "admin" && actor.role !== "claim") {
        return NextResponse.json({
            ok: false,
            code: "PEKA_IMPORT_FORBIDDEN",
            error: "Hanya role admin atau claim yang dapat mengimpor PEKA report.",
        }, { status: 403 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!(file instanceof File) || file.size <= 0) {
            return NextResponse.json({
                ok: false,
                code: "PEKA_IMPORT_FILE_REQUIRED",
                error: "File PEKA wajib diupload (.xlsx atau .csv).",
            }, { status: 400 });
        }
        if (file.size > MAX_FILE_BYTES) {
            return NextResponse.json({
                ok: false,
                code: "PEKA_IMPORT_FILE_TOO_LARGE",
                error: "Ukuran file PEKA melebihi 10 MB.",
            }, { status: 400 });
        }
        const fileName = (file.name || "peka-import").trim();
        const lower = fileName.toLowerCase();
        if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
            return NextResponse.json({
                ok: false,
                code: "PEKA_IMPORT_FILE_FORMAT",
                error: "Format file harus .xlsx atau .csv.",
            }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        let rawRows: unknown[];
        try {
            rawRows = parseWorkbookBuffer(buffer);
        } catch (parseError) {
            console.error("[CLAIM PEKA IMPORT PARSE ERROR]", parseError);
            return NextResponse.json({
                ok: false,
                code: "PEKA_IMPORT_PARSE_FAILED",
                error: "Gagal membaca isi file PEKA. Pastikan sheet pertama berisi header yang sesuai.",
            }, { status: 400 });
        }

        const parsed = parsePekaRows(rawRows, fileName);

        if (parsed.rows.length === 0) {
            return NextResponse.json({
                ok: true,
                success: true,
                importedCount: 0,
                skippedCount: parsed.skippedCount,
                warningCount: parsed.warnings.length,
                warnings: parsed.warnings.slice(0, MAX_WARNINGS_RETURNED),
                sourceFile: fileName,
                message: "Tidak ada baris valid untuk diimpor (semua baris di-skip karena No Surat RD kosong).",
            });
        }

        const importedAt = new Date();
        const insertValues = parsed.rows.map((row) => ({
            id: randomUUID(),
            sourceFile: row.sourceFile,
            claimNo: row.claimNo,
            jenisKlaim: row.jenisKlaim,
            rdName: row.rdName,
            periode: row.periode,
            noSuratRd: row.noSuratRd,
            totalClaim: row.totalClaim,
            cnNumber: row.cnNumber,
            requestor: row.requestor,
            lastProcessedDate: row.lastProcessedDate,
            pendingUser: row.pendingUser,
            leadTime: row.leadTime,
            age: row.age,
            note: row.note,
            ecNumber: row.ecNumber,
            importedAt,
        }));

        // Batch insert dalam transaction supaya import all-or-nothing.
        // Endpoint ini sengaja TIDAK menulis ke claim_workflow_item dan
        // TIDAK mengubah claim_workflow.status — Phase 3A adalah preview-only.
        await db.transaction(async (tx) => {
            // SQLite punya batas parameter per statement; chunk konservatif
            // 200 row per insert untuk file besar.
            const CHUNK = 200;
            for (let offset = 0; offset < insertValues.length; offset += CHUNK) {
                const chunk = insertValues.slice(offset, offset + CHUNK);
                await tx.insert(claimPekaReport).values(chunk);
            }
        });

        return NextResponse.json({
            ok: true,
            success: true,
            importedCount: insertValues.length,
            skippedCount: parsed.skippedCount,
            warningCount: parsed.warnings.length,
            warnings: parsed.warnings.slice(0, MAX_WARNINGS_RETURNED),
            sourceFile: fileName,
        });
    } catch (error) {
        console.error("[CLAIM PEKA IMPORT ERROR]", error);
        return NextResponse.json({
            ok: false,
            error: "Gagal mengimpor PEKA report.",
        }, { status: 500 });
    }
}
