import { canvasImportMedia } from "@infinite-canvas/plugin-sdk/builtin";
import { useLayoutEffect, useRef, useState } from "react";
import type { CanvasNodeContext, PluginContext } from "@infinite-canvas/plugin-sdk";
import type { DeskAction, LayoutRequest } from "../lib/desk-messages";
import { openNodeScene } from "../lib/scene-data";
import { openSceneLayout } from "../commands/scene-layout";
import { CameraLayouts } from "./camera-layouts";
import studioDocument from "director-studio:document";

type StudioProps = { ctx: PluginContext; node: CanvasNodeContext; onClose(): void };

export function Studio({ ctx, node, onClose }: StudioProps) {
    const sceneId = `canvas:${ctx.scope.projectId}:${node.node.id}`;
    const container = useRef<HTMLDivElement>(null);
    const [request, setRequest] = useState<LayoutRequest | null>(null);
    const session = useRef({ node, onClose });
    session.current = { node, onClose };
    useLayoutEffect(() => {
        if (ctx.scope.signal.aborted) return;
        const { node: owner, onClose: close } = session.current;
        const controller = new AbortController();
        const signal = AbortSignal.any([owner.scope.signal, ctx.scope.signal, controller.signal]);
        const data = openNodeScene(owner, signal);
        const frame = document.createElement("iframe");
        frame.title = "3D 导演台";
        frame.setAttribute("sandbox", "allow-scripts allow-downloads");
        frame.style.cssText = "display:block;width:100%;height:100%;border:0";
        let lastWrite: Promise<void> = Promise.resolve();
        const waitForWrites = ctx.onDispose(async () => { await lastWrite.catch(() => {}); });
        const channel = new MessageChannel();
        const port = channel.port1;
        const pending = new Map<string, (data: { ok: boolean; value: unknown }) => void>();
        const requestLayout: LayoutRequest = (action, callerSignal) => new Promise((resolve, reject) => {
            const active = AbortSignal.any([signal, callerSignal]);
            active.throwIfAborted();
            const requestId = crypto.randomUUID();
            const abort = () => { pending.delete(requestId); reject(active.reason); };
            active.addEventListener("abort", abort, { once: true });
            pending.set(requestId, data => {
                active.removeEventListener("abort", abort);
                pending.delete(requestId);
                if (data.ok) resolve(data.value);
                else reject(new Error("LAYOUT_REQUEST_FAILED"));
            });
            port.postMessage({ ...action, requestId, sceneId });
        });
        const theme = () => {
            const colors = ctx.appearance.getSnapshot();
            port.postMessage({ theme: document.documentElement.classList.contains("dark") ? "dark" : "light", colors: colors?.useDefaultColors ? null : colors });
        };
        const appearance = new MutationObserver(theme);
        async function handle(message: DeskAction) {
            signal.throwIfAborted();
            switch (message.action) {
                case "load": {
                    return { ...await data.load(), sceneId };
                }
                case "save": {
                    lastWrite = lastWrite.catch(() => {}).then(() => data.save(message.scene, message.added));
                    return lastWrite;
                }
                case "background": {
                    const image = owner.getUpstream().find(item => item.type === "image");
                    if (!image?.metadata) throw new Error("IMAGE_REQUIRED");
                    const file = await ctx.images.read(image.metadata.storageKey, image.metadata.content, signal);
                    return { name: image.title, file };
                }
                case "captures":
                case "recording": {
                    const items = message.action === "recording" ? [message] : message.items;
                    const files = items.map(item => new File([item.file], item.name, { type: item.file.type }));
                    await ctx.commands.execute(canvasImportMedia, { sourceNodeId: owner.node.id, files }, { scope: ctx.scope, signal });
                    return;
                }
                case "close": close(); return;
            }
        }
        let releaseCommands: (() => void) | undefined;
        port.onmessage = async ({ data }) => {
            if (signal.aborted) return;
            if (data.ready && data.sceneId === sceneId) {
                if (!releaseCommands) releaseCommands = openSceneLayout(ctx, sceneId, requestLayout, signal);
                setRequest(() => requestLayout);
                return;
            }
            if (data.requestId) { if (data.sceneId === sceneId) pending.get(data.requestId)?.(data); return; }
            try {
                const value = await handle(data);
                if (!signal.aborted) port.postMessage({ id: data.id, ok: true, value });
            } catch (error) {
                if (!signal.aborted) {
                    console.error("[plugins] director-desk scene", data.action, error);
                    port.postMessage({ id: data.id, ok: false });
                }
            }
        };
        frame.onload = () => {
            if (signal.aborted) return;
            frame.contentWindow?.postMessage("director-desk:open", "*", [channel.port2]);
            theme();
        };
        frame.srcdoc = studioDocument;
        container.current!.append(frame);
        appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        return () => { controller.abort(); releaseCommands?.(); setRequest(null); appearance.disconnect(); void waitForWrites(); port.close(); frame.onload = null; frame.remove(); };
    }, [ctx, sceneId]);
    return <div className="relative flex h-full w-full flex-col">
        {request && <CameraLayouts key={sceneId} ctx={ctx} request={request} />}
        <div ref={container} className="min-h-0 flex-1" />
    </div>;
}
