"use client";

import { Coins, LogOut, Menu, Shield, UserCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Drawer, Tag, Tooltip } from "antd";

import { GitHubLink } from "@/components/github-link";
import { UserStatusActions } from "@/components/user-status-actions";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { navigationTools, type NavigationToolSlug } from "@/lib/navigation-tools";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";
import { useState } from "react";

type AppTopNavProps = {
  activeToolSlug?: NavigationToolSlug;
  hideHeader?: boolean;
};

export function AppTopNav({ activeToolSlug, hideHeader = false }: AppTopNavProps) {
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const user = useUserStore((state) => state.user);
  const isReady = useUserStore((state) => state.isReady);
  const logout = useUserStore((state) => state.clearSession);

  return (
    <>
      {!hideHeader ? (
        <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
          <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-5 px-6">
            <div className="flex min-w-0 items-center">
              <Link
                href="/"
                className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300"
              >
                <span
                  className="size-5 shrink-0 bg-current"
                  style={{
                    mask: "url(/logo.svg) center / contain no-repeat",
                    WebkitMask: "url(/logo.svg) center / contain no-repeat",
                  }}
                />
                <span className="text-base font-medium">无限画布</span>
              </Link>

              <button
                type="button"
                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开导航菜单"
                title="导航菜单"
              >
                <Menu className="size-5" />
              </button>

              <nav className="hide-scrollbar ml-8 hidden h-16 min-w-0 items-center gap-7 overflow-x-auto md:flex">
                {navigationTools.map((tool) => {
                  const Icon = tool.icon;
                  const active = tool.slug === activeToolSlug;
                  return (
                    <Link
                      key={tool.slug}
                      href={`/${tool.slug}`}
                      className={cn(
                        "relative flex h-16 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                        active
                          ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                          : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="truncate">{tool.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
              {isReady && user ? (
                <>
                  <Tooltip title="点击查看积分流水">
                    <Link href="/profile" className="inline-flex shrink-0">
                      <Tag
                        icon={<Coins className="size-3" />}
                        color={user.role === "admin" ? "gold" : "blue"}
                        className="!m-0 !flex !cursor-pointer !items-center !gap-1 !text-xs"
                      >
                        {user.role === "admin" ? "∞" : `${user.credits ?? 0} 积分`}
                      </Tag>
                    </Link>
                  </Tooltip>
                  <UserStatusActions
                    version={appVersion}
                    theme={theme}
                    onThemeChange={setTheme}
                    userName={user.username}
                    menuItems={[
                      { key: "profile", icon: <UserCircle2 className="size-4" />, label: "个人中心", onClick: () => router.push("/profile") },
                      ...(user.role === "admin" ? [{ key: "admin", icon: <Shield className="size-4" />, label: <Link href="/admin">管理后台</Link> }] : []),
                      { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: logout },
                    ]}
                  />
                </>
              ) : (
                <>
                  <AnimatedThemeToggler
                    theme={theme}
                    onThemeChange={setTheme}
                    className="inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4"
                    aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                    title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                  />
                  <Link
                    href="/changelog"
                    title="查看更新日志"
                    className="shrink-0 text-xs font-medium text-stone-500 underline-offset-4 transition hover:text-stone-900 hover:underline dark:text-stone-400 dark:hover:text-stone-100"
                  >
                    {appVersion}
                  </Link>
                  <GitHubLink />
                  <Link href="/login" className="text-sm font-medium text-stone-600 underline-offset-4 transition hover:text-stone-950 hover:underline dark:text-stone-300 dark:hover:text-stone-100">
                    登录
                  </Link>
                </>
              )}
            </div>
          </div>
        </header>
      ) : null}

      <Drawer
        title="导航"
        placement="left"
        size={280}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        className="md:hidden"
      >
        <div className="space-y-1">
          {navigationTools.map((tool) => {
            const Icon = tool.icon;
            const active = tool.slug === activeToolSlug;
            return (
              <Link
                key={tool.slug}
                href={`/${tool.slug}`}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                  active
                    ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                )}
              >
                <Icon className="size-5" />
                <span>{tool.label}</span>
              </Link>
            );
          })}
        </div>
      </Drawer>
    </>
  );
}
