import type { CSSProperties } from "react";
import { Dropdown } from "antd";
import { Languages } from "lucide-react";

import { useTranslation } from "@/components/layout/locale-provider";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/i18n";

const LOCALE_OPTIONS: readonly AppLocale[] = ["zh", "en"];

type LanguageToggleProps = {
    className?: string;
    style?: CSSProperties;
};

export function LanguageToggle({ className, style }: LanguageToggleProps) {
    const { locale, setLocale, t } = useTranslation();

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                selectedKeys: [locale],
                items: LOCALE_OPTIONS.map((option) => ({
                    key: option,
                    label: option === "en" ? t("language.en") : t("language.zh"),
                    onClick: () => setLocale(option),
                })),
            }}
        >
            <button
                type="button"
                className={cn("inline-flex size-7 shrink-0 items-center justify-center gap-0.5 text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white", className)}
                style={style}
                aria-label={t("language.toggle")}
                title={t("language.toggle")}
            >
                <Languages className="size-4" />
                <span className="text-[10px] font-medium uppercase leading-none">{locale === "zh" ? "中" : "EN"}</span>
            </button>
        </Dropdown>
    );
}
