import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Maximize2, X } from "lucide-react";
import { Dialog } from "radix-ui";

import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { imageReferenceLabel } from "@workbench/lib/image-reference-prompt";
import { loadImagePreview, previewUrlFor } from "@workbench/services/image-storage";
import type { ReferenceImage } from "@workbench/types/image";

type MentionState = { range: Range; query: string };

export function CreationPromptEditor({ value, references, placeholder, onChange, onSubmit, dialog = false }: {
    value: string;
    references: ReferenceImage[];
    placeholder: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    dialog?: boolean;
}) {
    const editorRef = useRef<HTMLDivElement>(null);
    const composing = useRef(false);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const images = references.filter((item) => item.type.startsWith("image/"));
    const options = mention
        ? images.map((item, index) => ({ item, label: imageReferenceLabel(index) }))
            .filter(({ item, label }) => !mention.query || item.name.toLowerCase().includes(mention.query.toLowerCase()) || label.includes(mention.query))
        : [];

    useEffect(() => {
        for (const item of images) if (item.storageKey) void loadImagePreview(item.storageKey);
    }, [images]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (!value) {
            editor.replaceChildren();
            return;
        }
        if (document.activeElement === editor || readPrompt(editor) === value) return;
        // 弹层打开时由弹层内的编辑器负责显示，避免覆盖其中的 @ 引用节点。
        if (expanded && !dialog) return;
        editor.textContent = value;
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }, [value, expanded, dialog]);

    useEffect(() => {
        if (dialog) editorRef.current?.focus();
    }, [dialog]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const labels = new Map(images.map((item, index) => [item.id, `@${imageReferenceLabel(index)}`]));
        editor.querySelectorAll<HTMLElement>("[data-reference-id]").forEach((node) => {
            const label = labels.get(node.dataset.referenceId || "");
            if (!label) node.remove();
            else node.dataset.mention = label;
        });
        const next = readPrompt(editor).replace(/\n{3,}/g, "\n\n");
        if (next !== value) onChange(next);
    }, [images, onChange, value]);

    const updateMention = () => {
        const selection = window.getSelection();
        const node = selection?.anchorNode;
        const offset = selection?.anchorOffset || 0;
        if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !editorRef.current?.contains(node)) {
            setMention(null);
            return;
        }
        const match = /@([^\s@]*)$/.exec(node.textContent?.slice(0, offset) || "");
        if (!match || !images.length) {
            setMention(null);
            return;
        }
        const range = document.createRange();
        range.setStart(node, offset - match[0].length);
        range.setEnd(node, offset);
        setMention({ range, query: match[1] });
        setActiveIndex(0);
    };

    const selectMention = (item: ReferenceImage, label: string) => {
        if (!mention || !editorRef.current) return;
        const token = document.createElement("span");
        token.contentEditable = "false";
        token.dataset.referenceId = item.id;
        token.dataset.mention = `@${label}`;
        token.className = "mx-1 inline-flex size-5 items-center overflow-hidden rounded-sm border bg-muted align-[-0.2em] text-[10px]";
        token.title = `@${label} · ${item.name}`;
        const source = item.dataUrl || previewUrlFor(item.storageKey);
        if (source) {
            const image = document.createElement("img");
            image.src = source;
            image.alt = label;
            image.className = "size-full object-cover";
            token.appendChild(image);
        } else token.textContent = label;
        const trailingSpace = document.createTextNode(" ");
        mention.range.deleteContents();
        mention.range.insertNode(trailingSpace);
        mention.range.insertNode(token);
        const caret = document.createRange();
        caret.setStartAfter(trailingSpace);
        caret.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(caret);
        setMention(null);
        editorRef.current.focus();
        syncValue(editorRef.current, onChange);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (composing.current) return;
        if (mention && options.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((value) => (value + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                const option = options[activeIndex];
                if (option) selectMention(option.item, option.label);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
            }
        }
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
        }
    };

    return (
        <div className="relative">
            {mention && options.length ? (
                <div className="absolute bottom-full left-0 mb-2 max-h-52 w-72 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg">
                    {options.map(({ item, label }, index) => (
                        <button
                            key={item.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                            data-active={index === activeIndex || undefined}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                selectMention(item, label);
                            }}
                        >
                            {item.dataUrl || previewUrlFor(item.storageKey) ? <img src={item.dataUrl || previewUrlFor(item.storageKey)} alt="" className="size-9 rounded-md bg-muted object-cover" /> : null}
                            <span className="min-w-0">
                                <span className="block font-medium">@{label}</span>
                                <span className="block truncate text-xs text-muted-foreground">{item.name}</span>
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}
            <div
                ref={editorRef}
                role="textbox"
                aria-multiline="true"
                contentEditable
                suppressContentEditableWarning
                data-placeholder={placeholder}
                className={cn(
                    "whitespace-pre-wrap overflow-y-auto text-base leading-6 outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
                    dialog ? "h-[52dvh] min-h-64 rounded-xl border p-4" : "max-h-48 min-h-24 rounded-lg py-1 pr-10",
                )}
                onInput={(event) => {
                    if (composing.current) return;
                    syncValue(event.currentTarget, onChange);
                    updateMention();
                }}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={(event) => {
                    composing.current = false;
                    syncValue(event.currentTarget, onChange);
                    updateMention();
                }}
                onClick={updateMention}
                onKeyUp={updateMention}
                onKeyDown={handleKeyDown}
                onPaste={(event) => {
                    const data = event.clipboardData;
                    if (!data) return;
                    // 一律由这里接管：只写入纯文本，图片交给参考图区，避免浏览器把原图或来源样式贴进编辑器。
                    event.preventDefault();
                    const text = data.getData("text/plain");
                    if (!text) return;
                    insertPlainText(event.currentTarget, text);
                    syncValue(event.currentTarget, onChange);
                    updateMention();
                }}
            />
            {dialog ? null : <>
                <Button type="button" variant="ghost" size="icon-xs" className="absolute right-0 top-1 rounded-full text-muted-foreground" onClick={() => setExpanded(true)} aria-label="放大编辑" title="放大编辑">
                    <Maximize2 className="size-4" />
                </Button>
                <Dialog.Root open={expanded} onOpenChange={setExpanded}>
                    <Dialog.Portal>
                        <Dialog.Overlay className="fixed inset-0 z-[1100] bg-black/45" />
                        <Dialog.Content className="fixed left-1/2 top-1/2 z-[1100] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-2xl" onOpenAutoFocus={(event) => event.preventDefault()}>
                            <div className="flex items-center justify-between gap-2">
                                <Dialog.Title className="text-base font-semibold">编辑提示词</Dialog.Title>
                                <Dialog.Close asChild>
                                    <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭"><X className="size-4" /></Button>
                                </Dialog.Close>
                            </div>
                            <Dialog.Description className="sr-only">在更大的输入框中编辑提示词，支持输入 @ 引用参考图。</Dialog.Description>
                            <div className="mt-3">
                                <CreationPromptEditor
                                    dialog
                                    value={value}
                                    references={references}
                                    placeholder={placeholder}
                                    onChange={onChange}
                                    onSubmit={() => {
                                        setExpanded(false);
                                        onSubmit();
                                    }}
                                />
                            </div>
                        </Dialog.Content>
                    </Dialog.Portal>
                </Dialog.Root>
            </>}
        </div>
    );
}

/** 粘贴只保留纯文本，避免带入来源网页的字号、颜色、对齐和链接。 */
function insertPlainText(editor: HTMLDivElement, text: string) {
    editor.focus();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
    }
    if (document.execCommand("insertText", false, text)) return;
    const active = window.getSelection();
    if (!active?.rangeCount) return;
    const range = active.getRangeAt(0);
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    text.split(/\r?\n/).forEach((line, index) => {
        if (index) fragment.appendChild(document.createElement("br"));
        fragment.appendChild(document.createTextNode(line));
    });
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) {
        const caret = document.createRange();
        caret.setStartAfter(last);
        caret.collapse(true);
        active.removeAllRanges();
        active.addRange(caret);
    }
}

function syncValue(editor: HTMLElement, onChange: (value: string) => void) {
    onChange(readPrompt(editor).replace(/\n{3,}/g, "\n\n"));
}

function readPrompt(node: Node): string {
    if (node instanceof HTMLElement && node.dataset.mention) return node.dataset.mention;
    if (node.nodeName === "BR") return "\n";
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    const content = Array.from(node.childNodes).map(readPrompt).join("");
    return node instanceof HTMLDivElement && node.parentElement?.isContentEditable ? `\n${content}` : content;
}
