import { useState, useSyncExternalStore } from "react";
import type { PluginAppearance, PluginContext } from "@infinite-canvas/plugin-sdk";
import { palettes, storePalette } from "../lib/palettes";
import { presets } from "../lib/presets";
import { PaletteEditor } from "./palette-editor";

export function ColorEditor({ ctx }: { ctx: PluginContext }) {
    const appearance = useSyncExternalStore(ctx.appearance.subscribe, ctx.appearance.getSnapshot);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const save = async (palette: PluginAppearance | null) => {
        setSaving(true);
        setError(false);
        try { await storePalette(ctx, appearance!.id, palette); }
        catch { if (!ctx.signal.aborted) setError(true); }
        finally { if (!ctx.signal.aborted) setSaving(false); }
    };
    if (!appearance || !presets.some(({ id }) => id === appearance.id)) return <p className="theme-editor-hint">先在「设置 → 外观」选择本插件的主题，再调整它的配色。</p>;
    return <>
        {error && <p role="alert" className="theme-gallery-error">配色未能保存，请重试。</p>}
        <PaletteEditor key={JSON.stringify(appearance)} appearance={appearance} customized={!!palettes[appearance.id]} saving={saving} onSave={(palette) => void save(palette)} />
    </>;
}
