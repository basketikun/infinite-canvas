import { useState, type CSSProperties } from "react";
import { App, Button, Input, Modal, Tooltip } from "antd";
import { BookOpen, Keyboard, LogOut, Settings2, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { DOCS_URL } from "@/constant/env";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { hostedAgentConfigured } from "@/services/api/supabase";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });
    const user = useUserStore((state) => state.user);
    const signIn = useUserStore((state) => state.signIn);
    const signOut = useUserStore((state) => state.signOut);
    const [authOpen, setAuthOpen] = useState(false);
    const [account, setAccount] = useState("test");
    const [password, setPassword] = useState("12345678");
    const [submitting, setSubmitting] = useState(false);

    const submitAuth = async () => {
        setSubmitting(true);
        try {
            await signIn(account, password);
            message.success(t("auth.signedIn"));
            setAuthOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
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
            {hostedAgentConfigured ? user ? (
                <Tooltip title={`${user.username} · ${t("auth.signOut")}`} mouseEnterDelay={0.2}>
                    <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => void signOut()} aria-label={t("auth.signOut")}>
                        <LogOut className="size-4" />
                    </button>
                </Tooltip>
            ) : (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => setAuthOpen(true)} aria-label={t("auth.signIn")} title={t("auth.signIn")}>
                    <UserRound className="size-4" />
                </button>
            ) : null}
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            <Modal title={t("auth.title")} open={authOpen} onCancel={() => setAuthOpen(false)} footer={null} destroyOnHidden>
                <div className="flex flex-col gap-3 pt-2">
                    <Input value={account} onChange={(event) => setAccount(event.target.value)} placeholder={t("auth.account")} autoComplete="username" />
                    <Input.Password value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("auth.password")} autoComplete="current-password" onPressEnter={() => void submitAuth()} />
                    <div className="text-xs opacity-60">{t("auth.testAccountHint")}</div>
                    <div className="flex justify-end gap-2">
                        <Button type="primary" loading={submitting} disabled={!account.trim() || !password} onClick={() => void submitAuth()}>{t("auth.signIn")}</Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
