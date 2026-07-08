import { useMemo } from "react";
import { Copy, FolderPlus } from "lucide-react";
import { Button, Modal, Space, Tag } from "antd";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { useThemeStore } from "@/stores/use-theme-store";

function tryFormatJson(text: string) {
    const trimmed = text.trim();
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}")) && !(trimmed.startsWith("[") && trimmed.endsWith("]"))) return null;
    try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
        return null;
    }
}

function PromptBody({ prompt, onCopy }: { prompt: string; onCopy: (text: string) => void }) {
    const isDark = useThemeStore((state) => state.theme) === "dark";
    const formatted = useMemo(() => tryFormatJson(prompt), [prompt]);

    if (formatted === null) {
        return <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt}</p>;
    }

    return (
        <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
            <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-3 py-1.5 dark:border-stone-700 dark:bg-stone-900">
                <span className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">JSON</span>
                <Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => onCopy(prompt)}>
                    复制
                </Button>
            </div>
            <CodeMirror
                value={formatted}
                theme={isDark ? "dark" : "light"}
                editable={false}
                basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
                extensions={[json(), EditorView.lineWrapping]}
                className="max-h-80 overflow-auto text-xs"
            />
        </div>
    );
}

function PromptPreview({ preview, coverUrl }: { preview: string; coverUrl: string }) {
    const imageRegex = /!\[[^\]]*]\(([^)]+)\)/g;
    const images = Array.from(preview.matchAll(imageRegex), (match) => match[1]).filter((src) => src && src !== coverUrl);
    const caption = preview.replace(imageRegex, "").trim();
    if (!images.length && !caption) return null;
    return (
        <div className="space-y-3">
            {images.length ? (
                <div className="grid grid-cols-2 gap-2">
                    {images.map((src) => (
                        <img key={src} src={src} alt="" className="aspect-square w-full rounded-lg object-cover" />
                    ))}
                </div>
            ) : null}
            {caption ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{caption}</pre> : null}
        </div>
    );
}

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    return (
        <>
            <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={860}>
                {prompt ? (
                    <>
                        <div className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <img src={prompt.coverUrl} alt={prompt.title} className="aspect-[4/3] w-full rounded-lg object-cover" />
                                {prompt.preview ? <PromptPreview preview={prompt.preview} coverUrl={prompt.coverUrl} /> : null}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap gap-1.5">
                                    {prompt.tags.map((tag) => (
                                        <Tag key={tag} className="m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                                <PromptBody prompt={prompt.prompt} onCopy={onCopy} />
                                {formatPromptDate(prompt.createdAt) || formatPromptDate(prompt.updatedAt) ? (
                                    <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                                        {[formatPromptDate(prompt.createdAt) && `创建：${formatPromptDate(prompt.createdAt)}`, formatPromptDate(prompt.updatedAt) && `更新：${formatPromptDate(prompt.updatedAt)}`].filter(Boolean).join(" · ")}
                                    </div>
                                ) : null}
                                <Space wrap className="mt-5">
                                    <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                        复制提示词
                                    </Button>
                                    {onSaveAsset ? (
                                        <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                            加入我的素材
                                        </Button>
                                    ) : null}
                                </Space>
                            </div>
                        </div>
                    </>
                ) : null}
            </Modal>
        </>
    );
}
