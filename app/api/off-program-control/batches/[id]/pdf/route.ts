import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { canActorAccessOffData, getBatchWithItems, requireOffSession } from "@/lib/off-program-control";

type Context = { params: Promise<{ id: string }> };

const OFF_RUNTIME_DIR = path.resolve(process.cwd(), "runtime", "off-program-control");

function isPathInsideOffRuntimeDir(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return resolved === OFF_RUNTIME_DIR || resolved.startsWith(OFF_RUNTIME_DIR + path.sep);
}

export async function GET(_request: Request, context: Context) {
    const actor = await requireOffSession();
    if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!canActorAccessOffData(actor)) {
        return NextResponse.json({ ok: false, error: "Role Anda tidak memiliki akses OFF Program Control." }, { status: 403 });
    }

    const { id } = await context.params;
    const data = await getBatchWithItems(id);
    if (!data) return NextResponse.json({ ok: false, error: "Batch not found" }, { status: 404 });
    if (!data.batch.pdfPath) return NextResponse.json({ ok: false, error: "PDF has not been generated" }, { status: 404 });

    if (!isPathInsideOffRuntimeDir(data.batch.pdfPath)) {
        console.error("[OFF BATCH PDF] Refusing to serve PDF outside OFF runtime dir", {
            batchId: id,
            path: data.batch.pdfPath,
        });
        return NextResponse.json({ ok: false, error: "Path PDF tidak valid." }, { status: 400 });
    }

    try {
        const file = await readFile(data.batch.pdfPath);
        return new NextResponse(new Uint8Array(file), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${data.batch.noPengajuan.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf"`,
                "Cache-Control": "no-store",
            },
        });
    } catch {
        return NextResponse.json({ ok: false, error: "PDF file not found" }, { status: 404 });
    }
}
