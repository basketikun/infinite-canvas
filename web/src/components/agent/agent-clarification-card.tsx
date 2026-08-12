import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "antd";
import { Check, ChevronLeft, ChevronRight, CircleHelp, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentClarificationAnswers, AgentClarificationQuestion, AgentPendingClarification } from "@/stores/use-agent-store";

export function AgentClarificationCard({
    clarification,
    theme,
    onSubmit,
    onCancel,
}: {
    clarification: AgentPendingClarification;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onSubmit: (answers: AgentClarificationAnswers) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [answers, setAnswers] = useState<AgentClarificationAnswers>({});
    const [currentIndex, setCurrentIndex] = useState(0);
    const submitting = clarification.deciding === "submit";
    const canceling = clarification.deciding === "cancel";
    const complete = useMemo(() => clarification.questions.every((question) => !question.required || hasAnswer(answers[question.id])), [answers, clarification.questions]);
    const question = clarification.questions[currentIndex];
    const currentComplete = !question.required || hasAnswer(answers[question.id]);
    const lastQuestion = currentIndex === clarification.questions.length - 1;

    useEffect(() => {
        setAnswers({});
        setCurrentIndex(0);
    }, [clarification.requestId]);

    const update = (question: AgentClarificationQuestion, value: string) => {
        setAnswers((current) => {
            if (question.kind === "multiple") {
                const answer = current[question.id];
                const selected = Array.isArray(answer) ? answer : [];
                return { ...current, [question.id]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value] };
            }
            return { ...current, [question.id]: value };
        });
    };

    return (
        <section className="min-w-0 rounded-lg border px-3 py-3" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel, color: theme.node.text }}>
            <div className="flex items-start gap-2.5">
                <CircleHelp className="mt-0.5 size-4 shrink-0" style={{ color: theme.node.muted }} />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-5">{t("agent.clarification.title")}</div>
                    {clarification.message ? <div className="mt-1 text-sm leading-6">{clarification.message}</div> : null}
                </div>
            </div>
            <div className="mt-3">
                <ClarificationQuestion question={question} index={currentIndex} value={answers[question.id]} disabled={Boolean(clarification.deciding)} theme={theme} onChange={(value) => update(question, value)} />
            </div>
            <div className="mt-3 flex justify-end gap-1.5 border-t pt-3" style={{ borderColor: theme.node.stroke }}>
                <Button type="text" className="!h-8" disabled={submitting || canceling} loading={canceling} icon={<X className="size-3.5" />} onClick={onCancel}>
                    {t("agent.clarification.cancel")}
                </Button>
                {clarification.questions.length > 1 ? (
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !px-0"
                        title={t("agent.clarification.previous")}
                        aria-label={t("agent.clarification.previous")}
                        disabled={!currentIndex || submitting || canceling}
                        icon={<ChevronLeft className="size-4" />}
                        onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                    />
                ) : null}
                {lastQuestion ? (
                    <Button type="text" className="!h-8" disabled={!complete || submitting || canceling} loading={submitting} icon={<Check className="size-3.5" />} style={{ color: theme.toolbar.activeText }} onClick={() => onSubmit(answers)}>
                        {t("agent.clarification.continue")}
                    </Button>
                ) : (
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !px-0"
                        title={t("agent.clarification.next")}
                        aria-label={t("agent.clarification.next")}
                        disabled={!currentComplete || submitting || canceling}
                        icon={<ChevronRight className="size-4" />}
                        onClick={() => setCurrentIndex((index) => Math.min(clarification.questions.length - 1, index + 1))}
                    />
                )}
                {clarification.questions.length > 1 ? (
                    <span className="inline-flex h-8 items-center px-1 text-xs tabular-nums" style={{ color: theme.node.muted }}>
                        {t("agent.clarification.progress", { current: currentIndex + 1, total: clarification.questions.length })}
                    </span>
                ) : null}
            </div>
        </section>
    );
}

function ClarificationQuestion({
    question,
    index,
    value,
    disabled,
    theme,
    onChange,
}: {
    question: AgentClarificationQuestion;
    index: number;
    value: string | string[] | undefined;
    disabled: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onChange: (value: string) => void;
}) {
    const { t } = useTranslation();
    const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
    return (
        <fieldset className="min-w-0">
            <legend className="flex min-w-0 items-start gap-2 text-sm leading-5">
                <span className="grid size-5 shrink-0 place-items-center rounded-[4px] text-xs tabular-nums" style={{ background: theme.node.fill, color: theme.node.text }}>
                    {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                    {question.label}
                    {question.required ? <span className="ml-1 text-red-500">*</span> : null}
                </span>
            </legend>
            {question.description ? (
                <p className="mt-1 pl-7 text-xs leading-5" style={{ color: theme.node.muted }}>
                    {question.description}
                </p>
            ) : null}
            {question.kind === "text" ? (
                <Input.TextArea
                    value={typeof value === "string" ? value : ""}
                    disabled={disabled}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    className="mt-2"
                    placeholder={question.placeholder || t("agent.clarification.placeholder")}
                    onChange={(event) => onChange(event.target.value)}
                />
            ) : (
                <div className="mt-2 space-y-1.5">
                    {(question.options || []).map((option) => {
                        const active = selected.has(option.value);
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={disabled}
                                className="flex w-full min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors enabled:hover:bg-black/[.035] dark:enabled:hover:bg-white/[.06] disabled:cursor-not-allowed"
                                style={{ borderColor: active ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onClick={() => onChange(option.value)}
                            >
                                <span
                                    className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border"
                                    style={{ borderColor: active ? theme.node.text : theme.node.muted, background: active ? theme.node.text : "transparent", color: active ? theme.toolbar.panel : theme.node.muted }}
                                >
                                    {active ? <Check className="size-3" /> : null}
                                </span>
                                <span className="min-w-0 flex-1 text-sm leading-5">
                                    <span className="block">{option.label}</span>
                                    {option.description ? (
                                        <span className="mt-0.5 block text-xs leading-5" style={{ color: theme.node.muted }}>
                                            {option.description}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </fieldset>
    );
}

function hasAnswer(value: string | string[] | undefined) {
    return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}
