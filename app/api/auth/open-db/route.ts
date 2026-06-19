import { NextResponse } from 'next/server';
import { getAccurateSession, upsertAccurateSession } from '@/lib/accurate-session';
import { requireApiSession } from '@/lib/api-security';

export async function GET(request: Request) {
    return openDatabase(request);
}

export async function POST(request: Request) {
    return openDatabase(request);
}

async function openDatabase(request: Request) {
    const authCheck = await requireApiSession(request);
    if (authCheck.response) return authCheck.response;

    const url = new URL(request.url);
    const queryDbId = url.searchParams.get('id');
    const body = request.method === "POST"
        ? await request.json().catch(() => ({})) as { id?: unknown; alias?: unknown }
        : {};
    const dbId = String(body.id || queryDbId || "").trim();
    const databaseAlias = typeof body.alias === "string" ? body.alias : null;

    if (!dbId) {
        return NextResponse.json({ error: "Missing database id" }, { status: 400 });
    }

    const accurateSession = await getAccurateSession(String(authCheck.session.user.id));
    if (!accurateSession?.accessToken) {
        return NextResponse.json({ error: "Sesi Accurate belum terhubung." }, { status: 400 });
    }

    try {
        const response = await fetch(`https://account.accurate.id/api/open-db.do?id=${dbId}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accurateSession.accessToken}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            return NextResponse.json({ error: "Failed to open db", details: errText }, { status: response.status });
        }

        const data = await response.json();
        if (data?.host && data?.session) {
            await upsertAccurateSession(String(authCheck.session.user.id), {
                sessionHost: data.host,
                sessionId: data.session,
                databaseId: dbId,
                databaseAlias,
            });
        }
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: "Internal Server Error", message: err.message }, { status: 500 });
    }
}
