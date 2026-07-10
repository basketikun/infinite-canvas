import type { ModelCatalog } from "@/stores/use-config-store";

export async function fetchModelCatalog(signal?: AbortSignal) {
    const response = await fetch("/api/model-catalog", { cache: "no-store", signal });
    const payload = (await response.json()) as ModelCatalog & { error?: string };
    if (!response.ok) throw new Error(payload.error || "模型列表读取失败");
    return payload;
}
