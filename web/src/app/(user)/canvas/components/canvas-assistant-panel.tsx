"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUp, History, ImageIcon, LoaderCircle, MessageSquare, PanelRightClose, Plus, RotateCcw, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { App, Button, ConfigProvider, Input, InputNumber, Modal, Popover, Segmented, Tooltip } from "antd";
import { motion } from "motion/react";

import { ImageGenerationPending } from "@/components/image-generation-pending";
import type { AiConfig } from "@/lib/ai-config";
import { canvasThemes } from "@/lib/canvas-theme";
import { createId } from "@/lib/id";
import { cn } from "@/lib/utils";
import { requestEdit, requestGeneration, requestImageQuestion, type ChatCompletionMessage } from "@/services/api/image";
import { imageToDataUrl, uploadImage } from "@/services/image-storage";
import { useAiConfigStore } from "@/stores/use-ai-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import { DiaTextReveal } from "@/components/ui/dia-text-reveal";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasNodeType, type CanvasAssistantImage, type CanvasAssistantMessage, type CanvasAssistantReference, type CanvasAssistantSession, type CanvasNodeData } from "../types";

type AssistantMode = "ask" | "image";
const PANEL_MOTION_MS = 500;
const PANEL_MOTION_SECONDS = PANEL_MOTION_MS / 1000;

type CanvasAssistantPanelProps = {
  nodes: CanvasNodeData[];
  selectedNodeIds: Set<string>;
  sessions: CanvasAssistantSession[];
  activeSessionId: string | null;
  onSelectNodeIds: (ids: Set<string>) => void;
  onSessionsChange: (sessions: CanvasAssistantSession[], activeSessionId: string | null) => void;
  onInsertImage: (image: CanvasAssistantImage) => void;
  onInsertText: (text: string) => void;
  onPasteImage: (file: File) => void;
  onCollapseStart: () => void;
  onCollapse: () => void;
};

