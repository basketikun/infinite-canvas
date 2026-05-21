import { useCallback, useEffect, useMemo, useState } from "react";

import { parseChangelog, type ReleaseInfo } from "@/lib/release-info";

const latestVersionUrl = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/VERSION";
const latestChangelogUrl = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/CHANGELOG.md";

function readLocalReleases(): ReleaseInfo[] {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_APP_RELEASES || "[]");
  } catch {
    return [];
  }
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

export function useVersionCheck(currentVersion: string) {
  const localReleases = useMemo(readLocalReleases, []);
  const [latestVersion, setLatestVersion] = useState(currentVersion);
  const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
  const [checking, setChecking] = useState(false);
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

  const checkLatestRelease = useCallback(async () => {
    setChecking(true);
    try {
      const [versionResponse, changelogResponse] = await Promise.all([
        fetch(latestVersionUrl),
        fetch(latestChangelogUrl),
      ]);
      if (!versionResponse.ok) throw new Error("版本读取失败");
      if (!changelogResponse.ok) throw new Error("更新日志读取失败");
      const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
      setLatestVersion(version.trim() || currentVersion);
      if (changelog.trim()) setReleases(parseChangelog(changelog));
      return true;
    } catch {
      setLatestVersion(currentVersion);
      setReleases(localReleases);
      return false;
    } finally {
      setChecking(false);
    }
  }, [currentVersion, localReleases]);

  useEffect(() => {
    void checkLatestVersion();
  }, [checkLatestVersion]);

  return { latestVersion, releases, checking, hasNewVersion, checkLatestRelease };
}
