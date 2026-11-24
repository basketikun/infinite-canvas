import { Component, Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PluginContext, RegisteredContribution } from "@infinite-canvas/plugin-sdk";
import { Aperture } from "lucide-react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { cameraLayouts, layoutResultSchema, sceneSummarySchema, type CameraLayout, type LayoutResult, type SceneSummary } from "../api/camera-layouts";
import type { LayoutRequest } from "../lib/desk-messages";

type LayoutState = { entry: RegisteredContribution<CameraLayout>; generation: number; failed: boolean };
class LayoutBoundary extends Component<{ entry: RegisteredContribution<CameraLayout>; children: ReactNode }, LayoutState> {
    state = { entry: this.props.entry, generation: 0, failed: false };
    static getDerivedStateFromProps({ entry }: { entry: RegisteredContribution<CameraLayout> }, state: LayoutState) {
        return entry === state.entry ? null : { entry, generation: state.generation + 1, failed: false };
    }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: unknown) { console.error("[plugins] camera layout parameters", this.props.entry.pluginId, this.props.entry.id, error); }
    render() { return this.state.failed ? <p role="alert">此布局暂时无法使用，请选择其他布局。</p> : <Fragment key={this.state.generation}>{this.props.children}</Fragment>; }
}

function LayoutForm({ ctx, entry, request }: { ctx: PluginContext; entry: RegisteredContribution<CameraLayout>; request: LayoutRequest }) {
    const [scene, setScene] = useState<SceneSummary | null>(null);
    const [parameters, setParameters] = useState({});
    const [result, setResult] = useState<LayoutResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const active = useRef<AbortController | null>(null);
    const operation = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        active.current = controller;
        const signal = AbortSignal.any([controller.signal, ctx.scope.signal, entry.signal]);
        void request({ action: "summary" }, signal).then(value => {
            signal.throwIfAborted();
            setScene(sceneSummarySchema.parse(value));
        }).catch(error => {
            if (!signal.aborted) {
                console.error("[plugins] director-desk scene summary", error);
                setMessage("场景尚未准备好，请关闭镜头布局后重新打开。");
            }
        });
        return () => controller.abort();
    }, [ctx, entry, request]);
    async function run(apply: boolean) {
        operation.current?.abort();
        const controller = new AbortController();
        operation.current = controller;
        const signal = AbortSignal.any([active.current!.signal, controller.signal, ctx.scope.signal, entry.signal]);
        setBusy(true);
        setMessage("");
        try {
            await ctx.extensions.track(entry, async () => {
                if (apply) {
                    signal.throwIfAborted();
                    await request({ action: "apply-layout", result: result! }, signal);
                    setMessage(`已添加 ${result!.shots.length} 个镜头，可在导演台中撤销。`);
                    setResult(null);
                } else {
                    const parsed = entry.value.parametersSchema.safeParse(parameters);
                    if (!parsed.success) { setMessage("请填写完整的布局参数。"); return; }
                    const current = sceneSummarySchema.parse(await request({ action: "summary" }, signal));
                    setScene(current);
                    const generated = layoutResultSchema.parse(await entry.value.generate({ scene: current, parameters: parsed.data }, { signal }));
                    signal.throwIfAborted();
                    if (generated.sceneId !== current.sceneId) throw new Error("SCENE_CHANGED");
                    setResult(generated);
                }
            });
        } catch (error) {
            if (!signal.aborted) {
                console.error("[plugins] camera layout", entry.pluginId, entry.point, entry.id, error);
                setMessage("镜头布局未完成，请检查目标对象和参数后重试。");
            }
        }
        finally { if (!signal.aborted) setBusy(false); }
    }
    const Parameters = entry.value.Parameters;
    // 打开目标列表前重新读取场景，避免选到已删除的对象。
    const refresh = () => void request({ action: "summary" }, active.current!.signal).then(value => setScene(sceneSummarySchema.parse(value))).catch(() => {});
    return <div className="space-y-3" onPointerDownCapture={refresh}>
        {scene && Parameters && <Parameters scene={scene} value={parameters} onChange={value => { operation.current?.abort(); setBusy(false); setParameters(value); setResult(null); setMessage(""); }} />}
        {result && <p className="text-sm">将新增 {result.shots.length} 个镜头。</p>}
        <Button variant="ghost" size="sm" disabled={!scene || busy} onClick={() => void run(Boolean(result))}>{busy ? "正在处理…" : result ? "添加镜头" : "生成布局"}</Button>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>;
}

export function CameraLayouts({ ctx, request }: { ctx: PluginContext; request: LayoutRequest }) {
    const subscribe = useCallback((listener: () => void) => ctx.extensions.subscribe(cameraLayouts, ctx.scope, listener), [ctx]);
    const snapshot = useCallback(() => ctx.extensions.query(cameraLayouts, ctx.scope), [ctx]);
    const entries = useSyncExternalStore(subscribe, snapshot);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const entry = entries.find(item => item.id === selected);
    if (!entries.length) return null;
    return <div style={{ position: "absolute", top: 0, right: "clamp(72px, 11vw, 126px)", height: 46, zIndex: 1, display: "grid", alignItems: "center" }} className="text-foreground"><Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" aria-label="镜头布局" title="镜头布局"><Aperture size={15} /><span className="hidden sm:inline">镜头布局</span></Button></PopoverTrigger>
        <PopoverContent align="end" aria-label="镜头布局" className="w-80 space-y-3 p-3">
            <Select value={entry?.id ?? ""} onValueChange={setSelected}>
                <SelectTrigger className="w-full" aria-label="布局方式"><SelectValue placeholder="选择布局方式" /></SelectTrigger>
                <SelectContent>{entries.map(item => <SelectItem key={item.id} value={item.id}>{item.value.title}</SelectItem>)}</SelectContent>
            </Select>
            {open && entry && <LayoutBoundary entry={entry}><LayoutForm ctx={ctx} entry={entry} request={request} /></LayoutBoundary>}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>关闭</Button>
        </PopoverContent>
    </Popover></div>;
}