export function CanvasAssistantPanel({ nodes, selectedNodeIds, sessions, activeSessionId, onSelectNodeIds, onSessionsChange, onInsertImage, onInsertText, onPasteImage, onCollapseStart, onCollapse }: CanvasAssistantPanelProps) {
  const { message } = App.useApp();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const config = useAiConfigStore((state) => state.config);
  const updateConfig = useAiConfigStore((state) => state.updateConfig);
  const token = useUserStore((state) => state.token);
  const [width, setWidth] = useState(390);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [mode, setMode] = useState<AssistantMode>("image");
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [checkedChatIds, setCheckedChatIds] = useState<string[]>([]);
  const [deleteChatIds, setDeleteChatIds] = useState<string[]>([]);
  const [closing, setClosing] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [removedReferenceIds, setRemovedReferenceIds] = useState<Set<string>>(new Set());
  const [localSessions, setLocalSessions] = useState<CanvasAssistantSession[]>(() => sessions.length ? sessions : [createSession()]);
  const [localActiveSessionId, setLocalActiveSessionId] = useState<string | null>(activeSessionId);

  useEffect(() => {
    if (!sessions.length) return;
    setLocalSessions(sessions);
    setLocalActiveSessionId(activeSessionId);
  }, [activeSessionId, sessions]);

  useEffect(() => {
    onSessionsChange(localSessions, localActiveSessionId);
  }, [localActiveSessionId, localSessions, onSessionsChange]);

  const safeSessions = localSessions.length ? localSessions : [createSession()];
  const activeSession = useMemo(() => safeSessions.find((session) => session.id === localActiveSessionId) || safeSessions[0] || null, [localActiveSessionId, safeSessions]);
  const historySessions = safeSessions.filter((session) => session.messages.length > 0);
  const messages = activeSession?.messages || [];
  const hasMessages = messages.length > 0;
  const selectedNodeKey = useMemo(() => Array.from(selectedNodeIds).sort().join(","), [selectedNodeIds]);
  const allSelectedReferences = useMemo(() => buildAssistantReferences(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
  const selectedReferences = useMemo(() => allSelectedReferences.filter((item) => !removedReferenceIds.has(item.id)), [allSelectedReferences, removedReferenceIds]);
  const iconButtonStyle = { color: theme.node.muted };

  useEffect(() => {
    setRemovedReferenceIds(new Set());
  }, [selectedNodeKey]);

  const updateSession = (sessionId: string, updater: (session: CanvasAssistantSession) => CanvasAssistantSession) => {
    setLocalSessions((prev) => prev.map((session) => session.id === sessionId ? updater(session) : session));
  };

  const appendMessage = (sessionId: string, message: CanvasAssistantMessage) => {
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.messages.length ? session.title : message.text.slice(0, 18) || "新对话",
      messages: [...session.messages, message],
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateMessage = (sessionId: string, messageId: string, patch: Partial<CanvasAssistantMessage>) => {
    updateSession(sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
      updatedAt: new Date().toISOString(),
    }));
  };

  const startChatSession = () => {
    if (activeSession && activeSession.messages.length === 0) {
      setLocalActiveSessionId(activeSession.id);
      return;
    }
    const session = createSession();
    setLocalSessions((prev) => [session, ...prev]);
    setLocalActiveSessionId(session.id);
  };

  const removeSessions = (ids: string[]) => {
    const next = safeSessions.filter((session) => !ids.includes(session.id));
    if (!next.length) {
      const session = createSession();
      setLocalSessions([session]);
      setLocalActiveSessionId(session.id);
    } else {
      setLocalSessions(next);
      setLocalActiveSessionId(localActiveSessionId && ids.includes(localActiveSessionId) ? next[0].id : localActiveSessionId);
    }
    setCheckedChatIds((prev) => prev.filter((id) => !ids.includes(id)));
  };

  const clearSessions = () => {
    const session = createSession();
    setLocalSessions([session]);
    setLocalActiveSessionId(session.id);
    setCheckedChatIds([]);
  };

  const sendMessage = async (text: string, nextMode: AssistantMode, history: CanvasAssistantMessage[], savedReferences?: CanvasAssistantReference[]) => {
    if (!token) {
      message.error("请先登录");
      return;
    }

    const session = activeSession || createSession();
    if (!activeSession) {
      setLocalSessions([session]);
      setLocalActiveSessionId(session.id);
    }

    const refs = savedReferences || selectedReferences;
    const userMessage: CanvasAssistantMessage = { id: createId(), role: "user", mode: nextMode, text, references: refs };
    const assistantId = createId();
    appendMessage(session.id, userMessage);
    appendMessage(session.id, { id: assistantId, role: "assistant", mode: nextMode, text: nextMode === "image" ? "正在生成图片" : "正在回答", isLoading: true });
    setPrompt("");
    setIsRunning(true);

    try {
      if (nextMode === "image") {
        const referenceImages: ReferenceImage[] = await Promise.all(refs.filter((item) => item.dataUrl).map(async (item) => ({ id: item.id, name: `${item.title}.png`, type: "image/png", dataUrl: await imageToDataUrl(item), storageKey: item.storageKey })));
        const { images } = referenceImages.length ? await requestEdit(token, config, text, referenceImages) : await requestGeneration(token, config, text);
        const storedImages = await Promise.all(images.map((image) => uploadImage(image.dataUrl)));
        updateMessage(session.id, assistantId, {
          text: `生成了 ${storedImages.length} 张图片`,
          images: storedImages.map((image, index) => ({ id: images[index].id, dataUrl: image.url, storageKey: image.storageKey, prompt: text })),
          isLoading: false,
        });
        return;
      }

      const answer = await requestImageQuestion(token, await buildChatMessages([...history, userMessage]), (streamed) => {
        updateMessage(session.id, assistantId, { text: streamed, isLoading: false });
      });
      updateMessage(session.id, assistantId, { text: answer, isLoading: false });
    } catch (error) {
      updateMessage(session.id, assistantId, { text: error instanceof Error ? error.message : "操作失败", isLoading: false });
    } finally {
      setIsRunning(false);
    }
  };

  const submit = async () => {
    const text = prompt.trim();
    if (!text || isRunning) return;
    await sendMessage(text, mode, messages);
  };

  const retryMessage = (message: CanvasAssistantMessage) => {
    const index = messages.findIndex((item) => item.id === message.id);
    const userIndex = messages.slice(0, index).findLastIndex((item) => item.role === "user");
    const user = messages[userIndex];
    if (user) void sendMessage(user.text, user.mode, messages.slice(0, userIndex), user.references);
  };

  const startResize = () => {
    const move = (event: MouseEvent) => setWidth(Math.min(760, Math.max(320, window.innerWidth - event.clientX)));
    const stop = () => {
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
    };
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
  };

  const collapse = () => {
    setClosing(true);
    onCollapseStart();
    window.setTimeout(onCollapse, PANEL_MOTION_MS);
  };

  return (
    <motion.div
      className="flex shrink-0"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: closing ? 0 : width + 1, opacity: closing ? 0 : 1 }}
      transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: "clip", pointerEvents: closing ? "none" : undefined }}
    >
      <motion.aside className="relative flex shrink-0 flex-col border-l" initial={{ x: 48 }} animate={{ x: closing ? 28 : 0 }} transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }} style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}>
        <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onMouseDown={startResize} aria-label="调整右侧面板宽度" />
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: theme.node.stroke }}>
          <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4" />{view === "history" ? "历史记录" : "画布助手(未开发)"}</div>
          <div className="flex items-center gap-1">
            {view === "history" ? (
              <>
                <Tooltip title="删除选中">
                  <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<Trash2 className="size-4" />} disabled={!checkedChatIds.length} onClick={() => setDeleteChatIds(checkedChatIds)} />
                </Tooltip>
                <Tooltip title="删除全部">
                  <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<X className="size-4" />} disabled={!historySessions.length} onClick={() => setDeleteChatIds(historySessions.map((session) => session.id))} />
                </Tooltip>
              </>
            ) : null}
            <Tooltip title={view === "history" ? "返回对话" : "历史记录"}>
              <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<History className="size-4" />} onClick={() => setView(view === "history" ? "chat" : "history")} />
            </Tooltip>
            <Tooltip title="新对话">
              <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<Plus className="size-4" />} disabled={!hasMessages} onClick={() => { startChatSession(); setView("chat"); }} />
            </Tooltip>
            <Tooltip title="收起对话">
              <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<PanelRightClose className="size-4" />} onClick={collapse} />
            </Tooltip>
          </div>
        </div>

        <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {view === "history" ? (
            <AssistantHistory
              sessions={historySessions}
              activeSession={activeSession}
              checkedIds={checkedChatIds.filter((id) => historySessions.some((session) => session.id === id))}
              onToggleChecked={(id, checked) => setCheckedChatIds((prev) => checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id))}
              onOpen={(id) => { setLocalActiveSessionId(id); setView("chat"); }}
              onDelete={(id) => setDeleteChatIds([id])}
            />
          ) : messages.length ? (
            <AssistantMessages messages={messages} onRetry={retryMessage} onInsertImage={onInsertImage} onInsertText={onInsertText} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-1 text-center">
              <div className="relative font-serif text-4xl font-bold italic tracking-normal" style={{ color: theme.node.text }}>
                <span>Infinite Canvas</span>
                <DiaTextReveal
                  className="absolute inset-0"
                  colors={["#A97CF8", "#F38CB8", "#FDCC92"]}
                  textColor="transparent"
                  duration={1.8}
                  startOnView={false}
                  text="Infinite Canvas"
                />
              </div>
              <div className="mt-3 font-serif text-base italic tracking-wide opacity-60">One canvas, infinite ideas</div>
            </div>
          )}
        </div>

        {view === "chat" ? (
          <AssistantComposer
            mode={mode}
            prompt={prompt}
            isRunning={isRunning}
            references={selectedReferences}
            config={config}
            onModeChange={setMode}
            onPromptChange={setPrompt}
            onSubmit={submit}
            onConfigChange={updateConfig}
            onRemoveReference={(id) => {
              setRemovedReferenceIds((prev) => new Set(prev).add(id));
              if (selectedNodeIds.has(id)) onSelectNodeIds(new Set(Array.from(selectedNodeIds).filter((nodeId) => nodeId !== id)));
            }}
            onPasteImage={onPasteImage}
          />
        ) : null}

        <Modal
          title="删除对话记录？"
          open={deleteChatIds.length > 0}
          centered
          onCancel={() => setDeleteChatIds([])}
          footer={<>
            <Button onClick={() => setDeleteChatIds([])}>取消</Button>
            <Button
              danger
              type="primary"
              onClick={() => {
                deleteChatIds.length === historySessions.length ? clearSessions() : removeSessions(deleteChatIds);
                setDeleteChatIds([]);
              }}
            >
              删除
            </Button>
          </>}
        >
          <p className="text-sm opacity-60">将删除 {deleteChatIds.length} 条对话记录，此操作不可撤销。</p>
        </Modal>
      </motion.aside>
    </motion.div>
  );
}

