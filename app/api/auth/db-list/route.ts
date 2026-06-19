import { NextResponse } from 'next/server';
import { getAccurateSession } from '@/lib/accurate-session';
import { requireApiSession } from '@/lib/api-security';

export async function GET(request: Request) {
    const authCheck = await requireApiSession(request);
    if (authCheck.response) return authCheck.response;

    const accurateSession = await getAccurateSession(String(authCheck.session.user.id));
    if (!accurateSession?.accessToken) {
        return NextResponse.json({ error: "Sesi Accurate belum terhubung." }, { status: 400 });
    }

    try {
        const response = await fetch("https://account.accurate.id/api/db-list.do", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accurateSession.accessToken}`
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            return NextResponse.json({ error: "Failed to fetch db-list", details: errText }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: "Internal Server Error", message: err.message }, { status: 500 });
    }
}
