import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePreview } from "@workbench/components/ui/image-preview-group";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@workbench/lib/canvas-theme";
import { isImeComposing, isPlainEnterKey } from "@workbench/lib/keyboard-event";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import type { CanvasResourceReference } from "@workbench/lib/canvas/canvas-resource-references";
import { useImagePreview } from "@workbench/hooks/use-image-preview";
import { getImagePreviewRevision, loadImagePreview, previewUrlFor, subscribeImagePreviews } from "@workbench/services/image-storage";

type Props = {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onSubmit?: () => void;
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
};

type MentionState = {
    query: string;
    rect: DOMRect | null;
};

type Token =
    | { type: "text"; value: string }
    | { type: "reference"; label: string };

// Prompt-panel contentEditable input: @ references embed thumbnail chips instead of plain label text.
// Serialization converts chips back to reference labels so the generated value matches the former textarea semantics.
export function CanvasPromptChipInput({ value, references, onChange, onSubmit, className, style, placeholder }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const editorRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    // Track the last value emitted to the parent. An identical focused value is this component's own echo,
    // so skip rebuilding to preserve the caret and IME. Rebuild external changes even while focused.
    const lastEmittedRef = useRef(value);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const { preview: imagePreview, openImage } = useImagePreview();
    const previewRevision = useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const currentReferences = useRef(references);
    useLayoutEffect(() => { currentReferences.current = references; }, [references]);
    const openReferenceImage = useCallback((reference: CanvasResourceReference) => {
        if (!currentReferences.current.some((item) => item.active && item.id === reference.id && item.storageKey === reference.storageKey && item.sourceUrl === reference.sourceUrl && item.signal === reference.signal)) return;
        void openImage({ id: reference.id, storageKey: reference.storageKey, url: reference.sourceUrl, signal: reference.signal });
    }, [openImage]);
    useEffect(() => { for (const reference of references) if (reference.kind === "image") void loadImagePreview(reference.storageKey); }, [references]);
    useLayoutEffect(() => {
        if (imagePreview && !references.some((reference) => reference.active && reference.id === imagePreview.source.id && reference.storageKey === imagePreview.source.storageKey && reference.sourceUrl === imagePreview.source.url && reference.signal === imagePreview.source.signal)) imagePreview.close();
    }, [references, imagePreview]);

    const activeReferences = useMemo(() => references.filter((item) => item.active), [references]);
    const referenceByLabel = useMemo(() => new Map(activeReferences.map((item) => [item.label, item])), [activeReferences]);
    // Match longer labels first so a shorter label cannot split a longer one.
    const activeLabels = useMemo(() => Array.from(new Set(activeReferences.map((item) => item.label))).sort((a, b) => b.length - a.length), [activeReferences]);
    const tokens = useMemo(() => parseTokens(value, activeLabels), [value, activeLabels]);

    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        if (!query) return activeReferences;
        return activeReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, activeReferences]);

    // Rebuild the DOM from value when unfocused, or when a focused value is an external change rather than an emitted echo.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (editor.contains(document.activeElement) && value === lastEmittedRef.current) return;
        editor.textContent = "";
        tokens.forEach((token) => {
            if (token.type === "text") {
                editor.append(document.createTextNode(token.value));
                return;
            }
            const reference = referenceByLabel.get(token.label);
            if (reference) editor.append(createReferenceChip(reference, theme, openReferenceImage));
            else editor.append(document.createTextNode(token.label));
        });
        lastEmittedRef.current = value;
    }, [tokens, referenceByLabel, theme, value, openReferenceImage, previewRevision]);

    const emit = (next: string) => {
        lastEmittedRef.current = next;
        onChange(next);
    };

    const syncFromEditor = () => {
        const editor = editorRef.current;
        if (!editor) return;
        emit(serializeEditor(editor));
        syncMention();
    };

    const syncMention = () => {
        const text = textBeforeCaret();
        const match = /@([^\s@]*)$/.exec(text);
        if (!match || !activeReferences.length) {
            closeMention();
            return;
        }
        setMention({ query: match[1] || "", rect: caretRect() });
        setActiveIndex(0);
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        const editor = editorRef.current;
        if (!editor) return;
        removeActiveMention();
        const chip = createReferenceChip(reference, theme, openReferenceImage);
        const space = document.createTextNode(" ");
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (range) {
            range.insertNode(space);
            range.insertNode(chip);
            range.setStartAfter(space);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
        } else {
            editor.append(chip, space);
            placeCaretAtEnd(editor);
        }
        closeMention();
        emit(serializeEditor(editor));
    };

    const showPlaceholder = !value.trim();

    return (
        <div className="relative w-full">
            {showPlaceholder && placeholder ? (
                <div className="pointer-events-none absolute left-3 top-2 text-sm leading-5" style={{ color: theme.node.placeholder }}>
                    {placeholder}
                </div>
            ) : null}
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                className={`${className || ""} overflow-y-auto whitespace-pre-wrap break-words outline-none`}
                style={{ ...style, cursor: "text" }}
                onInput={() => {
                    if (!composingRef.current) syncFromEditor();
                }}
                onCompositionStart={() => {
                    composingRef.current = true;
                }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                    syncFromEditor();
                }}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    event.stopPropagation();
                    if (isImeComposing(event)) return;
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if ((event.key === "Backspace" || event.key === "Delete") && deleteAdjacentReference(event.key)) {
                        event.preventDefault();
                        requestAnimationFrame(syncFromEditor);
                        return;
                    }
                    if (isPlainEnterKey(event) && onSubmit) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    requestAnimationFrame(syncMention);
                }}
                onBlur={() => window.setTimeout(closeMention, 120)}
            />
            {mention && candidates.length ? (
                <MentionMenu container={editorRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body} rect={mention.rect} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} />
            ) : null}
            {imagePreview?.url ? <ImagePreview key={imagePreview.url} src={imagePreview.url} alt="引用图片预览" container={editorRef.current?.closest<HTMLElement>('[role="dialog"]') ?? undefined} onClose={imagePreview.close} /> : null}
        </div>
    );
}

