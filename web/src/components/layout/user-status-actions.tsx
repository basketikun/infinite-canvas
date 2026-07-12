"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { BookOpen, Keyboard, LogOut, Settings2, WalletCards } from "lucide-react";
import { Dropdown } from "antd";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { DOCS_URL } from "@/constant/env";
import { canvasThemes } from "@/lib/canvas-theme";
import { type AccountBalance, getAccountBalance } from "@/services/api/account";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    username?: string;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, username }: UserStatusActionsProps) {
    const [loggingOut, setLoggingOut] = useState(false);
    const [balance, setBalance] = useState<AccountBalance | null>(null);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 disabled:opacity-50 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    useEffect(() => {
        let active = true;
        const refreshBalance = () => {
            void getAccountBalance()
                .then((nextBalance) => {
                    if (active) setBalance(nextBalance);
                })
                .catch(() => {
                    if (active) setBalance(null);
                });
        };
        refreshBalance();
        window.addEventListener("focus", refreshBalance);
        return () => {
            active = false;
            window.removeEventListener("focus", refreshBalance);
        };
    }, []);

    const logout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
        } finally {
            window.location.assign("/login");
        }
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            <Dropdown
                trigger={["click"]}
                menu={{
                    items: [{ key: "recharge", label: "去充值", icon: <WalletCards className="size-4" /> }],
                    onClick: () => {
                        if (balance?.rechargeUrl) window.open(balance.rechargeUrl, "_blank", "noopener,noreferrer");
                    },
                }}
                disabled={!balance}
            >
                <button
                    type="button"
                    className="mr-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 disabled:cursor-default disabled:opacity-60 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white"
                    style={iconStyle}
                    aria-label="查看余额和充值"
                    title={balance ? "点击充值" : "余额读取中"}
                >
                    <WalletCards className="size-3.5" />
                    <span>{balance ? formatBalance(balance) : "余额 --"}</span>
                </button>
            </Dropdown>
            {username && variant === "default" ? (
                <span className="mr-1 hidden max-w-32 truncate text-xs text-stone-500 sm:inline" title={username}>
                    {username}
                </span>
            ) : null}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label="文档" title="文档">
                <BookOpen className="size-4" />
            </a>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            <button type="button" className={naturalIconClass} style={iconStyle} disabled={loggingOut} onClick={() => void logout()} aria-label="退出登录" title="退出登录">
                <LogOut className="size-4" />
            </button>
        </div>
    );
}

function formatBalance(balance: AccountBalance) {
    if (balance.quotaDisplayType === "TOKENS") return "余额 " + formatNumber(balance.quota, 0);

    const amountUsd = balance.quota / balance.quotaPerUnit;
    const exchangeRate = balance.quotaDisplayType === "CNY" ? balance.usdExchangeRate : balance.quotaDisplayType === "CUSTOM" ? balance.customCurrencyExchangeRate : 1;
    const symbol = balance.quotaDisplayType === "CNY" ? "¥" : balance.quotaDisplayType === "CUSTOM" ? balance.customCurrencySymbol : "$";
    return `余额 ${symbol}${formatNumber(amountUsd * exchangeRate, amountUsd < 1 ? 4 : 2)}`;
}

function formatNumber(value: number, maximumFractionDigits: number) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(value);
}
