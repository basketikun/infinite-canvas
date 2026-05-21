"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { App, Modal, Tag, Timeline } from "antd";
import { useVersionCheck } from "@/hooks/use-version-check";

function getTagColor(type: string) {
  if (type === "新增") return "green";
  if (type === "修复") return "red";
  if (type === "调整") return "blue";
  if (type === "文档") return "purple";
  return "default";
}

function getReleaseTitle(version: string) {
  return version === "Unreleased" ? "未发布" : version;
}

type VersionReleaseModalProps = {
  currentVersion: string;
  className?: string;
  style?: CSSProperties;
};

export function VersionReleaseModal({ currentVersion, className, style }: VersionReleaseModalProps) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const { latestVersion, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck(currentVersion);

  const handleCheckLatestRelease = useCallback((showMessage = false) => {
    void checkLatestRelease().then((success) => {
      if (!showMessage) return;
      if (success) message.success("已获取最新版本信息");
      else message.error("获取最新版本信息失败");
    });
  }, [checkLatestRelease, message]);

  useEffect(() => {
    if (!open) return;
    handleCheckLatestRelease();
  }, [handleCheckLatestRelease, open]);

  return (
    <>
      <button
        type="button"
        className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
        style={style}
        onClick={() => setOpen(true)}
        title="查看版本更新"
      >
        <span className="relative inline-flex">
          {currentVersion}
          {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
        </span>
      </button>
      <Modal
        title="版本更新"
        open={open}
        width={680}
        centered
        footer={null}
        onCancel={() => setOpen(false)}
      >
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="text-xs text-stone-500 dark:text-stone-400">当前版本</div>
            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{currentVersion}</div>
          </div>
          <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-stone-500 dark:text-stone-400">最新版本</div>
              <button
                type="button"
                className="cursor-pointer bg-transparent p-0 text-[11px] font-normal text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline dark:text-stone-500 dark:hover:text-stone-300"
                onClick={() => handleCheckLatestRelease(true)}
              >
                {checking ? "检查中..." : "检查更新"}
              </button>
            </div>
            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
          </div>
        </div>
        <div className="max-h-[56vh] overflow-y-auto pr-2">
          <Timeline
            items={releases.map((release) => ({
              content: (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{getReleaseTitle(release.version)}</span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                    <div className="flex min-w-0 items-center gap-1.5">
                      {release.version === latestVersion ? <Tag color="green">最新</Tag> : null}
                      {release.version === currentVersion ? <Tag>当前</Tag> : null}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {release.items.map((item, index) => (
                      <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                        <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">{item.type}</Tag>
                        <span className="min-w-0 flex-1">{item.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            }))}
          />
        </div>
      </Modal>
    </>
  );
}
