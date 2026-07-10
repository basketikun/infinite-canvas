import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Card, Tag } from "antd";

import { useTranslation } from "@/components/layout/locale-provider";
import { formatLocaleDate } from "@/lib/format-locale";
import { type Prompt } from "@/services/api/prompts";

export function PromptCard({
    item,
    onOpen,
    onCopy,
    actionLabel,
    actionIcon = <Copy className="size-3.5" />,
    actionType = "text",
    extraAction,
}: {
    item: Prompt;
    onOpen: () => void;
    onCopy: () => void;
    actionLabel?: string;
    actionIcon?: ReactNode;
    actionType?: "text" | "primary";
    extraAction?: ReactNode;
}) {
    const { locale, t } = useTranslation();
    const resolvedActionLabel = actionLabel ?? t("promptsDialog.copy");

    return (
        <Card
            hoverable
            className="overflow-hidden"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    <img src={item.coverUrl} alt={item.title} className="aspect-[4/3] w-full object-cover" />
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</h2>
                        <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">{formatLocaleDate(item.updatedAt, locale, { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-stone-600 dark:text-stone-400">{item.prompt}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.tags.map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                <Button block={actionType === "primary"} type={actionType} size="small" icon={actionIcon} onClick={onCopy}>
                    {resolvedActionLabel}
                </Button>
                {extraAction}
            </div>
        </Card>
    );
}
