import { NextResponse } from "next/server";

import { getCanvasSession } from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BalancePayload = {
    success?: boolean;
    message?: string;
    data?: {
        quota?: number;
        quota_per_unit?: number;
        quota_display_type?: string;
        usd_exchange_rate?: number;
        custom_currency_symbol?: string;
        custom_currency_exchange_rate?: number;
    };
};

export async function GET() {
    const session = await getCanvasSession();
    if (!session) return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });

    try {
        const response = await fetch(new URL("/api/usage/token/balance", session.issuer), {
            headers: { Authorization: "Bearer " + session.accessTokens.image, Accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
        const payload = (await response.json()) as BalancePayload;
        if (!response.ok || payload.success === false || !payload.data) throw new Error(payload.message || "balance request failed");

        const data = payload.data;
        if (!Number.isFinite(data.quota) || !Number.isFinite(data.quota_per_unit) || Number(data.quota_per_unit) <= 0) {
            throw new Error("invalid balance response");
        }

        return NextResponse.json(
            {
                quota: data.quota,
                quotaPerUnit: data.quota_per_unit,
                quotaDisplayType: data.quota_display_type || "USD",
                usdExchangeRate: data.usd_exchange_rate || 1,
                customCurrencySymbol: data.custom_currency_symbol || "¤",
                customCurrencyExchangeRate: data.custom_currency_exchange_rate || 1,
                rechargeUrl: new URL("/wallet", session.issuer).toString(),
            },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (error) {
        console.error("Canvas balance request failed", error instanceof Error ? error.message : "unknown error");
        return NextResponse.json({ error: "余额读取失败" }, { status: 502 });
    }
}
