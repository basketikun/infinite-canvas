import { create } from "zustand";
import { nanoid } from "nanoid";
import { storage } from "@workbench/services/storage/runtime";
import { builtinCallScripts } from "@infinite-canvas/model-runtime/call-scripts/builtin";
import type { CallScript } from "@infinite-canvas/shared/models";

type ScriptDirectory = {
    scripts: CallScript[];
    removedBuiltinIds: string[];
    /** 由已启用插件贡献、只读；同时保存给本地服务校验调用。 */
    pluginScripts: CallScript[];
};

type CallScriptStore = ScriptDirectory & {
    save: (script: CallScript) => Promise<void>;
    remove: (id: string) => Promise<void>;
    restore: (id: string) => Promise<void>;
    importScripts: (scripts: CallScript[]) => Promise<void>;
};

const directoryKey = "infinite-canvas:call_scripts";

export function updateCallScripts(change: (current: ScriptDirectory) => ScriptDirectory): Promise<void> {
    const saved = callScriptsSaved.catch(() => callScriptsReady).then(async () => {
        const current = useCallScriptStore.getState();
        const next = { pluginScripts: current.pluginScripts, ...change(current) };
        await storage.state.setItem(directoryKey, JSON.stringify({ state: next, version: 1 }));
        useCallScriptStore.setState(next);
    });
    callScriptsSaved = saved;
    void saved.catch(() => {
        // 这一笔的调用方仍收到失败，后续读取继续使用已保存的目录。
        if (callScriptsSaved === saved) callScriptsSaved = callScriptsReady;
    });
    return saved;
}

export const useCallScriptStore = create<CallScriptStore>(() => ({
    scripts: [],
    removedBuiltinIds: [],
    pluginScripts: [],
    save: (script) => updateCallScripts((state) => ({ scripts: [...state.scripts.filter((item) => item.id !== script.id), script], removedBuiltinIds: state.removedBuiltinIds.filter((id) => id !== script.id) })),
    remove: (id) => updateCallScripts((state) => ({ scripts: state.scripts.filter((item) => item.id !== id), removedBuiltinIds: builtinCallScripts.some((item) => item.id === id) ? [...new Set([...state.removedBuiltinIds, id])] : state.removedBuiltinIds })),
    restore: (id) => updateCallScripts((state) => ({ scripts: state.scripts.filter((item) => item.id !== id), removedBuiltinIds: state.removedBuiltinIds.filter((item) => item !== id) })),
    importScripts: (scripts) => updateCallScripts((state) => {
        const names = new Set(listCallScripts(state.scripts).map((item) => item.name));
        const imported = scripts.map((script) => {
            let name = script.name;
            for (let index = 2; names.has(name); index++) name = `${script.name} (${index})`;
            names.add(name);
            return { ...script, id: nanoid(), name };
        });
        return { scripts: [...state.scripts, ...imported], removedBuiltinIds: state.removedBuiltinIds };
    }),
}));

export const callScriptsReady = storage.state.getItem<string>(directoryKey).then((value) => {
    if (!value) return;
    const record = JSON.parse(value) as { state: ScriptDirectory; version: number };
    if (record.version === 1) useCallScriptStore.setState(record.state);
});
export let callScriptsSaved = callScriptsReady;

export function setPluginCallScripts(pluginScripts: CallScript[]) {
    return updateCallScripts((state) => ({ scripts: state.scripts, removedBuiltinIds: state.removedBuiltinIds, pluginScripts }));
}

export function listCallScripts(saved: CallScript[] = useCallScriptStore.getState().scripts, removedBuiltinIds: string[] = useCallScriptStore.getState().removedBuiltinIds, pluginScripts: CallScript[] = useCallScriptStore.getState().pluginScripts): CallScript[] {
    return [...builtinCallScripts.filter((script) => !removedBuiltinIds.includes(script.id)), ...pluginScripts, ...saved];
}
