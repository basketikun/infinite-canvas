import { network } from "@workbench/services/network/runtime";
import { strFromU8 } from "fflate";

import { createZip, readZip } from "@workbench/lib/zip";
import { modelCapabilities, type CallScript, type ModelCapability } from "@infinite-canvas/shared/models";

type ScriptEntry = {
    id: string;
    name: string;
    description: string;
    invertInDark?: boolean;
    logo?: { path: string; mimeType: string };
    capability: ModelCapability;
    source: string;
};

/** 打包独立源码与说明，不读取渠道地址、密钥或模型配置。 */
export async function createCallScriptArchive(scripts: CallScript[]) {
    const files: Array<{ name: string; data: BlobPart }> = [];
    const entries = await Promise.all(scripts.map(async (script, index): Promise<ScriptEntry> => {
        const entry: ScriptEntry = { id: script.id, name: script.name, description: script.description, invertInDark: script.invertInDark, capability: script.capability, source: `scripts/${index}/main.js` };
        files.push({ name: entry.source, data: script.source });
        if (script.logo) {
            const response = await fetch(network.url(script.logo));
            if (!response.ok) throw new Error("脚本包导出失败，请检查 Logo 是否可读取后重试");
            const logo = await response.blob();
            entry.logo = { path: `scripts/${index}/logo`, mimeType: logo.type };
            files.push({ name: entry.logo.path, data: logo });
        }
        return entry;
    }));
    return createZip([{ name: "manifest.json", data: JSON.stringify({ format: "infinite-canvas-call-scripts", version: 3, scripts: entries }, null, 2) }, ...files]);
}

/** 所有条目读取成功后才返回；导入过程不执行源码。 */
export async function readCallScriptArchive(file: Blob): Promise<CallScript[]> {
    try {
        const files = await readZip(file);
        const manifest = JSON.parse(await files.get("manifest.json")!.text());
        if (manifest.format !== "infinite-canvas-call-scripts" || manifest.version !== 3 || !Array.isArray(manifest.scripts) || !manifest.scripts.length) throw new Error("Invalid manifest");
        return await Promise.all(manifest.scripts.map(async (entry: ScriptEntry) => {
            if (typeof entry.id !== "string" || !entry.id || typeof entry.name !== "string" || !entry.name || typeof entry.description !== "string" || !modelCapabilities.includes(entry.capability) || typeof entry.source !== "string" || !files.has(entry.source)) throw new Error("Invalid script");
            if (entry.invertInDark !== undefined && typeof entry.invertInDark !== "boolean") throw new Error("Invalid logo style");
            const source = await files.get(entry.source)!.text();
            if (!source) throw new Error("Empty source");
            let logo: string | undefined;
            if (entry.logo) {
                if (typeof entry.logo.path !== "string" || typeof entry.logo.mimeType !== "string" || !entry.logo.mimeType.startsWith("image/")) throw new Error("Invalid logo");
                const bytes = new Uint8Array(await files.get(entry.logo.path)!.arrayBuffer());
                logo = `data:${entry.logo.mimeType};base64,${btoa(strFromU8(bytes, true))}`;
            }
            return { id: entry.id, name: entry.name, description: entry.description, logo, invertInDark: entry.invertInDark, capability: entry.capability, source };
        }));
    } catch {
        throw new Error("脚本包无法读取，请使用完整的脚本 ZIP 包");
    }
}
