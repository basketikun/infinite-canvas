"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import { Dropdown } from "antd";
import type { ItemType } from "antd/es/menu/interface";

import Link from "next/link";

import { GitHubLink } from "@/components/github-link";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { VersionReleaseModal } from "@/components/version-release-modal";
import { cn } from "@/lib/utils";
import type { ThemeName } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
  version: string;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  userName?: string;
  initial?: string;
  menuItems: ItemType[];
  accountOpen?: boolean;
  onAccountOpenChange?: (open: boolean) => void;
  accountRef?: RefObject<HTMLDivElement | null>;
  getPopupContainer?: (node: HTMLElement) => HTMLElement;
  avatarClassName?: string;
  avatarStyle?: CSSProperties;
  gitHubClassName?: string;
  gitHubStyle?: CSSProperties;
  versionStyle?: CSSProperties;
  userLabel?: ReactNode;
  iconStyle?: CSSProperties;
};

export function UserStatusActions({
  version,
  theme,
  onThemeChange,
  userName,
  initial,
  menuItems,
  accountOpen,
  onAccountOpenChange,
  accountRef,
  getPopupContainer,
  avatarClassName,
  avatarStyle,
  gitHubClassName,
  gitHubStyle,
  versionStyle,
  userLabel,
  iconStyle,
}: UserStatusActionsProps) {
  const avatarText = initial || (userName?.trim()[0] || "U").toUpperCase();
  const naturalIconClass = "inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";

  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <AnimatedThemeToggler
        theme={theme}
        onThemeChange={onThemeChange}
        className={naturalIconClass}
        style={iconStyle}
        aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
        title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
      />
      <Link
        href="/changelog"
        title="查看更新日志"
        className="shrink-0 text-xs font-medium text-stone-500 underline-offset-4 transition hover:text-stone-900 hover:underline dark:text-stone-400 dark:hover:text-stone-100"
      >
        {version}
      </Link>
      <VersionReleaseModal currentVersion={version} style={versionStyle} />
      <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
      <div ref={accountRef}>
        <Dropdown
          open={accountOpen}
          onOpenChange={onAccountOpenChange}
          trigger={["click"]}
          placement="bottomRight"
          getPopupContainer={getPopupContainer}
          styles={{ root: { minWidth: 150 } }}
          menu={{ items: menuItems }}
        >
          <button
            type="button"
            className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-transparent p-0 text-xs font-semibold leading-none text-stone-800 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:text-stone-100 dark:hover:border-stone-400 dark:hover:text-white", avatarClassName)}
            style={avatarStyle}
            aria-label="账户菜单"
          >
            <span className="leading-none">{userLabel ?? avatarText}</span>
          </button>
        </Dropdown>
      </div>
    </div>
  );
}
