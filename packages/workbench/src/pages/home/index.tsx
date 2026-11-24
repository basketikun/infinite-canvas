import { useEffect, useRef, useState, type UIEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import type { CanvasAssetInput } from "@infinite-canvas/plugin-sdk";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { PromptMasonry } from "@workbench/components/prompts/prompt-masonry";
import { usePromptList } from "@workbench/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "@workbench/components/prompts/prompt-detail-dialog";
import { CreateComposer } from "@workbench/pages/create/components/create-composer";
import { CanvasProjectCard } from "@workbench/components/canvas/canvas-project-card";
import { CanvasDeleteProjectsDialog } from "@workbench/components/canvas/canvas-delete-projects-dialog";
import { PromptSelectDialog } from "@workbench/components/prompts/prompt-select-dialog";
import { AssetPickerModal } from "@workbench/components/canvas/asset-picker-modal";
import { ImagePreviewGroup } from "@workbench/components/ui/image-preview-group";
import { useCopyText } from "@workbench/hooks/use-copy-text";
import { useGroupedImagePreview } from "@workbench/hooks/use-grouped-image-preview";
import { useReferenceImages } from "@workbench/hooks/use-reference-images";
import { useReferencePaste } from "@workbench/hooks/use-reference-paste";
import { ALL_PROMPTS_OPTION, type Prompt } from "@workbench/services/api/prompts";
import { savePromptAssets } from "@workbench/services/prompt-assets";
import { stageCreateDraft } from "@workbench/services/create/draft";
import { greeting } from "@workbench/lib/greeting";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { useConfigStore, useEffectiveConfig } from "@workbench/stores/use-config-store";
import type { CreateMode } from "@workbench/services/create/logs";

type HomeMode = "create" | "canvas";

const HOME_SECTION_EASE = [0.22, 1, 0.36, 1] as const;
const MATERIALS_LOAD_AHEAD = 480;

export default function HomePage() {
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [mode, setMode] = useState<HomeMode>("create");
    const [type, setType] = useState<CreateMode>("agent");
    const [prompt, setPrompt] = useState("");
    const [preparing, setPreparing] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const { query: promptsQuery, items: prompts } = usePromptList({ keyword: "", tags: [], category: ALL_PROMPTS_OPTION });
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const copyText = useCopyText();
    const pageSignal = useRef(new AbortController());
    const pageAbort = () => pageSignal.current.signal;
    const { references, setReferences, acceptReferences, addReferenceFiles, pasteReferenceImages, readReference } = useReferenceImages(undefined, { registerAssets: true });
    const { preview, open: openPreview } = useGroupedImagePreview();
    useReferencePaste((files) => void addReferenceFiles(files, pageAbort()), () => void pasteReferenceImages(pageAbort()));

    useEffect(() => {
        const controller = new AbortController();
        pageSignal.current = controller;
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (promptsQuery.isError) console.error("[home] read prompts", promptsQuery.error);
    }, [promptsQuery.error, promptsQuery.isError]);

    const loadMorePrompts = (event: UIEvent<HTMLElement>) => {
        const target = event.currentTarget;
        if (promptsQuery.hasNextPage && !promptsQuery.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - MATERIALS_LOAD_AHEAD) void promptsQuery.fetchNextPage();
    };

    const startCreate = async () => {
        const text = prompt.trim();
        if (!text || preparing) return;
        setPreparing(true);
        try {
            const files = [];
            for (const item of references) {
                const blob = await readReference(item, pageAbort());
                files.push(new File([blob], item.name, { type: item.type || "image/png" }));
            }
            stageCreateDraft({ type, files });
            navigate(`/create?prompt=${encodeURIComponent(text)}&type=${type}&run=1`);
        } catch (error) {
            console.error("[home] prepare create", error);
            if (!pageAbort().aborted) toast.error("参考图暂时无法带入创作页，请重试。", workbenchMessageOptions.error);
        } finally {
            if (!pageAbort().aborted) setPreparing(false);
        }
    };

    const insertPickedAsset = async (payload: CanvasAssetInput) => {
        if (payload.kind === "text") setPrompt(payload.content);
        else if (payload.kind === "image") await acceptReferences([{ id: nanoid(), name: payload.title, type: payload.mimeType, dataUrl: payload.url, storageKey: payload.storageKey }], pageAbort(), "append");
        else toast.warning("首页只能使用文本或图片资产。", workbenchMessageOptions.warning);
    };
    const savePromptAsset = async (item: Prompt) => {
        try {
            const result = await savePromptAssets(item);
            if (result.imageFailed) toast.warning("文本已加入，封面图片暂时无法保存。", workbenchMessageOptions.warning);
            else toast.success("已加入我的资产", workbenchMessageOptions.success);
        } catch (error) {
            console.error("[home] save prompt asset", error);
            toast.error("暂时无法保存素材，请重试。", workbenchMessageOptions.error);
        }
    };

    return <main className="h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)] text-foreground" onScroll={loadMorePrompts}>
        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-12 sm:pt-16">
            <header className="text-center">
                <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-[38px]">
                    {greeting()}，今天想要<span className="text-primary">创作</span>什么？
                </h1>
                <div className="relative mt-8 inline-flex items-center rounded-full border border-border bg-foreground/[0.03] p-1" aria-label="首页模式">
                    {(["create", "canvas"] as const).map((item) => <button key={item} type="button" aria-pressed={mode === item}
                        className={cn("relative h-9 min-w-32 rounded-full px-6 text-sm transition-colors", mode === item ? "font-medium text-background" : "text-muted-foreground hover:text-foreground")}
                        onClick={() => setMode(item)}>
                        {mode === item ? <motion.span layoutId="home-mode-indicator" className="absolute inset-0 rounded-full bg-foreground shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 34 }} /> : null}
                        <span className="relative">{item === "create" ? "创作" : "画布"}</span>
                    </button>)}
                </div>
            </header>

            <motion.section key={mode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: HOME_SECTION_EASE }} className="mt-8" aria-label={mode === "create" ? "开始创作" : "最近画布"}>
                {mode === "create" ? <CreateComposer
                    inline
                    type={type}
                    onTypeChange={setType}
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    references={references}
                    running={preparing}
                    config={config}
                    updateConfig={updateConfig}
                    onGenerate={() => void startCreate()}
                    onAddFiles={(files) => void addReferenceFiles(files, pageAbort())}
                    onRemoveReference={(id) => setReferences((items) => items.filter((item) => item.id !== id))}
                    onPreviewReference={(item, items = references) => {
                        const list = items.length ? items : [item];
                        const index = Math.max(0, list.findIndex((reference) => reference.id === item.id));
                        void openPreview(list.map((reference, order) => ({
                            id: `reference:${reference.id}`,
                            alt: `参考图 ${order + 1}`,
                            storageKey: reference.storageKey,
                            url: reference.url || reference.dataUrl,
                            signal: pageAbort(),
                            read: (signal) => readReference(reference, signal),
                        })), index);
                    }}
                    onOpenPrompts={() => setPromptDialogOpen(true)}
                    onOpenAssets={() => setAssetPickerOpen(true)}
                    openConfigDialog={openConfigDialog}
                /> : <div>
                    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                        <div>
                            <h2 className="text-base font-semibold">画布</h2>
                            <p className="mt-1 text-xs text-muted-foreground">继续最近的画布，或新建一个。</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/canvas")}>全部画布</Button>
                            <Button type="button" size="sm" onClick={() => navigate("/canvas?mode=new")}><Plus className="size-4" />新建画布</Button>
                        </div>
                    </div>
                    {!hydrated ? <p className="py-10 text-center text-sm text-muted-foreground">正在读取画布…</p> : projects.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.slice(0, 3).map((project) => <CanvasProjectCard key={project.id} project={project} />)}
                    </div> : <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
                        <p className="text-sm text-muted-foreground">还没有画布</p>
                        <Button type="button" size="sm" onClick={() => navigate("/canvas?mode=new")}><Plus className="size-4" />新建画布</Button>
                    </div>}
                    <CanvasDeleteProjectsDialog />
                </div>}
            </motion.section>

            <section className="mt-16" aria-labelledby="home-materials">
                <div className="flex items-end justify-between gap-4">
                    <div>
                        <h2 id="home-materials" className="text-lg font-semibold">素材</h2>
                        <p className="mt-1 text-xs text-muted-foreground">来自提示词库</p>
                    </div>
                </div>
                {promptsQuery.isLoading ? <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {Array.from({ length: 8 }, (_, item) => <div key={item} className="aspect-square animate-pulse rounded-xl bg-foreground/[0.05]" />)}
                </div> : promptsQuery.isError ? <p className="mt-4 rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">素材暂时无法加载。</p> : prompts.length ? <div className="mt-4"><PromptMasonry items={prompts} onOpen={setSelectedPrompt} onCopy={(item) => void copyText(item.prompt, "提示词已复制")} onSave={(item) => void savePromptAsset(item)} /></div> : <p className="mt-4 rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">暂无素材</p>}
                {!promptsQuery.isLoading && !promptsQuery.isError && prompts.length ? <p className="mt-6 text-center text-xs text-muted-foreground">
                    {promptsQuery.isFetchingNextPage ? "加载中…" : promptsQuery.hasNextPage ? "继续向下滚动加载更多" : "已经到底了"}
                </p> : null}
            </section>
        </div>
        <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(text) => void copyText(text, "提示词已复制")} onSaveAsset={(item) => void savePromptAsset(item)} />
        <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
        <AssetPickerModal open={assetPickerOpen} parentSignal={pageSignal.current.signal} onInsert={insertPickedAsset} onClose={() => setAssetPickerOpen(false)} />
        {preview ? <ImagePreviewGroup items={preview.items} current={preview.index} open onChange={preview.select} onOpenChange={(open) => { if (!open) preview.close(); }} /> : null}
    </main>;
}

