import { z } from "zod";

const id = z.string().min(1);
const chatImage = z.object({ storageKey: id, name: z.string(), width: z.number(), height: z.number(), bytes: z.number(), mimeType: z.string() });
const chatItem = z.object({ id, role: z.enum(["user", "assistant", "tool", "error", "notice"]), text: z.string(), images: z.array(chatImage).optional() }).passthrough();
const message = z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.union([z.string(), z.array(z.object({ type: id }).passthrough())]) }).passthrough();
export const archiveThreadSchema = z.object({
    id, projectId: id, title: z.string(), updatedAt: z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value))), items: z.array(chatItem), messages: z.array(message),
    contextMessages: z.array(message).optional(), contextTokens: z.number().optional(),
}).strict();
export type ArchiveThread = z.infer<typeof archiveThreadSchema>;

export function isChatImageKey(key: string) {
    return key.startsWith("image:") || key.startsWith("draft-media:");
}

type MessagePart = { type: string; data?: unknown; mediaType?: unknown };

export function isChatImageFile(part: MessagePart, known: { has(key: string): boolean }): part is MessagePart & { data: string } {
    if (part.type !== "file" || typeof part.data !== "string") return false;
    if (part.data.startsWith("draft-media:") && typeof part.mediaType === "string" && !part.mediaType.startsWith("image/")) return false;
    return known.has(part.data) || isChatImageKey(part.data);
}

export function chatImageKeys(thread: ArchiveThread) {
    const keys = new Set<string>();
    for (const item of thread.items) {
        for (const image of item.images ?? []) keys.add(image.storageKey);
    }
    for (const messages of [thread.messages, thread.contextMessages ?? []]) {
        for (const message of messages) {
            if (message.role !== "user" || !Array.isArray(message.content)) continue;
            for (const part of message.content) {
                if (isChatImageFile(part, keys)) keys.add(part.data);
            }
        }
    }
    return keys;
}

export function formatChatImagePrompt(prompt: string, images: readonly { storageKey: string; name: string }[]) {
    return `${prompt}\n参考图：${JSON.stringify(images.map(({ storageKey, name }) => ({ storageKey, name })))}`;
}
