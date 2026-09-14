import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

import { decodeCanvasModel, encodeCanvasModel } from "@/services/api/canvas-bff";
import { guessCapability, modelOptionName, type ModelCapability } from "@/stores/use-config-store";
import { useCanvasBffModelOptions } from "@/hooks/use-canvas-bff-model-options";
import { useCanvasProviderStore } from "@/stores/use-canvas-provider-store";

type CanvasProviderModelPickerProps = {
    capability: ModelCapability;
    value?: string;
    onChange: (value: string) => void;
    className?: string;
    showLabels?: boolean;
};

export function CanvasProviderModelPicker({ capability, value, onChange, className, showLabels = false }: CanvasProviderModelPickerProps) {
    const { t } = useTranslation();
    const { providers, modelsByProvider, selectedProviderId, providerLoading, modelLoading, error, load } = useCanvasBffModelOptions();
    const selectProvider = useCanvasProviderStore((state) => state.select);
    const [loadAttempted, setLoadAttempted] = useState(false);
    const loadStartedRef = useRef(false);
    const normalizedValueRef = useRef("");
    useEffect(() => {
        if (loadStartedRef.current) return;
        loadStartedRef.current = true;
        void load()
            .then(() => setLoadAttempted(true))
            .catch(() => {
                loadStartedRef.current = false;
                setLoadAttempted(true);
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
    const compatibleProviders = useMemo(() => (options.length ? providers.filter((provider) => options.some((option) => option.provider.id === provider.id)) : providers), [options, providers]);
    const decodedValue = decodeCanvasModel(value || "");
    const modelName = decodedValue?.model || modelOptionName(value || "");
    const matchingOptions = options.filter((option) => option.model === modelName);
    const matchingProviderDefaults = matchingOptions.filter((option) => option.provider.model === modelName);
    const fallbackOption = decodedValue ? providers.filter((provider) => provider.id === decodedValue.providerId && provider.model === decodedValue.model).map((provider) => ({ provider, model: decodedValue.model }))[0] : undefined;
    const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
    const initialProviderOption = !decodedValue && !modelName && selectedProvider?.model ? { provider: selectedProvider, model: selectedProvider.model } : undefined;
    const current =
        options.find((option) => encodeCanvasModel(option.provider.id, option.model) === value) ||
        options.find((option) => option.provider.id === decodedValue?.providerId && option.model === modelName) ||
        (decodedValue
            ? undefined
            : options.find((option) => option.provider.id === selectedProviderId && option.model === modelName) ||
              (matchingProviderDefaults.length === 1 ? matchingProviderDefaults[0] : undefined) ||
              (matchingOptions.length === 1 ? matchingOptions[0] : undefined)) ||
        fallbackOption ||
        initialProviderOption;
    const selectedValue = current ? encodeCanvasModel(current.provider.id, current.model) : value || "";
    const providerLoadError = Boolean(error && !providers.length);
    const modelLoadError = Boolean(error && providers.length);
    const providerForSelection = current?.provider || selectedProvider;
    const currentModelOptions = (options.length ? options : providerForSelection?.model ? [{ provider: providerForSelection, model: providerForSelection.model }] : []).filter((item) => item.provider.id === providerForSelection?.id);
    useEffect(() => {
        if (!current || selectedValue === value || normalizedValueRef.current === selectedValue) return;
        normalizedValueRef.current = selectedValue;
        onChange(selectedValue);
    }, [current, onChange, selectedValue, value]);

    const providerSelect = (
        <Select
            value={providerForSelection?.id || ""}
            disabled={providerLoading || !compatibleProviders.length}
            onValueChange={(providerId) => {
                selectProvider(providerId);
                const option = options.find((item) => item.provider.id === providerId) || providers.filter((provider) => provider.id === providerId && provider.model).map((provider) => ({ provider, model: provider.model! }))[0];
                if (!option) return;
                const nextValue = encodeCanvasModel(option.provider.id, option.model);
                normalizedValueRef.current = nextValue;
                onChange(nextValue);
            }}
        >
            <SelectTrigger aria-label={t("config.account.providerLabel", { defaultValue: "Provider" })} className="h-8 min-w-0 w-full">
                <span className="truncate">
                    {providerLoading ? <LoaderCircle className="mr-1 inline size-3 animate-spin" /> : null}
                    {providerLoading
                        ? t("config.account.loadingProviders", { defaultValue: "Loading providers…" })
                        : providerLoadError
                          ? t("config.account.providerLoadFailed", { defaultValue: "Unable to load providers" })
                          : providerForSelection?.name || t("config.account.selectProvider", { defaultValue: "Select provider" })}
                </span>
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
            disabled={providerLoading || modelLoading || !currentModelOptions.length}
            onValueChange={(nextValue) => {
                normalizedValueRef.current = nextValue;
                onChange(nextValue);
            }}
        >
            <SelectTrigger aria-label={t("config.account.modelLabel", { defaultValue: "Model" })} className="h-8 min-w-0 w-full">
                <span className="truncate">
                    {providerLoading || modelLoading ? <LoaderCircle className="mr-1 inline size-3 animate-spin" /> : null}
                    {providerLoading || modelLoading
                        ? t("config.account.loadingModels", { defaultValue: "Loading models…" })
                        : modelLoadError
                          ? t("config.account.modelLoadFailed", { defaultValue: "Unable to load models" })
                          : current?.model || (currentModelOptions.length ? t("config.account.selectModel", { defaultValue: "Select model" }) : t("config.account.noModelsForCapability", { defaultValue: "No models available" }))}
                </span>
            </SelectTrigger>
            <SelectContent>
                {currentModelOptions.map((item) => (
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
            {loadAttempted && (error || !providers.length) ? (
                <div className="col-span-full flex items-center justify-between gap-2 text-xs text-destructive" role="alert">
                    <span>{error || t("config.account.noProviders", { defaultValue: "No active providers available" })}</span>
                    <button type="button" className="inline-flex items-center gap-1 underline underline-offset-2" onClick={() => void load().catch(() => undefined)}>
                        <RefreshCw className="size-3" />
                        {t("common.retry", { defaultValue: "Retry" })}
                    </button>
                </div>
            ) : null}
            {loadAttempted && !providerLoading && !modelLoading && providers.length > 0 && providerForSelection && !currentModelOptions.length ? (
                <div className="col-span-full flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" role="status">
                    <CircleAlert className="size-3" />
                    {t("config.account.noModelsForCapability", { defaultValue: "No models available for this capability from the selected provider." })}
                </div>
            ) : null}
        </div>
    );
}