function AssistantComposer({
  mode,
  prompt,
  isRunning,
  references,
  config,
  onModeChange,
  onPromptChange,
  onSubmit,
  onConfigChange,
  onRemoveReference,
  onPasteImage,
}: {
  mode: AssistantMode;
  prompt: string;
  isRunning: boolean;
  references: CanvasAssistantReference[];
  config: AiConfig;
  onModeChange: (mode: AssistantMode) => void;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  onConfigChange: (key: keyof AiConfig, value: string) => void;
  onRemoveReference: (id: string) => void;
  onPasteImage: (file: File) => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];

  return (
    <div className="px-2 pb-2" onWheelCapture={(event) => event.stopPropagation()}>
      {references.length ? (
        <div className="thin-scrollbar mb-1.5 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1">
          {references.map((item) => <AssistantReferenceChip key={item.id} item={item} onRemove={() => onRemoveReference(item.id)} />)}
        </div>
      ) : null}
      <div className="rounded-[28px] border px-3 pb-3 pt-3 shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onPaste={(event) => {
            const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
            if (!file) return;
            event.preventDefault();
            onPasteImage(file);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            void onSubmit();
          }}
          className="thin-scrollbar h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:text-stone-400"
          style={{ color: theme.node.text }}
          placeholder={mode === "image" ? "描述你想生成或修改的图片" : "输入你想问的问题"}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <CanvasPromptLibrary onSelect={onPromptChange} />
            <CanvasThemeProvider theme={theme}>
              <Segmented
                size="small"
                className="canvas-composer-mode !rounded-full !p-0.5"
                value={mode}
                onChange={(value) => onModeChange(value as AssistantMode)}
                options={[
                  { value: "ask", label: <Tooltip title="文本"><MessageSquare className="size-4" /></Tooltip> },
                  { value: "image", label: <Tooltip title="生图"><ImageIcon className="size-4" /></Tooltip> },
                ]}
              />
            </CanvasThemeProvider>
            {mode === "image" ? (
              <ImageSettingsPopover config={config} onConfigChange={onConfigChange} />
            ) : null}
          </div>
          <Button type="primary" shape="circle" className="!h-10 !w-10 !min-w-10 shrink-0" icon={isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} disabled={isRunning || !prompt.trim()} onClick={() => void onSubmit()} aria-label="发送" />
        </div>
      </div>
    </div>
  );
}

