import { useCallback, useRef, type CSSProperties } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";

import { useVersionCheck } from "@workbench/hooks/use-version-check";
import { APP_VERSION } from "@workbench/constant/env";
import "./version-release-modal.css";

function getTagColor(type: string) {
    if (type === "新增" || type === "Added") return "green";
    if (type === "修复" || type === "Fixed") return "red";
    if (type === "调整" || type === "Changed") return "blue";
    if (type === "文档" || type === "Docs") return "purple";
    return "default";
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { open, setOpen, openReleaseModal, latestVersion, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck();
    const trigger = useRef<HTMLButtonElement>(null);
    const scrollTop = useRef(0);
    const restoreScroll = useCallback((element: HTMLDivElement | null) => {
        if (element) element.scrollTop = scrollTop.current;
    }, []);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => next ? openReleaseModal() : setOpen(false)}>
            <Dialog.Trigger asChild>
                <button ref={trigger} type="button" title="查看版本更新" style={style}
                    className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}>
                    <span className="relative inline-flex">
                        {APP_VERSION}
                        {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                    </span>
                </button>
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[1000] bg-black/45" />
                <Dialog.Content aria-describedby={undefined}
                    onOpenAutoFocus={(event) => {
                        if (trigger.current?.matches(":focus-visible") && event.currentTarget instanceof HTMLElement) {
                            event.preventDefault();
                            event.currentTarget.focus({ preventScroll: true });
                        }
                    }}
                    className="workbench-dialog fixed left-1/2 top-1/2 z-[1000] flex max-h-[calc(100dvh_-_16px)] w-[calc(100%_-_16px)] max-w-[680px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[8px] bg-(--workbench-elevated-panel) px-6 py-5 text-(--workbench-elevated-text) outline-none focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-primary">
                    <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded text-current/50 transition hover:bg-muted hover:text-current">
                        <X aria-hidden className="size-5" />
                    </Dialog.Close>
                    <Dialog.Title className="mb-2 shrink-0 text-base font-semibold leading-6">版本更新</Dialog.Title>
                    <div className="mb-5 grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="text-xs text-stone-500 dark:text-stone-400">当前版本</div>
                            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{APP_VERSION}</div>
                        </div>
                        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-stone-500 dark:text-stone-400">最新版本</div>
                                <button type="button" onClick={() => void checkLatestRelease(true)}
                                    className="cursor-pointer bg-transparent p-0 text-[11px] font-normal text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline dark:text-stone-500 dark:hover:text-stone-300">
                                    {checking ? "检查中..." : "检查更新"}
                                </button>
                            </div>
                            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
                        </div>
                    </div>
                    <div ref={restoreScroll} role="region" aria-label="版本记录" tabIndex={0} onScroll={(event) => { scrollTop.current = event.currentTarget.scrollTop; }} className="min-h-0 max-h-[56vh] overflow-y-auto pr-2">
                        <ol className="release-timeline">
                            {/* 远程与本地版本列表切换时，保留正在阅读的时间线行作为滚动锚点。 */}
                            {releases.map((release, index) => (
                                <li key={index}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{release.version === "Unreleased" ? "未发布" : release.version}</span>
                                        <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {release.version === latestVersion ? <span className="release-tag" data-tone="green">最新</span> : null}
                                            {release.version === APP_VERSION ? <span className="release-tag">当前</span> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                <span className="release-tag" data-tone={getTagColor(item.type)}>{item.type}</span>
                                                <span className="min-w-0 flex-1">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
