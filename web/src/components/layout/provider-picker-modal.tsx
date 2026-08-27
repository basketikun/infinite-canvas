import { Modal } from "antd";
import { Plus, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { providerPresets, type ProviderPreset } from "@/lib/provider-presets";

/** Grid of plug-and-play provider presets shown when adding a new channel. */
export function ProviderPickerModal({ open, onPick, onCustom, onClose }: { open: boolean; onPick: (preset: ProviderPreset) => void; onCustom: () => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [hovered, setHovered] = useState("");

    return (
        <Modal open={open} onCancel={onClose} footer={null} width={720} title={t("config.providers.title")}>
            <div className="mb-3 text-xs text-stone-500">{t("config.providers.description")}</div>
            <div className="grid grid-cols-1 gap-2 py-2 md:grid-cols-2">
                {providerPresets.map((preset) => (
                    <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                            onPick(preset);
                            onClose();
                        }}
                        onMouseEnter={() => setHovered(preset.id)}
                        onMouseLeave={() => setHovered("")}
                        className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                            hovered === preset.id ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950/40" : "border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-900/60"
                        }`}
                    >
                        <Zap className={`size-5 shrink-0 ${hovered === preset.id ? "text-indigo-500" : "text-stone-400"}`} />
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{preset.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-stone-500">{t(`config.providers.hints.${preset.id}`)}</span>
                        </span>
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => {
                        onCustom();
                        onClose();
                    }}
                    onMouseEnter={() => setHovered("custom")}
                    onMouseLeave={() => setHovered("")}
                    className={`flex items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left transition-colors md:col-span-2 ${
                        hovered === "custom" ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950/40" : "border-stone-300 hover:bg-stone-50 dark:border-stone-600 dark:hover:bg-stone-900/60"
                    }`}
                >
                    <Plus className={`size-5 shrink-0 ${hovered === "custom" ? "text-indigo-500" : "text-stone-400"}`} />
                    <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{t("config.providers.custom")}</span>
                        <span className="mt-0.5 block truncate text-xs text-stone-500">{t("config.providers.customHint")}</span>
                    </span>
                </button>
            </div>
        </Modal>
    );
}