function ImageSettingsPopover({ config, onConfigChange }: { config: AiConfig; onConfigChange: (key: keyof AiConfig, value: string) => void }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const quality = config.quality || "auto";
  const count = String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1))));
  const sizes = ["1:1", "3:2", "2:3", "16:9", "9:16", "auto"];
  const customSize = sizes.includes(config.size || "auto") ? "" : config.size;
  return (
    <Popover
      trigger="click"
      placement="topLeft"
      arrow={false}
      overlayClassName="canvas-image-settings-popover"
      color={theme.toolbar.panel}
      content={(
        <CanvasThemeProvider theme={theme}>
          <div className="w-[330px] space-y-4" style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-base font-semibold">图像设置</div>
            <div className="space-y-1.5">
              <SettingTitle color={theme.node.muted}>质量</SettingTitle>
              <Segmented block value={quality} onChange={(value) => onConfigChange("quality", String(value))} options={[{ value: "auto", label: "自动" }, { value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }]} />
            </div>
            <div className="space-y-1.5">
              <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
              <div className="grid grid-cols-4 gap-1.5">
                {sizes.map((size) => (
                  <Button key={size} size="small" type={(config.size || "auto") === size ? "primary" : "default"} className="!h-7 !rounded-md !px-1.5" onClick={() => onConfigChange("size", size)}>
                    {size}
                  </Button>
                ))}
                <Input size="small" className="col-span-2 !h-7" placeholder="自定义比例" value={customSize} onChange={(event) => onConfigChange("size", event.target.value.trim() || "auto")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <SettingTitle color={theme.node.muted}>生成数量</SettingTitle>
              <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
                <Segmented block value={["1", "2", "3", "4"].includes(count) ? count : undefined} onChange={(value) => onConfigChange("count", String(value))} options={["1", "2", "3", "4"].map((value) => ({ value, label: `${value} 张` }))} />
                <InputNumber min={1} max={15} size="small" className="canvas-control-number !h-8 !w-full" value={Number(count)} onChange={(value) => onConfigChange("count", String(value || 1))} />
              </div>
            </div>
          </div>
        </CanvasThemeProvider>
      )}
    >
      <Button size="small" type="text" className="!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5" style={{ background: theme.node.fill, color: theme.node.text }} icon={<Settings2 className="size-3.5" />}>
        <span className="truncate">{qualityLabel(quality)} · {config.size || "auto"} · {count} 张</span>
      </Button>
    </Popover>
  );
}

