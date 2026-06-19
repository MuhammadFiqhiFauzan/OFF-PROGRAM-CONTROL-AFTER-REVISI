import { NextRequest, NextResponse } from "next/server";
import { clearAccurateSession, getAccurateSession } from "@/lib/accurate-session";
import { requireApiSession } from "@/lib/api-security";

export async function GET(request: NextRequest) {
    const authCheck = await requireApiSession(request);
    if (authCheck.response) return authCheck.response;

    const accurateSession = await getAccurateSession(String(authCheck.session.user.id));
    return NextResponse.json({
        ok: true,
        connected: Boolean(accurateSession),
        databaseConnected: Boolean(accurateSession?.sessionHost && accurateSession?.sessionId),
        sessionHost: accurateSession?.sessionHost ?? null,
        databaseId: accurateSession?.databaseId ?? null,
        databaseAlias: accurateSession?.databaseAlias ?? null,
    });
}

export async function DELETE(request: NextRequest) {
    const authCheck = await requireApiSession(request);
    if (authCheck.response) return authCheck.response;

    await clearAccurateSession(String(authCheck.session.user.id));
    return NextResponse.json({ ok: true });
}