function MentionMenu({ container, rect, references, activeIndex, theme, onSelect }: { container: HTMLElement; rect: DOMRect | null; references: CanvasResourceReference[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (reference: CanvasResourceReference) => void }) {
    const selectedRef = useRef(false);
    const activeItemRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuHeight, setMenuHeight] = useState(0);

    // 首次显示和筛选后按实际高度定位，避免少量候选项向上展开时远离光标。
    useLayoutEffect(() => {
        setMenuHeight(menuRef.current!.getBoundingClientRect().height);
    }, [references]);

    useEffect(() => {
        activeItemRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, references]);

    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => event.stopPropagation();

    const menuWidth = 256;
    const gap = 6;
    const anchor = rect || new DOMRect(16, 16, 0, 0);
    const left = clamp(anchor.left, 8, window.innerWidth - menuWidth - 8);
    const showAbove = anchor.bottom + gap + menuHeight > window.innerHeight && anchor.top - gap - menuHeight >= 0;
    const top = clamp(showAbove ? anchor.top - gap - menuHeight : anchor.bottom + gap, 8, window.innerHeight - menuHeight - 8);

    return createPortal(
        <div
            ref={menuRef}
            data-canvas-resource-mention-menu="true"
            data-canvas-no-zoom
            data-canvas-shortcuts-ignore
            className="fixed z-[1100] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            {references.map((reference, index) => (
                <button
                    key={reference.id}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                    style={{ background: index === activeIndex ? theme.toolbar.activeBg : "transparent", color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        selectReference(reference);
                    }}
                >
                    <ReferencePreview reference={reference} />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{reference.label}</span>
                        <span className="block truncate opacity-65">{reference.text || reference.title}</span>
                    </span>
                </button>
            ))}
        </div>,
        container,
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    const [failed, setFailed] = useState<string>();
    const preview = reference.kind === "image" ? previewUrlFor(reference.storageKey) : undefined;
    if (preview && preview !== failed) return <img src={preview} alt="" onError={() => setFailed(preview)} className="size-9 rounded-md object-cover" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function createReferenceChip(reference: CanvasResourceReference, theme: (typeof canvasThemes)[keyof typeof canvasThemes], onImagePreview: (reference: CanvasResourceReference) => void) {
    const wrapper = document.createElement(reference.kind === "image" ? "button" : "span");
    wrapper.contentEditable = "false";
    wrapper.dataset.refLabel = reference.label;
    if (reference.kind === "image") {
        wrapper.setAttribute("type", "button");
        wrapper.setAttribute("aria-label", `预览${reference.label}`);
        wrapper.className = "mx-px inline-flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded align-middle";
        const preview = previewUrlFor(reference.storageKey);
        if (preview) {
            const image = document.createElement("img");
            image.src = preview;
            image.alt = reference.title;
            image.className = "size-6 rounded object-cover";
            image.onerror = () => { wrapper.textContent = reference.label; };
            wrapper.appendChild(image);
        } else wrapper.textContent = reference.label;
        wrapper.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            wrapper.closest<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
        });
        wrapper.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        });
        wrapper.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onImagePreview(reference);
        });
    } else {
        wrapper.className = "mx-px inline-flex h-6 max-w-40 items-center justify-center overflow-hidden rounded-md border px-1 text-xs leading-none align-middle";
        Object.assign(wrapper.style, { background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text } as CSSProperties);
        wrapper.title = reference.text || reference.title;
        const text = document.createElement("span");
        text.className = "block truncate";
        text.textContent = reference.kind === "text" ? reference.text || reference.title : reference.label;
        wrapper.appendChild(text);
    }
    return wrapper;
}

