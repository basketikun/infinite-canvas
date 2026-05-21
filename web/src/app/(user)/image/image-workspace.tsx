"use client";

import { BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, ImagePlus, ImageOff, LoaderCircle, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, AutoComplete, Button, Checkbox, Drawer, Empty, Image, Input, InputNumber, Modal, Select, Tag, Typography } from "antd";

import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import type { AiConfig } from "@/lib/ai-config";
import { createId } from "@/lib/id";
import { formatBytes, formatDuration, getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useImageUploader } from "@/lib/use-image-uploader";
import { deleteGeneration, fetchGenerations, saveGeneration, type GenerationListResponse, type GenerationRecord } from "@/services/api/generations";
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

type GenerationResultStatus = "pending" | "success" | "failed" | "missing";

type GenerationResult = {
  id: string;
  status: GenerationResultStatus;
  image?: GeneratedImage;
  error?: string;
};

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const sizeOptions = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"].map((value) => ({ label: value, value }));
const qualityOptions = ["auto", "low", "medium", "high"].map((value) => ({ label: value, value }));

export type ImageWorkspaceProps = {
  initialLogId?: string;
};

export function ImageWorkspace({ initialLogId }: ImageWorkspaceProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = useAiConfigStore((state) => state.config);
  const updateConfig = useAiConfigStore((state) => state.updateConfig);
  const token = useUserStore((state) => state.token);
  const uploadWithToast = useImageUploader();
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
  const autoPreviewedIdRef = useRef<string | null>(null);

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
    onSuccess: (saved) => {
      // 立刻把新记录推到 react-query 缓存最前，避免随后 router.replace 到 /image/{id}
      // 后，新挂载的页面读到旧缓存找不到这条记录而误报"记录不存在"。
      queryClient.setQueryData<GenerationListResponse>(["my-generations", token], (old) => {
        if (!old) return { items: [saved], total: 1 };
        const exists = old.items.some((item) => item.id === saved.id);
        if (exists) return { ...old, items: old.items.map((item) => (item.id === saved.id ? saved : item)) };
        return { ...old, items: [saved, ...old.items], total: old.total + 1 };
      });
      void queryClient.invalidateQueries({ queryKey: ["my-generations"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "记录保存失败");
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

  // 直接访问 /image/{id} 或在记录列表里点击某条记录后，自动把对应记录展开到右侧。
  useEffect(() => {
    if (!initialLogId) return;
    if (autoPreviewedIdRef.current === initialLogId) return;
    if (!logs.length) return;
    const target = logs.find((log) => log.id === initialLogId);
    if (!target) {
      // 找不到这条记录，回 /image 不要让 URL 一直挂着无效 id。
      autoPreviewedIdRef.current = initialLogId;
      message.error("生成记录不存在或已被删除");
      router.replace("/image");
      return;
    }
    autoPreviewedIdRef.current = initialLogId;
    void previewGenerationLog(target, { skipNavigate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLogId, logs.length]);

  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const addReferences = async (files?: FileList | null) => {
    const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
    const nextReferences = await Promise.all(imageFiles.map(async (file) => {
      const image = await uploadWithToast(file, { label: "参考图" });
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
        const image = await uploadWithToast(blob, { label: "参考图" });
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

    const mode = snapshot.references.length ? "edit" : "image";
    const referenceKeys = snapshot.references.map((ref) => ref.storageKey || "").filter(Boolean);
    const sizeValue = snapshot.config.size || "";
    const qualityValue = snapshot.config.quality || "";
    const requestParams: Record<string, unknown> = {
      mode,
      n: 1,
      size: sizeValue,
      quality: qualityValue,
      referenceCount: snapshot.references.length,
    };

    // 第一阶段：点击「开始生成」就立刻入库一条 status=running 占位记录。
    // 这样即使浏览器关掉、网络抖动、所有 task 失败，用户也能在历史里看到这次调用，
    // URL 也立刻切到 /image/{id}，刷新可恢复。
    let placeholder: GenerationRecord;
    try {
      placeholder = await saveLogMutation.mutateAsync({
        prompt: text,
        mode,
        model: "",
        size: sizeValue,
        quality: qualityValue,
        count: generationCount,
        successCount: 0,
        failCount: 0,
        durationMs: 0,
        status: "running",
        thumbnails: [],
        references: referenceKeys,
        errors: [],
        requestParams,
        upstreamMeta: "",
      });
    } catch {
      // mutation onError 已弹 message；首阶段都没入库，干脆中止避免空转。
      setRunning(false);
      return;
    }
    setPreviewLog(placeholder);
    autoPreviewedIdRef.current = placeholder.id;
    router.replace(`/image/${placeholder.id}`);

    // 第二阶段：跑全部 task，结束后用 placeholder.id upsert 最终状态。
    const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot));
    const result = await Promise.allSettled(tasks);
    const successItems = result
      .filter((item): item is PromiseFulfilledResult<SlotOutcome> => item.status === "fulfilled")
      .map((item) => item.value);
    const successImages = successItems.map((item) => item.image);
    const successCount = successImages.length;
    const failCount = generationCount - successCount;
    const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
    const status = successCount === generationCount ? "success" : successCount ? "partial" : "failed";
    const durationMs = performance.now() - batchStartedAt;
    const errors = result
      .filter((item): item is PromiseRejectedResult => item.status === "rejected")
      .map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason)));
    const upstreamMeta = successItems[successItems.length - 1]?.upstreamMeta || "";

    try {
      const saved = await saveLogMutation.mutateAsync({
        id: placeholder.id,
        prompt: text,
        mode,
        model: "",
        size: sizeValue,
        quality: qualityValue,
        count: generationCount,
        successCount,
        failCount,
        durationMs,
        status,
        thumbnails: successImages.map((image) => image.storageKey || "").filter(Boolean),
        references: referenceKeys,
        errors,
        requestParams,
        upstreamMeta,
      });
      setPreviewLog(saved);
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
    const stored = await uploadWithToast(image.dataUrl, { label: "参考图" });
    setReferences((value) => [...value, { id: createId(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
    message.success("已加入参考图");
  };

  const saveResultToAssets = async (image: GeneratedImage, index: number) => {
    if (!token) {
      message.error("请先登录");
      return;
    }
    try {
      const url = image.dataUrl || (await uploadWithToast(image.dataUrl, { label: "素材图片" })).url;
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
      const stored = await uploadWithToast(payload.dataUrl, { label: "参考图" });
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
    autoPreviewedIdRef.current = null;
    router.replace("/image");
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
      autoPreviewedIdRef.current = null;
      router.replace("/image");
    }
    setSelectedLogIds([]);
    setDeleteConfirmOpen(false);
  };

  const previewGenerationLog = async (log: GenerationRecord, options: { skipNavigate?: boolean } = {}) => {
    setPreviewLog(log);
    setLogsOpen(false);

    // 如果是当前会话正在跑的 running 记录，generate() 自己维护 results（pending → success/failed），
    // 这里千万别去重写 results，否则 task 还没跑完 UI 就会被刷成「生成被中断」误导用户。
    // 此时仅回填参数 / 切 URL，不动 results / references。
    if (log.status === "running" && running) {
      if (!options.skipNavigate) {
        autoPreviewedIdRef.current = log.id;
        router.replace(`/image/${log.id}`);
      }
      return;
    }

    // 回填这条记录的工作台参数，让左侧表单同步显示。
    setPrompt(log.prompt);
    updateConfig("count", String(log.count || 1));
    if (log.size) updateConfig("size", log.size);
    if (log.quality) updateConfig("quality", log.quality);

    // 回填参考图：log.references 是 image storageKey 列表
    if (log.references?.length) {
      const restored = await Promise.all(log.references.map(async (storageKey, index) => {
        const url = await resolveImageUrl(storageKey, "");
        return {
          id: `${log.id}-ref-${index}`,
          name: `ref-${index + 1}`,
          type: "image/*",
          dataUrl: url,
          storageKey,
        } as ReferenceImage;
      }));
      setReferences(restored.filter((ref) => ref.dataUrl));
    } else {
      setReferences([]);
    }

    // 右侧"生成结果"区域逐张恢复：
    //  - 成功且 IndexedDB 还能找到图片 → 显示成功卡
    //  - 成功但本地图片缓存丢失（换浏览器/清缓存）→ 显示"缓存丢失"卡，区别于真正失败
    //  - 原本就生成失败的张数 → 失败占位卡
    const resolved = await Promise.all(log.thumbnails.map(async (storageKey, index) => {
      const url = await resolveImageUrl(storageKey, "");
      if (!url) return { kind: "missing" as const, storageKey, index };
      try {
        const meta = await readImageMeta(url);
        return {
          kind: "success" as const,
          image: { id: `${log.id}-${index}`, dataUrl: url, storageKey, durationMs: log.durationMs, width: meta.width, height: meta.height, bytes: 0 },
          index,
        };
      } catch {
        return {
          kind: "success" as const,
          image: { id: `${log.id}-${index}`, dataUrl: url, storageKey, durationMs: log.durationMs, width: 0, height: 0, bytes: 0 },
          index,
        };
      }
    }));

    const successResults: GenerationResult[] = resolved
      .filter((item): item is Extract<typeof item, { kind: "success" }> => item.kind === "success")
      .map((item) => ({ id: item.image.id, status: "success", image: item.image }));
    const missingResults: GenerationResult[] = resolved
      .filter((item): item is Extract<typeof item, { kind: "missing" }> => item.kind === "missing")
      .map((item) => ({ id: `${log.id}-missing-${item.index}`, status: "missing", error: "本地图片缓存丢失" }));

    const accountedSlots = successResults.length + missingResults.length;
    const totalSlots = Math.max(log.count || 0, accountedSlots + (log.failCount || 0));
    const failedSlotCount = Math.max(0, totalSlots - accountedSlots);
    // running 状态意味着这条记录在 task 跑完前页面就被关掉/刷新，前端 task 已丢失，
    // 把剩余 slot 显示成"已中断，请重试"，跟真实的"生成失败"做语义区分。
    const failedErrorMessage = log.status === "running" ? "生成被中断，请点击重试" : "生成失败";
    const failedResults: GenerationResult[] = Array.from({ length: failedSlotCount }, (_, index) => ({
      id: `${log.id}-fail-${index}`,
      status: "failed",
      error: failedErrorMessage,
    }));
    setResults([...successResults, ...missingResults, ...failedResults]);

    if (!options.skipNavigate) {
      autoPreviewedIdRef.current = log.id;
      router.replace(`/image/${log.id}`);
    }
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

  type SlotOutcome = { image: GeneratedImage; upstreamMeta?: string };
  const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }): Promise<SlotOutcome> => {
    const itemStartedAt = performance.now();
    try {
      const res = snapshot.references.length
        ? await requestEdit(token, snapshot.config, snapshot.text, snapshot.references)
        : await requestGeneration(token, snapshot.config, snapshot.text);
      const image = res.images[0];
      if (!image) throw new Error("接口没有返回图片");
      const stored = await uploadImage(image.dataUrl);
      const meta = await readImageMeta(stored.url);
      const nextImage: GeneratedImage = { id: image.id, dataUrl: stored.url, storageKey: stored.storageKey, durationMs: performance.now() - itemStartedAt, width: meta.width, height: meta.height, bytes: getDataUrlByteSize(image.dataUrl) };
      setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
      return { image: nextImage, upstreamMeta: res.upstreamMeta };
    } catch (error) {
      setResults((value) => updateResultAt(value, index, { status: "failed", error: error instanceof Error ? error.message : "生成失败" }));
      throw error;
    }
  };

  const retryResult = async (index: number) => {
    const snapshot = buildRequestSnapshot();
    if (!snapshot) return;
    const currentLog = previewLog;
    setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
    let retried: SlotOutcome | undefined;
    let retryError = "";
    try {
      retried = await runGenerationSlot(index, snapshot);
    } catch (error) {
      retryError = error instanceof Error ? error.message : "生成失败";
    }
    if (!currentLog) return;

    // 重试用的参考图可能跟首次不同（用户失败后又新加了图），用 snapshot 抓的实际
    // 调用值更新到记录里，下次刷新才能恢复出参考图列表。
    const newReferences = snapshot.references.map((ref) => ref.storageKey || "").filter(Boolean);
    const newMode = newReferences.length ? "edit" : "image";
    const newRequestParams: Record<string, unknown> = {
      mode: newMode,
      n: 1,
      size: currentLog.size,
      quality: currentLog.quality,
      referenceCount: newReferences.length,
      retry: true,
    };

    if (!retried) {
      // 重试失败：只把错误信息追加到 errors，不动 thumbnails / successCount，
      // upstreamMeta 保持原有不覆盖。
      const nextErrors = [...(currentLog.errors || [])];
      if (retryError) nextErrors.push(retryError);
      try {
        const saved = await saveLogMutation.mutateAsync({
          id: currentLog.id,
          prompt: currentLog.prompt,
          mode: newMode,
          model: currentLog.model,
          size: currentLog.size,
          quality: currentLog.quality,
          count: currentLog.count,
          successCount: currentLog.successCount,
          failCount: currentLog.failCount,
          durationMs: currentLog.durationMs,
          status: currentLog.status,
          thumbnails: currentLog.thumbnails,
          references: newReferences,
          errors: nextErrors,
          requestParams: newRequestParams,
          upstreamMeta: currentLog.upstreamMeta,
        });
        setPreviewLog(saved);
      } catch {
        // mutation onError 已 message 提示
      }
      return;
    }

    // 重试成功：upsert thumbnails、successCount/failCount、最新的 upstreamMeta。
    const retriedImage = retried.image;
    if (!retriedImage.storageKey) return;
    const nextThumbnails = [...currentLog.thumbnails];
    if (!nextThumbnails.includes(retriedImage.storageKey)) {
      nextThumbnails.push(retriedImage.storageKey);
    }
    const successCount = Math.min(currentLog.count, currentLog.successCount + 1);
    const failCount = Math.max(0, currentLog.failCount - 1);
    const newStatus = successCount >= currentLog.count ? "success" : successCount > 0 ? "partial" : "failed";

    try {
      const saved = await saveLogMutation.mutateAsync({
        id: currentLog.id,
        prompt: currentLog.prompt,
        mode: newMode,
        model: currentLog.model,
        size: currentLog.size,
        quality: currentLog.quality,
        count: currentLog.count,
        successCount,
        failCount,
        durationMs: currentLog.durationMs,
        status: newStatus,
        thumbnails: nextThumbnails,
        references: newReferences,
        errors: currentLog.errors,
        requestParams: newRequestParams,
        upstreamMeta: retried.upstreamMeta || currentLog.upstreamMeta,
      });
      setPreviewLog(saved);
    } catch {
      // mutation onError 已 message 提示
    }
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
                    ) : result.status === "missing" ? (
                      <MissingImageCard key={result.id} />
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

function MissingImageCard() {
  // 与"生成失败"区分开：这条记录原本生成成功了，只是图片 Blob 没存在当前浏览器里。
  return (
    <div className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
        <ImageOff className="size-7 text-amber-500" />
        <div className="text-sm font-medium text-amber-700 dark:text-amber-300">图片缓存丢失</div>
        <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-amber-600 dark:!text-amber-300">
          这张图原本生成成功，但当前浏览器的本地缓存里找不到它（多发生在换浏览器、清缓存、隐身模式时）。原图无法找回，仍可看到提示词和参数。
        </Typography.Paragraph>
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
            {log.status === "running" ? (
              <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="gold">进行中</Tag>
            ) : (
              <>
                <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">成功 {log.successCount}</Tag>
                {log.failCount ? <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">失败 {log.failCount}</Tag> : null}
              </>
            )}
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
