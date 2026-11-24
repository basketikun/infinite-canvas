import { modelCapabilityLabels } from "@workbench/constant/labels";
import { javascript } from "@codemirror/lang-javascript";
import CodeMirror, { runScopeHandlers, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Textarea } from "@infinite-canvas/plugin-sdk/ui/textarea";
import { ArrowRight, Copy, FileCode2, LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useCopyText } from "@workbench/hooks/use-copy-text";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { getPluginAuthoringPrompt } from "@workbench/services/api/model-plugin";
import { createCallScriptSource } from "@infinite-canvas/model-runtime/call-scripts/template";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { useCallScriptStore } from "@workbench/stores/use-call-script-store";
import { modelCapabilities, type CallScript } from "@infinite-canvas/shared/models";
import { ChannelSegments } from "./channel-segments";
import { ChannelRemoveConfirmation } from "./channel-remove-confirmation";

export function ModelScriptEditor({ value, modelName, container, onSave, onClose }: { value: CallScript; modelName: string; container: HTMLElement; onSave: (script: CallScript) => void; onClose: () => void }) {
    const editorTheme = useThemeStore((state) => state.theme);
    const copyText = useCopyText();
    const editor = useRef<ReactCodeMirrorRef>(null);
    const [draft, setDraft] = useState(value);
    const current = useRef<CallScript | null>(draft);
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);
    useLayoutEffect(() => {
        current.current = draft;
        return () => { current.current = null; };
    }, [draft]);
    const valid = Boolean(draft.name && draft.source);
    const saveDraft = async () => {
        if (pending.current) return;
        pending.current = true;
        setSaving(true);
        try {
            await useCallScriptStore.getState().save(draft);
            if (current.current === draft) onSave(draft);
        } catch {
            if (current.current) toast.error("脚本未保存，请重试", workbenchMessageOptions.error);
        } finally {
            pending.current = false;
            if (current.current) setSaving(false);
        }
    };

    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal container={container}>
                <Dialog.Overlay className="fixed inset-0 z-[1200] bg-black/45" />
                <Dialog.Content aria-describedby={undefined} className="model-script-editor workbench-dialog settings-network generation-workspace-controls fixed inset-0 z-[1200] flex h-dvh flex-col overflow-y-auto bg-(--workbench-elevated-panel) px-6 py-5 outline-none"
                    onEscapeKeyDown={(event) => {
                        event.stopPropagation();
                        const view = editor.current?.view;
                        const target = event.target;
                        // Dialog 在捕获阶段接收 Escape，先让编辑器自己的补全、查找等快捷键处理。
                        if (view && target instanceof Element && view.dom.contains(target) && runScopeHandlers(view, event, target.closest(".cm-search") ? "search-panel" : "editor")) {
                            event.preventDefault();
                        }
                    }} onCloseAutoFocus={(event) => event.preventDefault()}>
                    <Dialog.Close aria-label="关闭" className="absolute top-3 right-3 grid size-8 cursor-pointer place-items-center rounded text-(--channel-tertiary) hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></Dialog.Close>
                    <Dialog.Title className="mb-2 shrink-0 pr-8 text-base leading-6 font-semibold">编辑调用脚本</Dialog.Title>
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="grid min-h-0 overflow-y-auto items-start gap-3 pb-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <label className="grid min-w-0 gap-1 text-xs">
                                脚本名称
                                <Input className="settings-network-field text-sm!" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                            </label>
                            <div className="grid justify-items-start gap-1 text-xs">
                                <span>适用类型</span>
                                <ChannelSegments label="适用类型" value={draft.capability} options={modelCapabilities} labels={modelCapabilityLabels} onChange={(capability) => {
                                    setDraft({ ...draft, capability, source: draft.source === createCallScriptSource(draft.capability) ? createCallScriptSource(capability) : draft.source });
                                }} />
                            </div>
                            <label className="grid min-w-0 gap-1 text-xs sm:col-span-2">
                                说明与调用路径
                                <Textarea rows={1} className="min-h-8 field-sizing-content! resize-none" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                            </label>
                        </div>
                        <div className="flex min-h-min min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-(--channel-line)">
                            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--channel-line) px-3 py-2">
                                <ChannelRemoveConfirmation question="用所选类型的初始模板替换当前源码？保存后才会生效。" onConfirm={() => setDraft({ ...draft, source: createCallScriptSource(draft.capability) })}>
                                    <Button type="button" variant="ghost"><FileCode2 aria-hidden className="size-3.5" />重置为初始模板</Button>
                                </ChannelRemoveConfirmation>
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:ml-auto">
                                    <span className="text-xs leading-5 text-(--channel-secondary)">不知道怎么写？复制说明发给你的 AI，让它帮你完成脚本。</span>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <ArrowRight aria-hidden className="size-4 text-(--channel-secondary)" />
                                        <Button type="button" variant="ghost" onClick={() => void copyText(getPluginAuthoringPrompt(draft.capability, modelName, draft.source), "说明已复制，粘贴给你的 AI，并告诉它你的需求")}><Copy aria-hidden className="size-3.5" />复制说明</Button>
                                    </div>
                                </div>
                            </div>
                            <CodeMirror ref={editor} value={draft.source} onChange={(source) => setDraft((current) => ({ ...current, source }))} height="100%" theme={editorTheme} extensions={[javascript()]} placeholder="// 在这里编写脚本，return 返回生成结果。" className="min-h-lh flex-1 overflow-hidden [contain:size] [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" style={{ fontSize: 13 }} />
                        </div>
                        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 pt-4">
                            <span className="text-xs text-(--channel-secondary)">保存后，所有使用此脚本的模型都会生效。</span>
                            <div className="flex gap-2">
                                <Dialog.Close asChild><Button type="button" variant="outline" aria-label="取消">取 消</Button></Dialog.Close>
                                <Button type="button" aria-label="保存" disabled={!valid} aria-disabled={!valid || saving} aria-busy={saving} onClick={saveDraft}>
                                    {saving && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}保 存
                                </Button>
                            </div>
                        </footer>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
