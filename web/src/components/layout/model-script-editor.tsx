import { javascript } from "@codemirror/lang-javascript";
import CodeMirror from "@uiw/react-codemirror";
import { Button, Modal } from "antd";
import { Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { getPluginAuthoringPrompt, getPluginReturn, getPluginTemplates, getPluginVariables } from "@/services/api/model-plugin";
import type { ModelCapability } from "@/stores/use-config-store";

function isDarkMode() {
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function StepHeading({ index, title }: { index: number; title: string }) {
    return (
        <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-medium text-white dark:bg-stone-100 dark:text-stone-900">{index}</span>
            <span className="text-sm font-medium text-stone-800 dark:text-stone-100">{title}</span>
        </div>
    );
}

function StepBlock({ index, title, children }: { index: number; title: string; children: ReactNode }) {
    return (
        <section className="border-b border-stone-200/70 px-5 py-4 dark:border-stone-800/70">
            <StepHeading index={index} title={title} />
            {children}
        </section>
    );
}

export function ModelScriptEditor({ open, capability, modelName, value, onSave, onClose }: { open: boolean; capability: ModelCapability; modelName: string; value: string; onSave: (script: string) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [draft, setDraft] = useState(value);
    useEffect(() => {
        if (open) setDraft(value);
    }, [open, value]);

    const variables = getPluginVariables().filter((variable) => !variable.capabilities || variable.capabilities.includes(capability));
    const templates = getPluginTemplates()[capability];
    const capabilityLabel = t(`config.channelEditor.capabilities.${capability}`);
    const hasScript = Boolean(draft.trim());

    return (
        <Modal
            open={open}
            title={null}
            footer={null}
            width="100vw"
            centered={false}
            onCancel={onClose}
            wrapClassName="[&_.ant-modal]:!inset-0 [&_.ant-modal]:!top-0 [&_.ant-modal]:!m-0 [&_.ant-modal]:!max-w-none [&_.ant-modal]:!h-dvh [&_.ant-modal]:!w-full [&_.ant-modal]:!p-0 [&_.ant-modal-container]:!h-dvh [&_.ant-modal-container]:!p-0 [&_.ant-modal-content]:!h-dvh [&_.ant-modal-content]:!max-h-dvh [&_.ant-modal-content]:!rounded-none [&_.ant-modal-content]:!overflow-hidden [&_.ant-modal-body]:!h-full [&_.ant-modal-body]:!max-h-full [&_.ant-modal-body]:!overflow-hidden [&_.ant-modal-body]:!p-0"
            styles={{
                wrapper: { overflow: "hidden" },
                container: { height: "100dvh", maxHeight: "100dvh", margin: 0, padding: 0, borderRadius: 0, overflow: "hidden" },
                body: { height: "100dvh", maxHeight: "100dvh", padding: 0, overflow: "hidden" },
            }}
            style={{ top: 0, margin: 0, paddingBottom: 0, maxWidth: "100vw" }}
        >
            <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
                <header className="shrink-0 border-b border-stone-200 px-6 py-3 pr-12 dark:border-stone-800">
                    <div className="text-base font-semibold">
                        {t("config.scriptEditor.title", { capability: capabilityLabel })}
                        {modelName ? ` · ${modelName}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-stone-500">{t("config.scriptEditor.description")}</div>
                </header>
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <aside className="flex h-full w-[420px] shrink-0 flex-col border-r border-stone-200 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-900/40">
                        <div className="flex shrink-0 gap-2 border-b border-stone-200/70 px-5 py-3 text-xs text-stone-500 dark:border-stone-800/70 dark:text-stone-400">
                            <span>1. {t("config.scriptEditor.stepRule")}</span>
                            <span>→</span>
                            <span>2. {t("config.scriptEditor.stepAi")}</span>
                            <span>→</span>
                            <span>3. {t("config.scriptEditor.stepEdit")}</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-scroll overscroll-contain p-0">
                            <StepBlock index={1} title={t("config.scriptEditor.stepRule")}>
                                <p className="text-xs leading-5 text-stone-600 dark:text-stone-300">{t("config.scriptEditor.stepRuleHint")}</p>
                                <div className="mt-3">
                                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{t("config.scriptEditor.returnRequirements")}</div>
                                    <div className="text-xs leading-6 text-stone-600 dark:text-stone-300">{getPluginReturn(capability)}</div>
                                </div>
                            </StepBlock>
                            <StepBlock index={2} title={t("config.scriptEditor.stepAi")}>
                                <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-5 text-stone-600 dark:text-stone-300">
                                    <li>{t("config.scriptEditor.stepAiCopy")}</li>
                                    <li>{t("config.scriptEditor.stepAiAsk")}</li>
                                    <li>{t("config.scriptEditor.stepAiPaste")}</li>
                                </ol>
                                <p className="mt-2 text-[11px] leading-5 text-stone-400">{t("config.scriptEditor.stepAiIncludes")}</p>
                                <Button
                                    type="primary"
                                    className="mt-3"
                                    icon={<Copy className="size-3.5" />}
                                    onClick={() => copyText(getPluginAuthoringPrompt(capability, modelName, draft), t("config.scriptEditor.briefCopied"))}
                                >
                                    {t("config.scriptEditor.copyBrief")}
                                </Button>
                            </StepBlock>
                            <section className="px-5 py-4">
                                <StepHeading index={3} title={t("config.scriptEditor.variables")} />
                                <div className="mb-2 flex items-center justify-between">
                                    <p className="text-xs leading-5 text-stone-500 dark:text-stone-400">
                                        {t("config.scriptEditor.variablesHint")}
                                        {capability === "video" ? ` ${t("config.scriptEditor.variablesHintVideo")}` : ""}
                                    </p>
                                    <span className="shrink-0 text-[10px] text-stone-400">{t("config.scriptEditor.insert")}</span>
                                </div>
                                <div className="space-y-1.5">
                                    {variables.map((variable) => (
                                        <button
                                            key={variable.name}
                                            type="button"
                                            onClick={() => setDraft((current) => (current ? `${current}\n${variable.name}` : variable.name))}
                                            className="group block w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-stone-200 hover:bg-white dark:hover:border-stone-700 dark:hover:bg-stone-800/60"
                                        >
                                            <div className="flex flex-wrap items-baseline gap-1.5">
                                                <code className="rounded bg-stone-200/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-stone-800 group-hover:bg-blue-100 group-hover:text-blue-700 dark:bg-stone-800 dark:text-stone-100 dark:group-hover:bg-blue-950 dark:group-hover:text-blue-300">
                                                    {variable.name}
                                                </code>
                                                <span className="font-mono text-[10px] text-stone-400">{variable.type}</span>
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{variable.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </div>
                    </aside>
                    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-stone-950">
                        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-2.5 dark:border-stone-800">
                            <div>
                                <div className="text-sm font-medium text-stone-800 dark:text-stone-100">{t("config.scriptEditor.editorTitle")}</div>
                                <div className="text-xs text-stone-500">{t("config.scriptEditor.editorHint")}</div>
                            </div>
                            <span className="shrink-0 text-[11px] text-stone-400">{hasScript ? t("config.scriptEditor.editorFilled") : t("config.scriptEditor.editorEmpty")}</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                            <CodeMirror
                                value={draft}
                                onChange={setDraft}
                                height="100%"
                                theme={isDarkMode() ? "dark" : "light"}
                                extensions={[javascript()]}
                                placeholder={t("config.scriptEditor.placeholder")}
                                style={{ height: "100%", fontSize: 13 }}
                                className="h-full [&_.cm-editor]:h-full [&_.cm-gutters]:border-none [&_.cm-scroller]:overflow-auto"
                            />
                        </div>
                    </div>
                </div>
                <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-6 py-3 dark:border-stone-800">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-stone-400">{t("config.scriptEditor.startFromTemplate")}</span>
                        {templates.map((template) => (
                            <Button key={template.label} size="small" onClick={() => setDraft(template.script)}>
                                {t("config.scriptEditor.insertTemplate", { name: template.label })}
                            </Button>
                        ))}
                        <Button size="small" danger onClick={() => setDraft("")}>
                            {t("config.scriptEditor.restoreDefault")}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button
                            type="primary"
                            onClick={() => {
                                onSave(draft.trim());
                                onClose();
                            }}
                        >
                            {t("common.save")}
                        </Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}