function CanvasThemeProvider({ theme, children }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; children: ReactNode }) {
  return (
    <ConfigProvider theme={{ token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel }, components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text }, Input: { activeBorderColor: theme.node.activeStroke, hoverBorderColor: theme.node.activeStroke }, InputNumber: { activeBorderColor: theme.node.activeStroke, hoverBorderColor: theme.node.activeStroke }, Segmented: { itemColor: theme.node.text, itemHoverBg: theme.node.fill, itemSelectedBg: theme.node.activeStroke, itemSelectedColor: theme.node.panel, trackBg: theme.toolbar.panel, trackPadding: 2 } } }}>
      {children}
    </ConfigProvider>
  );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
  return <div className="text-xs font-medium" style={{ color }}>{children}</div>;
}

function qualityLabel(value: string) {
  return ({ auto: "自动", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

function AssistantMessages({
  messages,
  onRetry,
  onInsertImage,
  onInsertText,
}: {
  messages: CanvasAssistantMessage[];
  onRetry: (message: CanvasAssistantMessage) => void;
  onInsertImage: (image: CanvasAssistantImage) => void;
  onInsertText: (text: string) => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];

  return (
    <>
      {messages.map((message) => (
        <div key={message.id} className={cn("flex flex-col gap-2", message.role === "user" ? "items-end" : "items-start")}>
          <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6" style={message.role === "user" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { background: theme.node.fill, color: theme.node.text }}>
            {message.role === "assistant" ? <div className="mb-1 flex items-center gap-1.5 text-xs opacity-60"><MessageSquare className="size-3.5" />回答</div> : null}
            {message.text}
          </div>
          {message.references?.length ? <MessageReferences message={message} /> : null}
          {message.isLoading ? <ImageGenerationPending compact label={message.mode === "image" ? "正在生成图片" : "正在回答"} className="w-[250px] rounded-2xl border" /> : null}
          {message.role === "assistant" && !message.isLoading ? (
            <div className="flex gap-1">
              <Button shape="circle" size="small" style={{ borderColor: theme.node.stroke }} icon={<RotateCcw className="size-3.5" />} onClick={() => onRetry(message)} title="重试" />
              {!message.images?.length ? <Button shape="circle" size="small" style={{ borderColor: theme.node.stroke }} icon={<Plus className="size-3.5" />} onClick={() => onInsertText(message.text)} title="插入画布" /> : null}
            </div>
          ) : null}
          {message.images?.map((image) => (
            <div key={image.id} className="w-[250px] overflow-hidden rounded-2xl border" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
              <img src={image.dataUrl} alt="" className="aspect-square w-full object-cover" />
              <Button type="text" className="!h-8 !w-full !rounded-none" style={{ borderTop: `1px solid ${theme.node.stroke}`, color: theme.node.text }} icon={<Plus className="size-3.5" />} onClick={() => onInsertImage(image)} title="插入画布" />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function AssistantHistory({
  sessions,
  activeSession,
  checkedIds,
  onToggleChecked,
  onOpen,
  onDelete,
}: {
  sessions: CanvasAssistantSession[];
  activeSession: CanvasAssistantSession | null;
  checkedIds: string[];
  onToggleChecked: (id: string, checked: boolean) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];

  return (
    <div className="space-y-1">
      {sessions.map((session) => (
        <div key={session.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-black/5 dark:hover:bg-white/10" style={session.id === activeSession?.id ? { background: theme.node.fill } : undefined}>
          <input type="checkbox" className="size-4 accent-stone-950" checked={checkedIds.includes(session.id)} onChange={(event) => onToggleChecked(session.id, event.target.checked)} />
          <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => onOpen(session.id)}>
            <span className="block truncate">{session.title}</span>
            <span className="text-xs opacity-50">{session.messages.length} 条消息</span>
          </button>
          <Button type="text" shape="circle" size="small" className="opacity-0 transition group-hover:opacity-100" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(session.id)} title="删除" />
        </div>
      ))}
    </div>
  );
}

function MessageReferences({ message }: { message: CanvasAssistantMessage }) {
  return (
    <div className={cn("flex max-w-[88%] flex-wrap gap-2", message.role === "user" ? "justify-end" : "justify-start")}>
      {message.references?.map((item) => <AssistantReferenceChip key={item.id} item={item} />)}
    </div>
  );
}

function AssistantReferenceChip({ item, onRemove }: { item: CanvasAssistantReference; onRemove?: () => void }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const text = (item.text || item.title).replace(/\s+/g, " ").trim().slice(0, 1) || "文";
  return (
    <div className="group/chip relative inline-flex h-8 max-w-[150px] shrink-0 items-center gap-1.5 rounded-lg text-sm" style={{ color: theme.node.text }}>
      {item.dataUrl ? <img src={item.dataUrl} alt="" className="size-8 rounded-lg object-cover" /> : <span className="grid size-8 place-items-center rounded-lg border text-sm font-medium" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }}>{text}</span>}
      {onRemove ? (
        <button type="button" className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover/chip:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }} onClick={onRemove} aria-label="移除引用">
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function nodeToReference(node: CanvasNodeData): CanvasAssistantReference | null {
  if (node.type === CanvasNodeType.Image && node.metadata?.content) {
    return { id: node.id, type: node.type, title: node.title, dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
  }
  if (node.type === CanvasNodeType.Text && node.metadata?.content) {
    return { id: node.id, type: node.type, title: node.title, text: node.metadata.content };
  }
  return null;
}

function buildAssistantReferences(nodes: CanvasNodeData[], selectedNodeIds: Set<string>) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return Array.from(selectedNodeIds)
    .map((id) => nodeById.get(id))
    .filter((node): node is CanvasNodeData => Boolean(node))
    .map(nodeToReference)
    .filter((item): item is CanvasAssistantReference => Boolean(item));
}

async function buildChatMessages(messages: CanvasAssistantMessage[]): Promise<ChatCompletionMessage[]> {
  return Promise.all(messages.map(async (message, index) => {
    if (message.role === "assistant") return { role: "assistant", content: message.text };
    if (index !== messages.length - 1) return { role: "user", content: message.text };
    const refs = message.references || [];
    return {
      role: "user",
      content: [
        ...refs.flatMap((item) => item.text ? [{ type: "text" as const, text: item.text }] : []),
        { type: "text", text: message.text },
        ...(await Promise.all(refs.filter((item) => item.dataUrl).map(async (item) => ({ type: "image_url" as const, image_url: { url: await imageToDataUrl(item) } })))),
      ],
    };
  }));
}

function createSession(): CanvasAssistantSession {
  const now = new Date().toISOString();
  return { id: createId(), title: "新对话", messages: [], createdAt: now, updatedAt: now };
}
