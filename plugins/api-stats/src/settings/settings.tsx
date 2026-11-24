import { useState } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Label } from "@infinite-canvas/plugin-sdk/ui/label";
import { RadioGroup, RadioGroupItem } from "@infinite-canvas/plugin-sdk/ui/radio-group";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";
import type { PluginContext, PluginSettings } from "@infinite-canvas/plugin-sdk";
import { Overview } from "../components/overview";
import { saveStatisticsSettings, type StatisticsSettings } from "../lib/statistics";
import { statistics } from "../setup";

function StatisticsPreferences({ ctx }: { ctx: PluginContext }) {
    const [value, setValue] = useState<StatisticsSettings>(() => statistics.getSnapshot().settings);
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<"saved" | "failed">();
    return <form className="api-stats-settings" onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setResult(undefined);
        void saveStatisticsSettings(ctx, value).then(() => setResult("saved")).catch((error) => {
            console.error("[api-stats] settings save failed", error);
            setResult("failed");
        }).finally(() => setSaving(false));
    }}>
        <fieldset disabled={saving || ctx.signal.aborted}>
            <legend id="stats-period-label">默认统计时间</legend>
            <RadioGroup aria-labelledby="stats-period-label" value={value.defaultPeriod} disabled={saving || ctx.signal.aborted} className="api-stats-period-options" onValueChange={(period) => { setValue({ ...value, defaultPeriod: period as StatisticsSettings["defaultPeriod"] }); setResult(undefined); }}>
                {Object.entries({ today: "今天", week: "近 7 天", month: "近 30 天", all: "全部时间" }).map(([period, label]) => <Label key={period} htmlFor={`stats-period-${period}`} className="api-stats-period"><RadioGroupItem id={`stats-period-${period}`} value={period} />{label}</Label>)}
            </RadioGroup>
        </fieldset>
        <div className="api-stats-recording">
            <div className="api-stats-recording-label">
                <Label htmlFor="stats-recording">记录新调用</Label>
                <p id="stats-recording-description" className="api-stats-description">暂停后保留已有记录，正在进行的调用仍会记录结果。</p>
            </div>
            <Switch id="stats-recording" aria-describedby="stats-recording-description" checked={value.recordingEnabled} disabled={saving || ctx.signal.aborted} onCheckedChange={(checked) => { setValue({ ...value, recordingEnabled: checked }); setResult(undefined); }} />
        </div>
        <div className="api-stats-recording">
            <div className="api-stats-recording-label">
                <Label htmlFor="stats-payloads">记录请求与返回内容</Label>
                <p id="stats-payloads-description" className="api-stats-description">包含提示词、消息文本、模型返回文本，以及图片、音频和视频调用实际发给模型服务的请求与返回（含服务地址），仅保存在本机插件存储。密钥会打码，图片等文件只保留类型和大小；提示词和返回文本最多保留 8000 字，并保留最近 12 条消息。</p>
            </div>
            <Switch id="stats-payloads" aria-describedby="stats-payloads-description" checked={value.capturePayloads !== false} disabled={saving || ctx.signal.aborted} onCheckedChange={(checked) => { setValue({ ...value, capturePayloads: checked }); setResult(undefined); }} />
        </div>
        <div className="api-stats-recording">
            <div className="api-stats-recording-label">
                <Label htmlFor="stats-sidebar">在侧栏显示调用统计</Label>
                <p id="stats-sidebar-description" className="api-stats-description">开启后侧栏会增加「调用统计」入口，也可以随时在此处的「调用统计」标签页查看。</p>
            </div>
            <Switch id="stats-sidebar" aria-describedby="stats-sidebar-description" checked={value.showInSidebar} disabled={saving || ctx.signal.aborted} onCheckedChange={(checked) => { setValue({ ...value, showInSidebar: checked }); setResult(undefined); }} />
        </div>
        <div className="api-stats-settings-actions"><Button type="submit" disabled={saving || ctx.signal.aborted}>{saving ? "正在保存…" : "保存设置"}</Button>{result ? <span role={result === "failed" ? "alert" : "status"} className="api-stats-caption">{result === "saved" ? "设置已保存" : "设置未能保存，请重试。"}</span> : null}</div>
    </form>;
}

export const settings: PluginSettings = { id: "api-stats:settings", title: "统计设置", Content: StatisticsPreferences };
export const overview: PluginSettings = { id: "api-stats:overview", title: "调用统计", Content: ({ ctx }) => <Overview ctx={ctx} embedded /> };
