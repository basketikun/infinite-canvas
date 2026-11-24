import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { X } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@workbench/components/ui/sheet";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import type { PromptSource } from "@workbench/services/api/prompt-source-presets";
import { SettingsNetworkSwitch } from "./settings-network-controls";

const fields = [
    ["name", "来源名称", "用于分类展示"],
    ["url", "JSON URL", "https://example.com/prompts.json"],
    ["homepage", "来源主页（可选）", "https://example.com"],
] as const;

export function PromptSourceEditorDrawer({ open, source, trigger, signal, onSave, onClose }: { open: boolean; source: PromptSource; trigger: HTMLButtonElement; signal: AbortSignal; onSave: (source: PromptSource) => boolean; onClose: () => void }) {
    const [draft, setDraft] = useState(source);
    useLayoutEffect(() => {
        if (open) setDraft(source);
    }, [open, source]);

    const save = () => {
        const name = draft.name.trim();
        const url = draft.url.trim();
        if (!name) return toast.warning("请输入来源名称", workbenchMessageOptions.warning);
        if (!isHttpUrl(url)) return toast.warning("请输入有效的 JSON URL", workbenchMessageOptions.warning);
        if (draft.homepage.trim() && !isHttpUrl(draft.homepage.trim())) return toast.warning("请输入有效的主页地址", workbenchMessageOptions.warning);
        if (onSave({ ...draft, name, url, homepage: draft.homepage.trim(), builtIn: false })) onClose();
    };

    return (
        <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
            <SheetContent container={trigger.closest<HTMLElement>('[role="dialog"]')} showCloseButton={false} aria-describedby={undefined}
                className="settings-network generation-workspace-controls workbench-dialog z-[1100] gap-0 bg-(--workbench-elevated-panel) outline-none data-[side=right]:w-[min(560px,100vw)] data-[side=right]:border-0 data-[side=right]:sm:max-w-none"
                overlayClassName="z-[1100] bg-black/45 supports-backdrop-filter:backdrop-blur-none"
                onEscapeKeyDown={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    if (!signal.aborted && trigger.isConnected && (document.activeElement === document.body || event.currentTarget instanceof HTMLElement && event.currentTarget.contains(document.activeElement))) trigger.focus({ preventScroll: true });
                }}>
                <SheetHeader className="min-h-16 shrink-0 flex-row items-center gap-2 border-b px-6 py-4">
                    <SheetClose aria-label="关闭" className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></SheetClose>
                    <SheetTitle className="mr-auto min-w-0 text-base font-semibold text-inherit">{source.name ? "编辑提示词来源" : "新增提示词来源"}</SheetTitle>
                    <SheetClose asChild><Button type="button" variant="outline" aria-label="取消">取 消</Button></SheetClose>
                    <Button type="button" aria-label="保存" onClick={save}>保 存</Button>
                </SheetHeader>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 pt-4 pb-6">
                    {fields.map(([key, label, placeholder]) => <label key={key} className="block">
                        <span className="mb-1.5 block text-sm font-medium">{label}</span>
                        <Input className="settings-network-field" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} placeholder={placeholder} />
                    </label>)}
                    <div className="flex items-center justify-between border-y border-border py-3">
                        <label htmlFor="prompt-editor-enabled" className="text-sm font-medium">启用来源</label>
                        <SettingsNetworkSwitch id="prompt-editor-enabled" checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
                    </div>
                    <div>
                        <div className="mb-2 text-sm font-medium">JSON 格式</div>
                        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">{`[
  {
    "id": "product-photo-1",
    "title": "Product photo",
    "prompt": "Generate a professional product photo on a white background",
    "description": "",
    "coverUrl": "",
    "referenceImageUrls": [],
    "tags": ["product", "photography"]
  }
]`}</pre>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}

function isHttpUrl(value: string) {
    try {
        return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}
