import { useState } from "react";
import type { PluginAppearance } from "@infinite-canvas/plugin-sdk";

const labels = { background: "工作台背景", panel: "面板背景", surface: "控件底色", text: "正文", muted: "次要文字", border: "边框", accent: "强调色", accentText: "强调色上的文字" } as const;
const canvasFields = [
    ["canvas", "background", "画布背景", "background"], ["canvas", "dot", "网格点", "border"],
    ["canvas", "line", "网格线", "border"], ["node", "panel", "节点面板", "panel"], ["node", "activeStroke", "选中描边", "accent"],
    ["toolbar", "panel", "工具栏背景", "panel"],
] as const;

export function PaletteEditor({ appearance, customized, saving, onSave }: { appearance: PluginAppearance; customized: boolean; saving: boolean; onSave: (palette: PluginAppearance | null) => void }) {
    const [draft, setDraft] = useState(appearance);
    return <fieldset className="theme-editor" disabled={saving}>
        <legend>工作台配色</legend>
        <div className="theme-color-grid">{(Object.keys(labels) as Array<keyof typeof labels>).map((key) => <label key={key}>
            {labels[key]}<input type="color" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        </label>)}</div>
        <h2>画布细节</h2>
        <div className="theme-color-grid">{canvasFields.map(([section, token, title, base]) => {
            const colors: Record<string, string> = draft.canvasTheme?.[section] ?? {};
            return <label key={section + token}>{title}<input type="color" value={colors[token] ?? draft[base]} onChange={(event) => setDraft({
                ...draft, canvasTheme: { ...draft.canvasTheme, [section]: { ...colors, [token]: event.target.value } },
            })} /></label>;
        })}</div>
        <div className="theme-color-preview" style={{ background: draft.canvasTheme?.canvas?.background ?? draft.background, color: draft.text }}>
            <div style={{ background: draft.canvasTheme?.node?.panel ?? draft.panel, borderColor: draft.canvasTheme?.node?.activeStroke ?? draft.accent }}>
                <strong>配色预览</strong><span style={{ color: draft.muted }}>节点文字与选中效果</span>
                <i style={{ background: draft.accent, color: draft.accentText }}>已选中</i>
            </div>
        </div>
        <div className="theme-editor-buttons">
            <button className="theme-editor-action" disabled={draft === appearance} onClick={() => onSave({ ...draft, useDefaultColors: false })}>应用配色</button>
            <button className="theme-editor-action" disabled={!customized && draft === appearance} onClick={() => { setDraft(appearance); onSave(null); }}>恢复预设配色</button>
        </div>
    </fieldset>;
}
