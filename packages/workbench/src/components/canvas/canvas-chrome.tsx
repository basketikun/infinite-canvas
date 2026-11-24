import { useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import type { CanvasViewController } from "@workbench/lib/canvas/canvas-view";
import { bindHostActions } from "@workbench/lib/canvas/host-actions";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { CanvasTopBar } from "./canvas-top-bar";
import { CanvasZoomControls } from "./canvas-zoom-controls";

const shortcuts = [
    { keys: ["Ctrl / Space", "拖动"], value: "临时切换选择 / 移动" },
    { keys: ["滚轮"], value: "缩放画布" },
    { keys: ["缩放滑杆"], value: "精确调整缩放" },
    { keys: ["拖动"], value: "框选多个节点" },
    { keys: ["Shift / Cmd", "点击"], value: "追加选择节点" },
    { keys: ["Ctrl / Cmd", "A"], value: "全选节点" },
    { keys: ["Ctrl / Cmd", "C / V"], value: "复制 / 粘贴节点，或粘贴剪切板文本/图片" },
    { keys: ["Ctrl / Cmd", "G"], value: "将选中节点打组" },
    { keys: ["Ctrl / Cmd", "Shift", "G"], value: "解散选中的组" },
    { keys: ["Ctrl / Cmd", "Z"], value: "撤销" },
    { keys: ["Ctrl / Cmd", "Shift", "Z"], value: "重做" },
    { keys: ["Ctrl / Cmd", "Y"], value: "重做" },
    { keys: ["Delete / Backspace"], value: "删除选中" },
    { keys: ["Esc"], value: "取消选择并关闭浮层" },
    { keys: ["拖入图片/视频/音频"], value: "上传到画布" },
];

export function CanvasChrome({ session, view }: { session: CanvasSession; view: CanvasViewController }) {
    const [open, setOpen] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useLayoutEffect(() => bindHostActions(session, { canvasOpenShortcuts: () => setOpen(true) }), [session]);

    return <>
        <CanvasTopBar canvasScope={view.scope} />
        <CanvasZoomControls session={session} view={view} shortcutsOpen={open} />
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[1000] bg-black/45" />
                <Dialog.Content aria-describedby={undefined}
                    onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
                    }}
                    className="workbench-dialog fixed left-1/2 top-1/2 z-[1000] flex max-h-[calc(100dvh_-_16px)] w-[calc(100%_-_16px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none">
                    <Dialog.Title className="mb-2 shrink-0 text-base font-semibold">快捷键</Dialog.Title>
                    <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded text-current/50 transition hover:bg-muted hover:text-current"><X aria-hidden className="size-5" /></Dialog.Close>
                    <div className="thin-scrollbar min-h-0 space-y-2 overflow-y-auto border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                        {shortcuts.map(({ keys, value }) => <div key={keys.join("+")} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                {keys.map((key, index) => <span key={key} className="flex items-center gap-1.5">
                                    {index ? <span className="text-xs opacity-35">+</span> : null}
                                    <kbd className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel, color: theme.node.text }}>{key}</kbd>
                                </span>)}
                            </span>
                            <span className="text-right text-sm opacity-55">{value}</span>
                        </div>)}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    </>;
}