function serializeEditor(editor: HTMLElement) {
    return serializeNodes(editor.childNodes).replace(/﻿/g, "");
}

function serializeNodes(nodes: NodeListOf<ChildNode>) {
    let result = "";
    nodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) result += node.textContent || "";
        if (!(node instanceof HTMLElement)) return;
        const label = node.dataset.refLabel;
        if (label) result += label;
        else if (node.tagName === "BR") result += "\n";
        else result += serializeNodes(node.childNodes);
    });
    return result;
}

function removeActiveMention() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    const text = textBeforeCaret();
    const match = /@([^\s@]*)$/.exec(text);
    if (!match) return;
    range.setStart(range.startContainer, Math.max(0, range.startOffset - (match[1] || "").length - 1));
    range.deleteContents();
}

// Chips are atomic contentEditable="false" blocks and are removed as a unit with adjacent Backspace/Delete presses.
function deleteAdjacentReference(key: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentReferenceNode(range, key);
    if (!target) return false;
    const nextCaretNode = document.createTextNode("");
    target.replaceWith(nextCaretNode);
    range.setStart(nextCaretNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function adjacentReferenceNode(range: Range, key: string) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findReferenceSibling(container, previous);
    }
    const children = Array.from(container.childNodes);
    return findReferenceSibling(children[previous ? offset - 1 : offset] || container, previous, true);
}

function findReferenceSibling(node: Node, previous: boolean, includeSelf = false): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && current.dataset.refLabel ? current : null;
}

function textBeforeCaret() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return "";
    const range = selection.getRangeAt(0).cloneRange();
    const editor = closestEditor(range.startContainer);
    if (!editor) return "";
    range.setStart(editor, 0);
    return range.toString();
}

function caretRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height || rect.left || rect.top) return rect;
    // Empty lines and editors produce a zero-sized range, so fall back to the editor bounds.
    const editor = closestEditor(range.startContainer);
    return editor ? editor.getBoundingClientRect() : null;
}

function closestEditor(node: Node) {
    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest("[contenteditable='true']") || null;
}

function placeCaretAtEnd(element: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

// Split value into text fragments and matching active labels, which are already sorted by descending length.
function parseTokens(value: string, labels: string[]): Token[] {
    if (!labels.length) return value ? [{ type: "text", value }] : [];
    const escaped = labels.map(escapeRegExp).join("|");
    const pattern = new RegExp(`(${escaped})`, "g");
    const tokens: Token[] = [];
    let lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
        tokens.push({ type: "reference", label: match[0] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) tokens.push({ type: "text", value: value.slice(lastIndex) });
    return tokens;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}
