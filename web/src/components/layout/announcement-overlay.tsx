"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { App, Button } from "antd";

import { fetchAnnouncements } from "@/services/api/announcements";
import type { Announcement } from "@/services/api/admin";

const storageKey = "infinite-canvas:announcement_hidden_until";

export function AnnouncementOverlay() {
    const { message } = App.useApp();
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [index, setIndex] = useState(0);
    const visibleItems = useMemo(() => announcements.filter((item) => item.title && item.content), [announcements]);
    const current = visibleItems[index];

    useEffect(() => {
        if (isSuppressedToday()) return;
        void fetchAnnouncements()
            .then((items) => setAnnouncements(items || []))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取公告失败"));
    }, [message]);

    const close = () => setAnnouncements([]);
    const next = () => {
        if (index + 1 >= visibleItems.length) close();
        else setIndex((value) => value + 1);
    };
    const hideToday = () => {
        window.localStorage.setItem(storageKey, nextLocalDayStart().toISOString());
        close();
    };

    if (!current) return null;

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-stone-950/70 px-2 py-2 backdrop-blur-md sm:px-4 sm:py-6">
            <div className="relative flex h-[min(86vh,calc((66.666vw)*9/16))] max-h-[86vh] min-h-[360px] w-[min(66.666vw,1080px)] min-w-[320px] flex-col overflow-hidden rounded-[28px] border border-white/30 bg-white/95 shadow-[0_30px_100px_rgba(0,0,0,.35)] dark:border-white/10 dark:bg-stone-950/95 max-sm:h-[calc(100dvh-1rem)] max-sm:max-h-[calc(100dvh-1rem)] max-sm:min-h-0 max-sm:w-[calc(100vw-1rem)] max-sm:min-w-0 max-sm:rounded-2xl sm:aspect-video sm:h-auto">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(250,204,21,.18),transparent_34%),radial-gradient(circle_at_95%_10%,rgba(56,189,248,.16),transparent_30%)]" />
                <div className="relative flex shrink-0 items-center justify-between gap-2 border-b border-stone-200/70 px-3 py-2 dark:border-white/10 sm:gap-4 sm:px-7 sm:py-5">
                    <div className="min-w-0 flex-1">
                        <div className="hidden text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 dark:text-stone-500 sm:block sm:text-xs sm:tracking-[0.32em]">Announcement</div>
                        <h2 className="line-clamp-1 text-base font-semibold leading-tight tracking-tight text-stone-950 dark:text-stone-50 sm:mt-1 sm:truncate sm:text-2xl">{current.title}</h2>
                    </div>
                    <button type="button" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition hover:bg-stone-950 hover:text-white dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white dark:hover:text-stone-950 sm:size-9" onClick={close} aria-label="关闭公告">
                        <X className="size-4" />
                    </button>
                </div>
                <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 sm:px-7 sm:py-6">
                    <AnnouncementContent content={current.content} />
                </div>
                <div className="relative flex shrink-0 items-center gap-2 border-t border-stone-200/70 px-3 py-2 dark:border-white/10 sm:justify-between sm:gap-3 sm:px-7 sm:py-4">
                    <div className="hidden text-center text-[11px] text-stone-400 dark:text-stone-500 sm:block sm:text-left sm:text-xs">
                        {visibleItems.length > 1 ? `${index + 1} / ${visibleItems.length}` : "今日公告"}
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:flex sm:flex-none">
                        <Button className="h-8 min-w-0 px-2 text-xs sm:h-auto sm:text-sm" onClick={hideToday}>今日不再弹出</Button>
                        <Button className="h-8 min-w-0 px-2 text-xs sm:h-auto sm:text-sm" type="primary" onClick={next}>
                            确认
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AnnouncementContent({ content }: { content: string }) {
    return <div className="announcement-content text-[13px] leading-6 text-stone-700 dark:text-stone-200 sm:text-sm sm:leading-7" dangerouslySetInnerHTML={{ __html: renderAnnouncementContent(content) }} />;
}

function renderAnnouncementContent(content: string) {
    const value = normalizeLineBreaks(content).trim();
    if (!value) return "";
    if (looksLikeHTML(value)) return normalizeHTMLBreaks(value);
    return markdownToHTML(normalizeBreakTags(value));
}

function markdownToHTML(value: string) {
    const escaped = escapeHTML(value);
    const withBlocks = escaped
        .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
        .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
        .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return withBlocks
        .split(/\n{2,}/)
        .map((block) => (block.startsWith("<h") ? block : `<p>${block.replace(/\n/g, "<br />")}</p>`))
        .join("");
}

function looksLikeHTML(value: string) {
    return /<([a-z][\w-]*)(\s|>|\/)/i.test(value);
}

function normalizeLineBreaks(value: string) {
    return value.replace(/\r\n|\r/g, "\n").replace(/\\r\\n|\\n|\\r/g, "\n");
}

function normalizeBreakTags(value: string) {
    return value.replace(/<\s*\/?\s*br\s*\/?\s*>/gi, "\n");
}

function normalizeHTMLBreaks(value: string) {
    return normalizeBreakTags(value).replace(/\n/g, "<br />");
}

function escapeHTML(value: string) {
    return value.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

const htmlEntities: Record<string, string> = {
    "&": String.fromCharCode(38, 97, 109, 112, 59),
    "<": String.fromCharCode(38, 108, 116, 59),
    ">": String.fromCharCode(38, 103, 116, 59),
    [String.fromCharCode(34)]: String.fromCharCode(38, 113, 117, 111, 116, 59),
    "'": String.fromCharCode(38, 35, 48, 51, 57, 59),
};

function isSuppressedToday() {
    const value = window.localStorage.getItem(storageKey);
    return value ? new Date(value).getTime() > Date.now() : false;
}

function nextLocalDayStart() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
    return date;
}
