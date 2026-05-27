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
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-stone-950/70 px-4 py-6 backdrop-blur-md">
            <div className="relative flex aspect-video w-[min(66.666vw,1080px)] max-h-[86vh] min-w-[320px] flex-col overflow-hidden rounded-[28px] border border-white/30 bg-white/95 shadow-[0_30px_100px_rgba(0,0,0,.35)] dark:border-white/10 dark:bg-stone-950/95">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(250,204,21,.18),transparent_34%),radial-gradient(circle_at_95%_10%,rgba(56,189,248,.16),transparent_30%)]" />
                <div className="relative flex items-center justify-between gap-4 border-b border-stone-200/70 px-7 py-5 dark:border-white/10">
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.32em] text-stone-400 dark:text-stone-500">Announcement</div>
                        <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">{current.title}</h2>
                    </div>
                    <button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition hover:bg-stone-950 hover:text-white dark:bg-white/10 dark:text-stone-300 dark:hover:bg-white dark:hover:text-stone-950" onClick={close} aria-label="关闭公告">
                        <X className="size-4" />
                    </button>
                </div>
                <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 py-6">
                    <AnnouncementContent content={current.content} />
                </div>
                <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/70 px-7 py-4 dark:border-white/10">
                    <div className="text-xs text-stone-400 dark:text-stone-500">
                        {visibleItems.length > 1 ? `${index + 1} / ${visibleItems.length}` : "今日公告"}
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={hideToday}>今日不再弹出</Button>
                        <Button type="primary" onClick={next}>
                            确认
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AnnouncementContent({ content }: { content: string }) {
    return <div className="announcement-content text-sm leading-7 text-stone-700 dark:text-stone-200" dangerouslySetInnerHTML={{ __html: renderAnnouncementContent(content) }} />;
}

function renderAnnouncementContent(content: string) {
    const value = content.trim();
    if (looksLikeHTML(value)) return value;
    return markdownToHTML(value);
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
