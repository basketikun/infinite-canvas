import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import { APP_VERSION } from "@/constant/env";
import { useTranslation } from "@/components/layout/locale-provider";
import { parseChangelog, type ReleaseInfo } from "@/lib/release";

const latestVersionUrl = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/VERSION";
const latestChangelogUrl = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/CHANGELOG.md";

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

async function loadLocalReleases() {
    const module = await import("@/lib/local-releases");
    return module.localReleases;
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>([]);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const checkLatestVersion = useCallback(async () => {
        try {
            const response = await fetch(latestVersionUrl);
            if (!response.ok) return false;
            const version = await response.text();
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
                const [versionResponse, changelogResponse] = await Promise.all([fetch(latestVersionUrl), fetch(latestChangelogUrl)]);
                if (!versionResponse.ok) throw new Error(t("version.versionReadFailed"));
                if (!changelogResponse.ok) throw new Error(t("version.changelogReadFailed"));
                const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
                setLatestVersion(version.trim() || currentVersion);
                if (changelog.trim()) setReleases(parseChangelog(changelog));
                if (showMessage) message.success(t("version.fetched"));
                return true;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(await loadLocalReleases());
                if (showMessage) message.error(t("version.fetchFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, message, t],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        if (!releases.length) {
            void loadLocalReleases().then(setReleases);
        }
        void checkLatestRelease();
    }, [checkLatestRelease, releases.length]);

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
