import { App, Button, Empty, Popconfirm, Spin, Tooltip } from "antd";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AppLocale } from "@/i18n";
import { clearAppSyncTrash, listAppSyncTrash, restoreAppSyncTrashEntry, type AppSyncDomainKey, type AppSyncTrashListEntry } from "@/services/app-sync";
import { useConfigStore } from "@/stores/use-config-store";

function domainLabelKey(domain: AppSyncDomainKey) {
    if (domain === "image-workbench") return "imageWorkbench";
    if (domain === "video-workbench") return "videoWorkbench";
    return domain;
}

function formatTrashTime(value: string, locale: AppLocale) {
    return new Date(value).toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function WebdavTrashPanel({ active, disabled, refreshKey }: { active: boolean; disabled: boolean; refreshKey: number }) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const webdav = useConfigStore((state) => state.webdav);
    const locale = i18n.resolvedLanguage as AppLocale;
    const [entries, setEntries] = useState<AppSyncTrashListEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [restoringKey, setRestoringKey] = useState("");
    const [clearing, setClearing] = useState(false);

    const webdavReady = Boolean(webdav.url.trim());
    const busy = disabled || !webdavReady || loading || clearing || Boolean(restoringKey);

    const webdavRef = useRef(webdav);
    webdavRef.current = webdav;

    const genRef = useRef(0);
    const configFingerprint = `${webdav.url}\0${webdav.directory}\0${webdav.username}\0${webdav.password}`;

    const loadTrash = useCallback(async (silent: boolean) => {
        const config = webdavRef.current;
        if (!config.url.trim()) {
            setEntries([]);
            return;
        }
        const gen = genRef.current += 1;
        setLoading(true);
        try {
            const result = await listAppSyncTrash(config);
            if (gen !== genRef.current) return;
            setEntries(result);
        } catch (error) {
            if (gen !== genRef.current) return;
            setEntries([]);
            if (!silent) message.error(error instanceof Error ? error.message : t("config.webdav.trash.loadFailed"));
        } finally {
            if (gen === genRef.current) setLoading(false);
        }
    }, [message, t]);

    // Invalidate in-flight loads and clear stale rows on any WebDAV config change; no network load triggered.
    useEffect(() => {
        genRef.current += 1;
        setLoading(false);
        setEntries([]);
    }, [configFingerprint]);

    // Auto-load once silently on tab activation or after a successful sync (refreshKey change).
    const prevActiveRef = useRef(false);
    const prevRefreshKeyRef = useRef(refreshKey);
    useEffect(() => {
        const wasActive = prevActiveRef.current;
        prevActiveRef.current = active;
        const refreshKeyChanged = refreshKey !== prevRefreshKeyRef.current;
        prevRefreshKeyRef.current = refreshKey;
        if (!active || !webdavRef.current.url.trim()) return;
        if (!wasActive || refreshKeyChanged) void loadTrash(true);
    }, [active, refreshKey, loadTrash]);

    const handleRestore = async (entry: AppSyncTrashListEntry) => {
        setRestoringKey(entry.key);
        try {
            await restoreAppSyncTrashEntry(webdav, entry.domain, entry.id);
            message.success(t("config.webdav.trash.restoreSuccess"));
            await loadTrash(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.webdav.trash.restoreFailed"));
        } finally {
            setRestoringKey("");
        }
    };

    const handleClear = async () => {
        setClearing(true);
        try {
            await clearAppSyncTrash(webdav);
            message.success(t("config.webdav.trash.clearSuccess"));
            await loadTrash(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.webdav.trash.clearFailed"));
        } finally {
            setClearing(false);
        }
    };

    return (
        <section className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <Trash2 className="size-4" />
                    {t("config.webdav.trash.title")}
                    {entries.length > 0 ? <span className="text-xs font-normal text-stone-500">({entries.length})</span> : null}
                </div>
                <div className="flex items-center gap-1">
                    <Tooltip title={t("config.webdav.trash.refresh")}>
                        <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} disabled={busy} loading={loading} onClick={() => void loadTrash(false)} />
                    </Tooltip>
                    <Popconfirm
                        title={t("config.webdav.trash.clearConfirmTitle")}
                        description={t("config.webdav.trash.clearConfirmContent")}
                        okText={t("config.webdav.trash.clear")}
                        okButtonProps={{ danger: true }}
                        cancelText={t("common.cancel")}
                        disabled={busy || entries.length === 0}
                        onConfirm={() => void handleClear()}
                    >
                        <Button danger size="small" icon={<Trash2 className="size-3.5" />} disabled={busy || entries.length === 0} loading={clearing}>
                            {t("config.webdav.trash.clear")}
                        </Button>
                    </Popconfirm>
                </div>
            </div>
            {loading && entries.length === 0 ? (
                <div className="flex justify-center py-6">
                    <Spin />
                </div>
            ) : entries.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("config.webdav.trash.empty")} className="py-4" />
            ) : (
                <div className="grid gap-1.5">
                    {entries.map((entry) => (
                        <div key={entry.key} className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-stone-700 dark:text-stone-200">{entry.title || entry.id}</div>
                                <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500">
                                    <span>{t(`config.webdav.domains.${domainLabelKey(entry.domain)}`)}</span>
                                    <span>·</span>
                                    <span>{formatTrashTime(entry.deletedAt, locale)}</span>
                                </div>
                            </div>
                            <Tooltip title={t("config.webdav.trash.restore")}>
                                <Button size="small" icon={<RotateCcw className="size-3.5" />} disabled={busy} loading={restoringKey === entry.key} onClick={() => void handleRestore(entry)} />
                            </Tooltip>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}