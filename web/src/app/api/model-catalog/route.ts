import { NextResponse } from "next/server";

import { getCanvasSession, getCanvasTokenOrigin } from "@/lib/server/canvas-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS = {
    image: "gpt-image-2",
    video: "grok-image-video",
    text: "gpt-5.6-sol",
    audio: "gpt-4o-audio-preview",
} as const;

type ImageGroupPrice = {
    "1k": number;
    "2k": number;
    "4k": number;
};

type PricingItem = {
    model_name?: string;
    quota_type?: number;
    model_price?: number;
    enable_groups?: string[];
};

export async function GET() {
    const session = await getCanvasSession();
    if (!session) return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });

    try {
        const [imageModels, videoModels, textModels, pricing, imageGroupPrice] = await Promise.all([
            fetchModels(session.accessTokens.image),
            fetchModels(session.accessTokens.video),
            fetchModels(session.accessTokens.text),
            fetchPricing().catch(() => []),
            fetchImageGroupPricing(session.accessTokens.image),
        ]);
        const pricingMap = videoPricingMap(pricing);
        const video = prioritize(videoModels, DEFAULTS.video).map((id) => ({ id, priceLabel: videoPriceLabel(pricingMap.get(id)) }));
        const text = prioritize(textModels.filter(isTextModel), DEFAULTS.text).map((id) => ({ id }));
        const audio = textModels.includes(DEFAULTS.audio) ? [{ id: DEFAULTS.audio, priceLabel: "按量计费" }] : [];

        return NextResponse.json(
            {
                image: prioritize(imageModels, DEFAULTS.image).map((id) => ({ id, priceLabel: imagePriceLabel(imageGroupPrice) })),
                video,
                text,
                audio,
                defaults: DEFAULTS,
            },
            { headers: { "Cache-Control": "no-store" } },
        );
    } catch (error) {
        console.error("Canvas model catalog failed", error instanceof Error ? error.message : "unknown error");
        return NextResponse.json({ error: "模型列表读取失败" }, { status: 502 });
    }
}

async function fetchModels(token: string) {
    const response = await fetch(new URL("/v1/models", getCanvasTokenOrigin()), {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as { data?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "model list request failed");
    return Array.from(new Set((payload.data || []).map((item) => item.id?.trim()).filter((id): id is string => Boolean(id))));
}

async function fetchImageGroupPricing(token: string): Promise<ImageGroupPrice> {
    const response = await fetch(new URL("/v1/image-group-pricing", getCanvasTokenOrigin()), {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as { data?: Partial<ImageGroupPrice>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "image group pricing request failed");
    const prices = payload.data;
    if (!prices || !Number.isFinite(prices["1k"]) || !Number.isFinite(prices["2k"]) || !Number.isFinite(prices["4k"])) {
        throw new Error("invalid image group pricing response");
    }
    return prices as ImageGroupPrice;
}

function imagePriceLabel(prices: ImageGroupPrice) {
    return `1K $${formatImagePrice(prices["1k"])} · 2K $${formatImagePrice(prices["2k"])} · 4K $${formatImagePrice(prices["4k"])}`;
}

function formatImagePrice(value: number) {
    return value.toFixed(2);
}

async function fetchPricing() {
    const response = await fetch(new URL("/api/pricing", getCanvasTokenOrigin()), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const payload = (await response.json()) as { data?: PricingItem[] };
    if (!response.ok) throw new Error("pricing request failed");
    return payload.data || [];
}

function videoPricingMap(items: PricingItem[]) {
    const result = new Map<string, PricingItem>();
    for (const item of items) {
        const id = item.model_name?.trim();
        if (!id || !item.enable_groups?.includes("Video")) continue;
        const current = result.get(id);
        if (!current || (item.quota_type !== 0 && current.quota_type === 0)) result.set(id, item);
    }
    return result;
}

function videoPriceLabel(item: PricingItem | undefined) {
    if (!item || !Number.isFinite(item.model_price)) return "价格以 Token 页面为准";
    if (item.quota_type === 2) return "按秒 · $" + formatPrice(item.model_price) + "/秒";
    if (item.quota_type === 1) return "按条 · $" + formatPrice(item.model_price) + "/条";
    return "按量计费";
}

function formatPrice(value: number | undefined) {
    return Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function isTextModel(id: string) {
    const value = id.toLowerCase();
    return !value.includes("image") && !value.includes("audio") && !value.includes("realtime") && !value.includes("video") && !value.includes("tts") && !value.includes("speech");
}

function prioritize(models: string[], preferred: string) {
    return Array.from(new Set(models)).sort((a, b) => {
        if (a === preferred) return -1;
        if (b === preferred) return 1;
        return a.localeCompare(b);
    });
}
