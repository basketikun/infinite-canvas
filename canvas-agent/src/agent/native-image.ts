import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { CodexAppClient } from "./codex-client.js";

const inputSchema = z.object({
    prompt: z.string().trim().min(1),
    model: z.string().optional(),
    count: z.coerce.number().int().min(1).max(15).default(1),
    size: z.string().optional(),
    quality: z.string().optional(),
    background: z.string().optional(),
    references: z.array(z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/)).default([]),
});

export async function generateNativeImages(input: unknown, signal: AbortSignal) {
    const data = inputSchema.parse(input);
    const cwd = await mkdtemp(path.join(os.tmpdir(), "canvas-imagegen-"));
    let client: CodexAppClient | undefined;
    const images = new Map<string, string>();
    const saved = new Set<string>();
    try {
        client = await CodexAppClient.start(
            (_type, payload) => {
                const value = payload as { item?: { type?: string; id?: string; savedPath?: string; result?: string; success?: boolean; status?: string } };
                const item = value?.item;
                if (!item || !["image_generation", "imageGeneration"].includes(item.type || "") || item.success === false || item.status !== "completed") return;
                if (item.savedPath) saved.add(item.savedPath);
                else if (item.result && /^[A-Za-z0-9+/=\r\n]+$/.test(item.result)) images.set(item.id || item.result, `data:image/png;base64,${item.result}`);
            },
            () => {},
        );
        const abort = () => client?.close();
        signal.addEventListener("abort", abort, { once: true });
        try {
            if (signal.aborted) throw new Error("生圖已取消");
            const thread = await client.startImageThread(cwd);
            const refs = await Promise.all(
                data.references.map(async (ref, i) => {
                    const file = path.join(cwd, `reference-${i}.${ref.slice(11, ref.indexOf(";"))}`);
                    await writeFile(file, Buffer.from(ref.slice(ref.indexOf(",") + 1), "base64"));
                    return file;
                }),
            );
            await client.startTurn(
                thread.id,
                `Use only built-in ImageGen. Generate ${data.count} images. Size preference: ${data.size || "auto"}; quality: ${data.quality || "auto"}; background: ${data.background || "auto"}. Do not call external tools or APIs.\n${data.prompt}`,
                refs,
                "request",
                data.model || undefined,
            );
            for (const file of saved) {
                const bytes = await readFile(file);
                const mime = bytes.subarray(1, 4).toString() === "PNG" ? "image/png" : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : "";
                if (mime) images.set(file, `data:${mime};base64,${bytes.toString("base64")}`);
            }
            if (!images.size) throw new Error("Codex 未返回內建 ImageGen 圖片，可能此 app-server 尚未提供生圖工具；未使用其他 API。");
            return [...images.values()];
        } finally {
            signal.removeEventListener("abort", abort);
        }
    } finally {
        client?.close();
        await rm(cwd, { recursive: true, force: true });
    }
}
