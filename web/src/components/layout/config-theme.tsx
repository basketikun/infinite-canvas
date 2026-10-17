import { App, Button, Input, Modal } from "antd";
import type { TFunction } from "i18next";
import { Palette, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { builtinThemes, isDefaultTheme, parseGhosttyTheme, type ThemePreset } from "@/lib/theme-presets";
import { useThemeStore } from "@/stores/use-theme-store";

export function themeLabel(preset: ThemePreset, t: TFunction) {
    if (!isDefaultTheme(preset)) return preset.name;
    return preset.id === "light" ? t("theme.defaultLight") : t("theme.defaultDark");
}

// 小色块：背景色打底，前景色和强调色各一个圆点，用于工具栏里的紧凑主题选择。
export function ThemeSwatch({ preset, active, activeColor, onClick }: { preset: ThemePreset; active: boolean; activeColor: string; onClick: () => void }) {
    const { t } = useTranslation();
    const label = themeLabel(preset, t);

    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className="grid aspect-square w-full place-items-center rounded-md transition hover:scale-105"
            style={{ background: preset.background, boxShadow: active ? `0 0 0 2px ${activeColor}` : `inset 0 0 0 1px ${preset.foreground}22` }}
        >
            <span className="flex gap-0.5">
                <span className="size-1.5 rounded-full" style={{ background: preset.foreground }} />
                <span className="size-1.5 rounded-full" style={{ background: preset.accent }} />
            </span>
        </button>
    );
}

export function ConfigTheme() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const themeId = useThemeStore((state) => state.themeId);
    const customThemes = useThemeStore((state) => state.customThemes);
    const setThemeId = useThemeStore((state) => state.setThemeId);
    const addCustomTheme = useThemeStore((state) => state.addCustomTheme);
    const removeCustomTheme = useThemeStore((state) => state.removeCustomTheme);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [name, setName] = useState("");
    const [content, setContent] = useState("");

    const loadFile = async (file: File) => {
        setName(file.name.replace(/\.[^.]+$/, ""));
        setContent(await file.text());
    };

    const importTheme = () => {
        try {
            const preset = parseGhosttyTheme(content, name.trim() || "Ghostty");
            addCustomTheme(preset);
            setThemeId(preset.id);
            message.success(t("config.appearance.imported", { name: preset.name }));
            setImportOpen(false);
            setName("");
            setContent("");
        } catch {
            message.error(t("config.appearance.invalid"));
        }
    };

    return (
        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Palette className="size-4" />
                        {t("config.appearance.title")}
                    </div>
                    <div className="mt-1 max-w-2xl text-xs text-stone-500">{t("config.appearance.description")}</div>
                </div>
                <Button icon={<Upload className="size-4" />} onClick={() => setImportOpen(true)}>
                    {t("config.appearance.import")}
                </Button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[...builtinThemes, ...customThemes].map((preset) => (
                    <ThemeCard key={preset.id} preset={preset} active={preset.id === themeId} custom={!builtinThemes.includes(preset)} onSelect={() => setThemeId(preset.id)} onDelete={() => removeCustomTheme(preset.id)} />
                ))}
            </div>
            <Modal title={t("config.appearance.importTitle")} open={importOpen} onOk={importTheme} okButtonProps={{ disabled: !content.trim() }} onCancel={() => setImportOpen(false)}>
                <div className="grid gap-3">
                    <Button className="justify-self-start" icon={<Upload className="size-4" />} onClick={() => fileInputRef.current?.click()}>
                        {t("config.appearance.chooseFile")}
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void loadFile(file);
                            event.target.value = "";
                        }}
                    />
                    <div>
                        <div className="mb-1 text-xs text-stone-500">{t("config.appearance.name")}</div>
                        <Input value={name} placeholder={t("config.appearance.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
                    </div>
                    <div>
                        <div className="mb-1 text-xs text-stone-500">{t("config.appearance.content")}</div>
                        <Input.TextArea value={content} rows={8} className="font-mono !text-xs" placeholder={t("config.appearance.contentPlaceholder")} onChange={(event) => setContent(event.target.value)} />
                    </div>
                </div>
            </Modal>
        </section>
    );
}

function ThemeCard({ preset, active, custom, onSelect, onDelete }: { preset: ThemePreset; active: boolean; custom: boolean; onSelect: () => void; onDelete: () => void }) {
    const { t } = useTranslation();

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(event) => event.key === "Enter" && onSelect()}
            className={`cursor-pointer overflow-hidden rounded-lg border transition ${active ? "border-stone-900 ring-1 ring-stone-900 dark:border-stone-100 dark:ring-stone-100" : "border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"}`}
        >
            <div className="h-16 p-2.5" style={{ background: preset.background }}>
                <div className="text-sm font-semibold" style={{ color: preset.foreground }}>
                    Aa
                </div>
                <div className="mt-1.5 flex gap-1">
                    <span className="h-1.5 w-8 rounded-full" style={{ background: preset.accent }} />
                    <span className="h-1.5 w-5 rounded-full opacity-35" style={{ background: preset.foreground }} />
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs">
                <span className="min-w-0 truncate">{themeLabel(preset, t)}</span>
                {custom ? (
                    <span className="flex shrink-0 items-center gap-1 text-stone-500">
                        {t("config.appearance.custom")}
                        <button
                            type="button"
                            aria-label={t("config.appearance.delete")}
                            title={t("config.appearance.delete")}
                            className="rounded p-0.5 hover:bg-black/5 hover:text-red-500 dark:hover:bg-white/10"
                            onClick={(event) => {
                                event.stopPropagation();
                                onDelete();
                            }}
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    </span>
                ) : null}
            </div>
        </div>
    );
}
