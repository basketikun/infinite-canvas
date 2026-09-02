import { useEffect, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";

import { h3LoraOptions, h3ModelOptions } from "../constants";
import { discoverH3Models, mergeH3Options } from "../services/model-discovery";
import { normalizeH3Model } from "../services/h3-compatibility";
import type { H3Segment } from "../types";

type Props = { ctx: CanvasNodeContext; metadata: Record<string, unknown>; segment?: H3Segment; patch: (value: Partial<H3Segment>) => void };

export function ClipSettings({ ctx, metadata, segment, patch }: Props) {
    const [comfyModels, setComfyModels] = useState<{ models: string[]; loras: string[] }>({ models: [], loras: [] });
    useEffect(() => {
        let active = true;
        void discoverH3Models(ctx).then((value) => { if (active) setComfyModels(value); });
        return () => { active = false; };
    // CanvasNodeContext is recreated on every canvas render. Depending on
    // ctx.ai here would therefore re-run the effect after setState forever.
    // The ComfyUI catalog is loaded once when the settings component mounts.
    }, []);
    if (!segment) return null;
    const field = { width: "100%", minWidth: 0, boxSizing: "border-box", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, padding: "4px 5px", background: ctx.theme.node.panel, color: ctx.theme.node.text, fontSize: 10 } as const;
    const labelFor = (value: string) => value.replace(/^.*[\\/]/, "");
    const modelOptions = mergeH3Options(h3ModelOptions, comfyModels.models, labelFor);
    const loraOptions = mergeH3Options(h3LoraOptions, comfyModels.loras, labelFor);
    return <div className="minimax-settings-extra" style={{ display: "contents" }}>
        <label className="minimax-wide-setting"><span>Task mode</span><select value={String(segment.taskMode || "r2v")} onChange={(event) => patch({ taskMode: event.target.value })} style={field}><option value="t2v">文生视频</option><option value="i2v">图生视频</option><option value="fl2v">首尾帧生视频</option><option value="r2v">参考主体</option><option value="v2v">视频编辑</option><option value="rv2v">参考素材改视频</option></select></label>
        <label className="minimax-wide-setting"><span>Payment</span><select value={String(metadata.rhPayment || "free")} onChange={(event) => ctx.updateMetadata({ rhPayment: event.target.value })} style={field}><option value="free">Free</option><option value="wallet">Wallet</option></select></label>
        <label><span>LoRA</span><select value={String(segment.loraName ?? metadata.loraName ?? "")} onChange={(event) => patch({ loraName: event.target.value })} style={field}>{loraOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="minimax-wide-setting"><span>Base model</span><select value={normalizeH3Model(segment.modelName || metadata.minimaxBaseModel || metadata.modelName)} onChange={(event) => patch({ modelName: event.target.value })} style={field}>{modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Video steps</span><input type="number" min="1" max="60" value={Number(segment.videoSteps || (segment.loraName ? 8 : 20))} onChange={(event) => patch({ videoSteps: Number(event.target.value) })} style={field} /></label>
        <label><span>Denoise</span><input type="number" min="0" max="1" step="0.05" value={Number(segment.denoise ?? metadata.denoise ?? 0.65)} onChange={(event) => patch({ denoise: Number(event.target.value) })} style={field} /></label>
        <label><span>Seed mode</span><select value={segment.noiseSeedMode === "fixed" ? "fixed" : "random"} onChange={(event) => patch({ noiseSeedMode: event.target.value as "random" | "fixed", noiseSeed: event.target.value === "fixed" ? (segment.noiseSeed ?? segment.seed ?? Math.floor(Math.random() * 4294967296)) : undefined })} style={field}><option value="random">随机</option><option value="fixed">固定</option></select></label>
        {segment.noiseSeedMode === "fixed" ? <label><span>Seed</span><input type="number" min="0" max="4294967295" value={String(segment.noiseSeed ?? segment.seed ?? "")} onChange={(event) => patch({ noiseSeed: event.target.value, seed: event.target.value })} style={field} /></label> : null}
        <label><span>TE speed</span><select value={segment.teAccel === true ? "fast" : "std"} onChange={(event) => patch({ teAccel: event.target.value === "fast" })} style={field}><option value="std">std</option><option value="fast">fast</option></select></label>
        <label><span>Combat LoRA</span><input type="number" min="0" max="2" step="0.01" value={Number(segment.combatLoraWeight || 0)} onChange={(event) => patch({ combatLoraWeight: Number(event.target.value) })} style={field} /></label>
        <label><span>Cinematic LoRA</span><input type="number" min="0" max="2" step="0.01" value={Number(segment.cinematicLoraWeight || 0)} onChange={(event) => patch({ cinematicLoraWeight: Number(event.target.value) })} style={field} /></label>
        <SettingToggle ctx={ctx} label="Motion Context" value={segment.motionContextEnabled !== false} onChange={(value) => patch({ motionContextEnabled: value, tailFrameEnabled: value })} />
        <SettingToggle ctx={ctx} label="防朗读" value={segment.noDub !== false} onChange={(value) => patch({ noDub: value })} />
        <SettingToggle ctx={ctx} label="无字幕水印" value={segment.noCaption !== false} onChange={(value) => patch({ noCaption: value })} />
        <label><span>Global MP</span><input type="number" min="0.1" max="2" step="0.1" value={Number(metadata.minimaxGlobalMegapixels || metadata.megapixels || 1)} onChange={(event) => ctx.updateMetadata({ minimaxGlobalMegapixels: Number(event.target.value) })} style={field} /></label>
        <label><span>Global steps</span><input type="number" min="1" max="60" value={Number(metadata.minimaxGlobalVideoSteps || metadata.videoSteps || 6)} onChange={(event) => ctx.updateMetadata({ minimaxGlobalVideoSteps: Number(event.target.value) })} style={field} /></label>
        <SettingToggle ctx={ctx} label="Global LoRA" value={metadata.minimaxGlobalLoraEnabled !== false} onChange={(value) => ctx.updateMetadata({ minimaxGlobalLoraEnabled: value })} />
        <SettingToggle ctx={ctx} label="Global TE" value={metadata.minimaxGlobalTeAccel === true} onChange={(value) => ctx.updateMetadata({ minimaxGlobalTeAccel: value })} />
        <button type="button" className="minimax-run-all" onClick={() => { ctx.openPanel(); setTimeout(() => ctx.emit("minimax-h3:run-all", { nodeId: ctx.node.id }), 0); }}>一键运行全部 Clip</button>
    </div>;
}

function SettingToggle({ ctx, label, value, onChange }: { ctx: CanvasNodeContext; label: string; value: boolean; onChange: (value: boolean) => void }) {
    return <button type="button" onClick={() => onChange(!value)} style={{ border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 5, padding: "4px 6px", background: value ? ctx.theme.node.panel : ctx.theme.node.fill, color: ctx.theme.node.text, fontSize: 10, cursor: "pointer" }}>{value ? "●" : "○"} {label}</button>;
}
