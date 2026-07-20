import { guessCapability, type ModelChannel } from "@/stores/use-config-store";
import { requestControlPlane } from "./client";

export type PublicSettings = { modelChannel: { availableModels: string[]; defaultModel?: string; defaultImageModel?: string; defaultVideoModel?: string; defaultTextModel?: string; systemPrompt?: string } };

export function toServerChannel(settings: PublicSettings, baseUrl: string): ModelChannel {
    return {
        id: "server",
        name: "服务端渠道",
        baseUrl: baseUrl.replace(/\/+$/, ""),
        apiKey: "",
        apiFormat: "openai",
        models: settings.modelChannel.availableModels.map((name) => ({ name, capability: guessCapability(name) })),
    };
}

export function fetchPublicSettings() {
    return requestControlPlane<PublicSettings>("/api/settings");
}
