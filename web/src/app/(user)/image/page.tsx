"use client";

import { BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, AutoComplete, Button, Checkbox, Drawer, Empty, Image, Input, InputNumber, Modal, Select, Tag, Typography } from "antd";

import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { RequireAuth } from "@/components/require-auth";
import { AssetPickerModal, type InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import type { AiConfig } from "@/lib/ai-config";
import { createId } from "@/lib/id";
import { formatBytes, formatDuration, getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { deleteGeneration, fetchGenerations, saveGeneration, type GenerationRecord } from "@/services/api/generations";
import { saveMyAsset } from "@/services/api/my-assets";
import { useAiConfigStore } from "@/stores/use-ai-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";

type GeneratedImage = {
  id: string;
  dataUrl: string;
  storageKey?: string;
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
};

type GenerationResult = {
  id: string;
  status: "pending" | "success" | "failed";
  image?: GeneratedImage;
  error?: string;
};

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const sizeOptions = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"].map((value) => ({ label: value, value }));
const qualityOptions = ["auto", "low", "medium", "high"].map((value) => ({ label: value, value }));

export default function ImagePage() {
  return (
    <RequireAuth>
      <ImagePageInner />
    </RequireAuth>
  );
}

function ImagePageInner() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = useAiConfigStore((state) => state.config);
  const updateConfig = useAiConfigStore((state) => state.updateConfig);
  const token = useUserStore((state) => state.token);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [running, setRunning] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [previewLog, setPreviewLog] = useState<GenerationRecord | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const canGenerate = Boolean(prompt.trim());
  const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));

  const logsQuery = useQuery({
    queryKey: ["my-generations", token],
    queryFn: () => fetchGenerations(token, { page: 1, pageSize: 100 }),
    enabled: Boolean(token),
    retry: false,
  });

  useEffect(() => {
    if (logsQuery.isError) {
      message.error(logsQuery.error instanceof Error ? logsQuery.error.message : "读取生成记录失败");
    }
  }, [logsQuery.error, logsQuery.isError, message]);

  const saveLogMutation = useMutation({
    mutationFn: (payload: Parameters<typeof saveGeneration>[1]) => saveGeneration(token, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-generations"] });
    },
  });

  const deleteLogMutation = useMutation({
    mutationFn: (id: string) => deleteGeneration(token, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-generations"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  const logs = logsQuery.data?.items || [];

  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const addReferences = async (files?: FileList | null) => {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    const nextReferences = await Promise.all(imageFiles.map(async (file) => {
      const image = await uploadImage(file);
      return { id: createId(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
    }));
    setReferences((value) => [...value, ...nextReferences]);
  };

  const addReferencesFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
      if (!blobs.length) {
        message.error("剪切板里没有可读取的图片");
        return;
      }
      const nextReferences = await Promise.all(blobs.map(async (blob, index) => {
        const image = await uploadImage(blob);
        return { id: createId(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
      }));
      setReferences((value) => [...value, ...nextReferences]);
      message.success(`已读取 ${nextReferences.length} 张参考图`);
    } catch {
      message.error("剪切板里没有可读取的图片");
    }
  };

  const generate = async () => {
    const text = prompt.trim();
    if (!text) {
      message.error("请输入生图提示词");
      return;
    }
    if (!token) {
      message.error("请先登录");
      return;
    }

    const snapshot = buildRequestSnapshot();
    if (!snapshot) return;

    setElapsedMs(0);
    setRunning(true);
    setPreviewLog(null);
    setResults(Array.from({ length: generationCount }, () => ({ id: createId(), status: "pending" })));
    const batchStartedAt = performance.now();
    setStartedAt(batchStartedAt);

    const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot));

    const result = await Promise.allSettled(tasks);
    const successImages = result
      .filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled")
      .map((item) => item.value);
    const successCount = successImages.length;
    const failCount = generationCount - successCount;
    const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
    const status = successCount === generationCount ? "success" : successCount ? "partial" : "failed";
    const durationMs = performance.now() - batchStartedAt;

    try {
      await saveLogMutation.mutateAsync({
        prompt: text,
        mode: snapshot.references.length ? "edit" : "image",
        model: "",
        size: snapshot.config.size || "",
        quality: snapshot.config.quality || "",
        count: generationCount,
        successCount,
        failCount,
        durationMs,
        status,
        thumbnails: successImages.map((image) => image.storageKey || "").filter(Boolean),
      });
      successCount ? message.success("图片已生成") : message.error(failed?.reason instanceof Error ? failed.reason.message : "生成失败");
    } finally {
      setRunning(false);
    }
  };

  const downloadImage = (image: GeneratedImage, index: number) => {
    const link = document.createElement("a");
    link.href = image.dataUrl;
    link.download = `image-${index + 1}.png`;
    link.click();
  };

  const addResultToReferences = async (image: GeneratedImage, index: number) => {
    const stored = await uploadImage(image.dataUrl);
    setReferences((value) => [...value, { id: createId(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
    message.success("已加入参考图");
  };

  const saveResultToAssets = async (image: GeneratedImage, index: number) => {
    if (!token) {
      message.error("请先登录");
      return;
    }
    try {
      const url = image.dataUrl || (await uploadImage(image.dataUrl)).url;
      await saveMyAsset(token, {
        title: `生成结果 ${index + 1}`,
        type: "image",
        coverUrl: url,
        tags: [],
        category: "生图工作台",
        description: prompt,
        url,
      });
      message.success("已加入我的素材");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    }
  };

  const insertPickedAsset = async (payload: InsertAssetPayload) => {
    if (payload.kind === "text") {
      setPrompt(payload.content);
    } else {
      const stored = await uploadImage(payload.dataUrl);
      setReferences((value) => [...value, { id: createId(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
    }
    setAssetPickerOpen(false);
  };

  const createSession = () => {
    setPrompt("");
    setReferences([]);
    setResults([]);
    setElapsedMs(0);
    setStartedAt(0);
    setSelectedLogIds([]);
    setPreviewLog(null);
  };

  const deleteSelectedLogs = async () => {
    for (const id of selectedLogIds) {
      try {
        await deleteLogMutation.mutateAsync(id);
      } catch {
        // mutation onError handles message
      }
    }
    if (previewLog && selectedLogIds.includes(previewLog.id)) {
      setPreviewLog(null);
      setResults([]);
    }
    setSelectedLogIds([]);
    setDeleteConfirmOpen(false);
  };

  const previewGenerationLog = async (log: GenerationRecord) => {
    setPreviewLog(log);
    setLogsOpen(false);

    // 回填这条记录的工作台参数，让左侧表单同步显示。
    // GenerationRecord 不保存参考图原文件，所以无法恢复参考图列表。
    setPrompt(log.prompt);
    setReferences([]);
    updateConfig("count", String(log.count || 1));
    if (log.size) updateConfig("size", log.size);
    if (log.quality) updateConfig("quality", log.quality);

    const images = await Promise.all(log.thumbnails.map(async (storageKey, index) => {
      const url = await resolveImageUrl(storageKey, "");
      if (!url) return { id: `${log.id}-${index}`, dataUrl: "", storageKey, durationMs: log.durationMs, width: 0, height: 0, bytes: 0 };
      try {
        const meta = await readImageMeta(url);
        return { id: `${log.id}-${index}`, dataUrl: url, storageKey, durationMs: log.durationMs, width: meta.width, height: meta.height, bytes: 0 };
      } catch {
        return { id: `${log.id}-${index}`, dataUrl: url, storageKey, durationMs: log.durationMs, width: 0, height: 0, bytes: 0 };
      }
    }));

    // 成功的图片正常渲染；失败的位置补 failed 占位卡片，让用户感知这条记录有失败。
    const successResults = images.map((image) => ({ id: image.id, status: "success" as const, image }));
    const totalSlots = Math.max(log.count || 0, successResults.length + (log.failCount || 0));
    const failedCount = Math.max(0, totalSlots - successResults.length);
    const failedResults = Array.from({ length: failedCount }, (_, index) => ({
      id: `${log.id}-fail-${index}`,
      status: "failed" as const,
      error: "生成失败",
    }));
    setResults([...successResults, ...failedResults]);
  };

  const buildRequestSnapshot = () => {
    const text = prompt.trim();
    if (!text) {
      message.error("请输入生图提示词");
      return null;
    }
    if (!token) {
      message.error("请先登录");
      return null;
    }
    return { text, config: { ...config, count: "1" }, references: [...references] };
  };

  const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }) => {
    const itemStartedAt = performance.now();
    try {
      const { images } = snapshot.references.length ? await requestEdit(token, snapshot.config, snapshot.text, snapshot.references) : await requestGeneration(token, snapshot.config, snapshot.text);
      const image = images[0];
      if (!image) throw new Error("接口没有返回图片");
      const stored = await uploadImage(image.dataUrl);
      const meta = await readImageMeta(stored.url);
      const nextImage: GeneratedImage = { id: image.id, dataUrl: stored.url, storageKey: stored.storageKey, durationMs: performance.now() - itemStartedAt, width: meta.width, height: meta.height, bytes: getDataUrlByteSize(image.dataUrl) };
      setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
      return nextImage;
    } catch (error) {
      setResults((value) => updateResultAt(value, index, { status: "failed", error: error instanceof Error ? error.message : "生成失败" }));
      throw error;
    }
  };

  const retryResult = (index: number) => {
    const snapshot = buildRequestSnapshot();
    if (!snapshot) return;
    setPreviewLog(null);
    setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
    void runGenerationSlot(index, snapshot).catch(() => {});
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
          <LogPanel logs={logs} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={(log) => void previewGenerationLog(log)} />
        </aside>

        <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">生图工作台</h1>
                  </div>
                  <div className="flex shrink-0 gap-2 lg:hidden">
                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>记录</Button>
                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>参数</Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-base font-semibold">提示词</span>
                    <div className="flex gap-2">
                      <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>查看提示词库</Button>
                      <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>查看我的素材</Button>
                    </div>
                  </div>
                  <Input.TextArea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={7}
                    placeholder="描述画面主体、风格、构图、光线和用途"
                  />
                </div>

                <div className="min-w-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-base font-semibold">参考图</span>
                    <div className="flex gap-2">
                      <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>剪切板</Button>
                      <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>上传</Button>
                    </div>
                  </div>
                  <div className="hover-scrollbar hover-scrollbar-hint flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed border-stone-300 p-2 pb-3 overscroll-x-contain dark:border-stone-700" onWheel={(event) => {
                    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                    event.preventDefault();
                    event.currentTarget.scrollLeft += event.deltaY;
                  }}>
                    {references.map((item) => (
                      <div key={item.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                        <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                        <button type="button" className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label="移除参考图">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图</div> : null}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                  <span className="truncate text-stone-500 dark:text-stone-400">{config.size} · {config.quality}</span>
                  <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>调整</Button>
                </div>

                <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                  <GenerationSettings config={config} updateConfig={updateConfig} />
                </div>
              </div>

              <div className="mt-auto pt-6">
                <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                  开始生成
                </Button>
              </div>
            </div>

          <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">生成结果</h2>
                </div>
                {running ? <Tag className="m-0 px-2 py-1">等待 {formatDuration(elapsedMs)}</Tag> : null}
              </div>
              {results.length ? (
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {results.map((result, index) => (
                    result.status === "success" && result.image ? (
                      <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                    ) : result.status === "failed" ? (
                      <FailedImageCard key={result.id} error={result.error || "生成失败"} onRetry={() => retryResult(index)} />
                    ) : (
                      <PendingImageCard key={result.id} />
                    )
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                  <ImagePlus className="mb-4 size-11 text-stone-400" />
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有生成图片" />
                </div>
              )}
          </div>
        </section>
      </main>
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => {
        void addReferences(event.target.files);
        event.target.value = "";
      }} />
      <Drawer title="生成记录" placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
        <LogPanel logs={logs} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={(log) => void previewGenerationLog(log)} />
      </Drawer>
      <Drawer title="参数" placement="bottom" size="default" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <div className="grid grid-cols-2 gap-3">
          <GenerationSettings config={config} updateConfig={updateConfig} />
        </div>
      </Drawer>
      <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
      <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
      <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={() => void deleteSelectedLogs()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
        确定删除选中的 {selectedLogIds.length} 条生成记录吗？
      </Modal>
    </div>
  );
}

function GenerationSettings({ config, updateConfig }: { config: AiConfig; updateConfig: UpdateAiConfig }) {
  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">生成次数</span>
        <InputNumber className="canvas-control-number !w-full" min={1} max={10} value={Number(config.count) || 1} onChange={(value) => updateConfig("count", String(value || 1))} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">尺寸</span>
        <AutoComplete className="canvas-control-select w-full" value={config.size} options={sizeOptions} placeholder="例如 1:1、3:2" onChange={(value) => updateConfig("size", value)} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">质量</span>
        <Select className="canvas-control-select w-full" value={config.quality} options={qualityOptions} onChange={(value) => updateConfig("quality", value)} />
      </label>
    </>
  );
}

function ResultImageCard({ image, index, onEdit, onDownload, onSaveAsset }: { image: GeneratedImage; index: number; onEdit: (image: GeneratedImage, index: number) => void; onDownload: (image: GeneratedImage, index: number) => void; onSaveAsset: (image: GeneratedImage, index: number) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
      <Image src={image.dataUrl} alt={`生成结果 ${index + 1}`} className="aspect-square object-cover" />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
        <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
          {image.width && image.height ? <span>{image.width}x{image.height}</span> : null}
          {image.bytes ? <span>{formatBytes(image.bytes)}</span> : null}
          {image.durationMs ? <span>{formatDuration(image.durationMs)}</span> : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>添加到素材</Button>
          <Button size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>加入参考图</Button>
          <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>下载</Button>
        </div>
      </div>
    </div>
  );
}

function PendingImageCard() {
  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
        <LoaderCircle className="size-6 animate-spin" />
        <span>生成中</span>
      </div>
    </div>
  );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
      <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
        <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
        <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
          {error}
        </Typography.Paragraph>
      </div>
      <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
        <Button size="small" danger onClick={onRetry}>重试</Button>
      </div>
    </div>
  );
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
  return results.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item);
}

function LogPanel({ logs, selectedLogIds, activeLogId, onSelectedLogIdsChange, onCreateSession, onDeleteSelected, onPreviewLog }: { logs: GenerationRecord[]; selectedLogIds: string[]; activeLogId?: string; onSelectedLogIdsChange: (ids: string[]) => void; onCreateSession: () => void; onDeleteSelected: () => void; onPreviewLog: (log: GenerationRecord) => void }) {
  const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
  const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">生成记录</h2>
        </div>
        <Tag className="m-0">{logs.length}</Tag>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>新建</Button>
        <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>{allSelected ? "取消" : "全选"}</Button>
        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>删除</Button>
      </div>
      <div className="space-y-3">
        {logs.map((log) => (
          <LogCard
            key={log.id}
            log={log}
            selected={selectedLogIds.includes(log.id)}
            active={activeLogId === log.id}
            onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
            onClick={() => onPreviewLog(log)}
          />
        ))}
        {!logs.length ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">
            暂无生成记录
          </div>
        ) : null}
      </div>
    </>
  );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationRecord; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
  const title = log.prompt?.slice(0, 24) || "未命名";
  const time = useMemo(() => log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false }) : "", [log.createdAt]);
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all((log.thumbnails || []).slice(0, 4).map((key) => resolveImageUrl(key, "")))
      .then((urls) => {
        if (!cancelled) setThumbUrls(urls.filter(Boolean));
      });
    return () => {
      cancelled = true;
    };
  }, [log.thumbnails]);

  return (
    <button type="button" className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`} onClick={onClick}>
      <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
          <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-5">{title}</div>
            {thumbUrls.length ? (
              <div className="mt-2 flex gap-1 overflow-hidden">
                {thumbUrls.map((image, index) => <img key={`${log.id}-${index}`} src={image} alt="" className="size-8 shrink-0 rounded-md object-cover" />)}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid justify-items-end gap-2">
          <div className="flex gap-1">
            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">成功 {log.successCount}</Tag>
            {log.failCount ? <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">失败 {log.failCount}</Tag> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.count} 张</Tag>
            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">{formatDuration(log.durationMs)}</Tag>
          </div>
          <div className="flex justify-end">
            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{time}</Tag>
          </div>
        </div>
      </div>
    </button>
  );
}
