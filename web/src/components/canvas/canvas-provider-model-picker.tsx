import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

import { decodeCanvasModel, encodeCanvasModel } from "@/services/api/canvas-bff";
import { guessCapability, modelOptionName, type ModelCapability } from "@/stores/use-config-store";
import { useCanvasBffModelOptions } from "@/hooks/use-canvas-bff-model-options";

type CanvasProviderModelPickerProps = {
    capability: ModelCapability;
    value?: string;
    onChange: (value: string) => void;
    className?: string;
    showLabels?: boolean;
};

export function CanvasProviderModelPicker({ capability, value, onChange, className, showLabels = false }: CanvasProviderModelPickerProps) {
    const { t } = useTranslation();
    const { providers, modelsByProvider, selectedProviderId, loading, load } = useCanvasBffModelOptions();
    const loadStartedRef = useRef(false);
    const normalizedValueRef = useRef("");
    useEffect(() => {
        if (loadStartedRef.current) return;
        loadStartedRef.current = true;
        void load().catch(() => {
            loadStartedRef.current = false;
        });
    }, [load]);
    const options = useMemo(
        () =>
            providers.flatMap((provider) => {
                const models = modelsByProvider[provider.id] || (provider.model ? [provider.model] : []);
                return models.filter((model) => guessCapability(model) === capability).map((model) => ({ provider, model }));
            }),
        [capability, modelsByProvider, providers],
    );
    const compatibleProviders = useMemo(() => providers.filter((provider) => options.some((option) => option.provider.id === provider.id)), [options, providers]);
    const decodedValue = decodeCanvasModel(value || "");
    const modelName = decodedValue?.model || modelOptionName(value || "");
    const matchingOptions = options.filter((option) => option.model === modelName);
    const matchingProviderDefaults = matchingOptions.filter((option) => option.provider.model === modelName);
    const current =
        options.find((option) => encodeCanvasModel(option.provider.id, option.model) === value) ||
        options.find((option) => option.provider.id === decodedValue?.providerId && option.model === modelName) ||
        (decodedValue
            ? undefined
            : options.find((option) => option.provider.id === selectedProviderId && option.model === modelName) ||
              (matchingProviderDefaults.length === 1 ? matchingProviderDefaults[0] : undefined) ||
              (matchingOptions.length === 1 ? matchingOptions[0] : undefined));
    const selectedValue = current ? encodeCanvasModel(current.provider.id, current.model) : value || "";
    useEffect(() => {
        if (!current || selectedValue === value || normalizedValueRef.current === selectedValue) return;
        normalizedValueRef.current = selectedValue;
        onChange(selectedValue);
    }, [current, onChange, selectedValue, value]);

    const providerSelect = (
        <Select
            value={current?.provider.id || ""}
            disabled={!compatibleProviders.length}
            onValueChange={(providerId) => {
                const option = options.find((item) => item.provider.id === providerId);
                if (!option) return;
                const nextValue = encodeCanvasModel(option.provider.id, option.model);
                normalizedValueRef.current = nextValue;
                onChange(nextValue);
            }}
        >
            <SelectTrigger aria-label={t("config.account.providerLabel", { defaultValue: "Provider" })} className="h-8 min-w-0 w-full">
                <span className="truncate">{current?.provider.name || t("config.account.selectProvider", { defaultValue: "Select provider" })}</span>
            </SelectTrigger>
            <SelectContent>
                {compatibleProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
    const modelSelect = (
        <Select
            value={selectedValue}
            disabled={loading || !current}
            onValueChange={(nextValue) => {
                normalizedValueRef.current = nextValue;
                onChange(nextValue);
            }}
        >
            <SelectTrigger aria-label={t("config.account.modelLabel", { defaultValue: "Model" })} className="h-8 min-w-0 w-full">
                <span className="truncate">{current?.model || (loading ? t("config.account.loadingModels", { defaultValue: "Loading models…" }) : t("config.account.selectModel", { defaultValue: "Select model" }))}</span>
            </SelectTrigger>
            <SelectContent>
                {options
                    .filter((item) => item.provider.id === current?.provider.id)
                    .map((item) => (
                        <SelectItem key={item.model} value={encodeCanvasModel(item.provider.id, item.model)}>
                            {item.model}
                        </SelectItem>
                    ))}
            </SelectContent>
        </Select>
    );
    return (
        <div data-capability={capability} className={`grid min-w-0 gap-2 sm:grid-cols-2 ${className || ""}`}>
            {showLabels ? (
                <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                    <span>{t("config.account.providerLabel", { defaultValue: "Provider" })}</span>
                    {providerSelect}
                </label>
            ) : (
                providerSelect
            )}
            {showLabels ? (
                <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                    <span>{t("config.account.modelLabel", { defaultValue: "Model" })}</span>
                    {modelSelect}
                </label>
            ) : (
                modelSelect
            )}
        </div>
    );
}
