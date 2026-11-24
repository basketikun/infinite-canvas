import { network } from "@workbench/services/network/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { APP_VERSION } from "@workbench/constant/env";
import { parseChangelog, type ReleaseInfo } from "@workbench/lib/release";

const latestVersionUrl = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/VERSION";
const latestChangelogUrl = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/CHANGELOG.md";

function readLocalReleases(): ReleaseInfo[] {
    return __APP_RELEASES__ || [];
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const checkLatestVersion = useCallback(async (signal: AbortSignal) => {
        try {
            const response = await fetch(network.url(latestVersionUrl), { signal });
            if (!response.ok) return false;
            const version = await response.text();
            signal.throwIfAborted();
            setLatestVersion(version.trim() || currentVersion);
            return true;
        } catch {
            return false;
        }
    }, [currentVersion]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [versionResponse, changelogResponse] = await Promise.all([fetch(network.url(latestVersionUrl)), fetch(network.url(latestChangelogUrl))]);
                if (!versionResponse.ok) throw new Error("版本读取失败");
                if (!changelogResponse.ok) throw new Error("更新日志读取失败");
                const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
                setLatestVersion(version.trim() || currentVersion);
                if (changelog.trim()) setReleases(parseChangelog(changelog));
                if (showMessage) toast.success("已获取最新版本信息", workbenchMessageOptions.success);
                return true;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) toast.error("获取最新版本信息失败", workbenchMessageOptions.error);
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases],
    );

    useEffect(() => {
        const controller = new AbortController();
        void checkLatestVersion(controller.signal);
        return () => controller.abort();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
    };
}
