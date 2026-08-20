import type { CSSProperties } from "react";
import { App, Dropdown, Form, Input, Modal, Tooltip } from "antd";
import { BookOpen, Check, Keyboard, LogIn, LogOut, Puzzle, Settings2, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL } from "@/constant/env";
import { CONTROL_PLANE_URL } from "@/constant/runtime-config";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { message } = App.useApp();
    const [loginOpen, setLoginOpen] = useState(false);
    const [loginValues, setLoginValues] = useState({ username: "", password: "" });
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const setChannelMode = useConfigStore((state) => state.setChannelMode);
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const login = useUserStore((state) => state.login);
    const clearSession = useUserStore((state) => state.clearSession);
    const isLoginLoading = useUserStore((state) => state.isLoading);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const accountButtonClass = "inline-flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded px-2 text-xs font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });

    const handleLogin = () =>
        void login(loginValues)
            .then(() => {
                setChannelMode("remote", false);
                setLoginOpen(false);
                message.success("已登录服务端");
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "登录失败"));

    const handleLogout = () => {
        clearSession();
        setChannelMode("local", false);
        message.success("已退出服务端");
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {CONTROL_PLANE_URL ? (
                token ? (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "remote", label: "服务端模式", icon: channelMode === "remote" ? <Check className="size-4" /> : null, disabled: channelMode === "remote", onClick: () => setChannelMode("remote") },
                                { key: "local", label: "本地直连", icon: channelMode === "local" ? <Check className="size-4" /> : null, disabled: channelMode === "local", onClick: () => setChannelMode("local") },
                                { type: "divider" },
                                { key: "logout", label: "退出登录", icon: <LogOut className="size-4" />, onClick: handleLogout },
                            ],
                        }}
                    >
                        <button type="button" className={accountButtonClass} style={iconStyle} aria-label="服务端账户" title="服务端账户">
                            <UserRound className="size-4" />
                            <span className="truncate">{user?.displayName || user?.username || "服务端账户"}</span>
                        </button>
                    </Dropdown>
                ) : (
                    <button type="button" className={accountButtonClass} style={iconStyle} onClick={() => setLoginOpen(true)}>
                        <LogIn className="size-4" />
                        <span>登录服务端</span>
                    </button>
                )
            ) : null}
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label={t("topNav.docs")} title={t("topNav.docs")}>
                <BookOpen className="size-4" />
            </a>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")} title={t("navigation.config")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
                <button type="button" className={`${naturalIconClass} text-[11px] font-semibold tracking-tight`} style={iconStyle} onClick={() => void changeAppLocale(nextLocale)} aria-label={languageLabel}>
                    {locale === "zh-CN" ? "中" : "EN"}
                </button>
            </Tooltip>
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />
            <VersionReleaseModal style={versionStyle} />
            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            <Modal title="登录服务端" open={loginOpen} onCancel={() => setLoginOpen(false)} footer={null} destroyOnHidden>
                <Form layout="vertical" requiredMark={false} onFinish={handleLogin} className="pt-3">
                    <Form.Item label="用户名" required><Input autoComplete="username" value={loginValues.username} onChange={(event) => setLoginValues((current) => ({ ...current, username: event.target.value }))} /></Form.Item>
                    <Form.Item label="密码" required><Input.Password autoComplete="current-password" value={loginValues.password} onChange={(event) => setLoginValues((current) => ({ ...current, password: event.target.value }))} /></Form.Item>
                    <button type="submit" className="mt-1 inline-flex h-8 items-center justify-center rounded bg-stone-900 px-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={isLoginLoading}>
                        {isLoginLoading ? "登录中" : "登录"}
                    </button>
                </Form>
            </Modal>
        </div>
    );
}
