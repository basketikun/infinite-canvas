"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Segmented, Tooltip } from "antd";
import { Camera, Download, FolderPlus, Image as ImageIcon, Info, Lock, LockOpen, Maximize2, MessageSquare, Minus, Pencil, Plus, RefreshCw, Scissors, Settings2, Trash2, Upload } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "../types";

type CanvasNodeHoverToolbarProps = {
  node: CanvasNodeData | null;
  viewport: ViewportTransform;
  onKeep: (nodeId: string) => void;
  onLeave: () => void;
  onInfo: (node: CanvasNodeData) => void;
  onEditText: (node: CanvasNodeData) => void;
  onDecreaseFont: (node: CanvasNodeData) => void;
  onIncreaseFont: (node: CanvasNodeData) => void;
  onToggleDialog: (node: CanvasNodeData) => void;
  onGenerateImage: (node: CanvasNodeData) => void;
  onUpload: (node: CanvasNodeData) => void;
  onDownload: (node: CanvasNodeData) => void;
  onPreviewImage: (node: CanvasNodeData) => void;
  onSaveAsset: (node: CanvasNodeData) => void;
  onCrop: (node: CanvasNodeData) => void;
  onAngle: (node: CanvasNodeData) => void;
  onRetry: (node: CanvasNodeData) => void;
  onToggleFreeResize: (node: CanvasNodeData) => void;
  onDelete: (node: CanvasNodeData) => void;
};

export function CanvasNodeHoverToolbar({
  node,
  viewport,
  onKeep,
  onLeave,
  onInfo,
  onEditText,
  onDecreaseFont,
  onIncreaseFont,
  onToggleDialog,
  onGenerateImage,
  onUpload,
  onDownload,
  onPreviewImage,
  onSaveAsset,
  onCrop,
  onAngle,
  onRetry,
  onToggleFreeResize,
  onDelete,
}: CanvasNodeHoverToolbarProps) {
  if (!node) return null;

  const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
  const top = viewport.y + node.position.y * viewport.k - 14;
  const isImage = node.type === CanvasNodeType.Image;
  const hasImage = isImage && Boolean(node.metadata?.content);
  const isText = node.type === CanvasNodeType.Text;
  const isConfig = node.type === CanvasNodeType.Config;
  const canOpenDialog = isText || hasImage;
  const canRetry = node.metadata?.status === "error";
  const hasSpecificTools = canRetry || isText || isImage || isConfig;

  return (
    <div
      className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
      style={{ left, top }}
      onMouseEnter={() => onKeep(node.id)}
      onMouseLeave={onLeave}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ToolbarAction title="查看节点信息" label="信息" icon={<Info className="size-4" />} onClick={() => onInfo(node)} />
      <ToolbarAction title="移除节点" label="删除" icon={<Trash2 className="size-4" />} onClick={() => onDelete(node)} danger />
      {hasSpecificTools ? <ToolbarDivider /> : null}
      {canRetry ? <ToolbarAction title="重新生成" label="重试" icon={<RefreshCw className="size-4" />} onClick={() => onRetry(node)} /> : null}
      {hasImage || isText ? <ToolbarAction title="加入我的素材" label="存素材" icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(node)} /> : null}
      {hasImage ? <IconAction title="放大查看" icon={<Maximize2 className="size-5" />} onClick={() => onPreviewImage(node)} /> : null}
      {hasImage ? <IconAction title="下载图片" icon={<Download className="size-5" />} onClick={() => onDownload(node)} /> : null}
      {canOpenDialog ? <ToolbarAction title="编辑" label="编辑" icon={<MessageSquare className="size-4" />} onClick={() => onToggleDialog(node)} /> : null}
      {isText ? <ToolbarAction title="编辑文本" label="编辑文字" icon={<Pencil className="size-4" />} onClick={() => onEditText(node)} /> : null}
      {isText ? <ToolbarAction title="用文本生图" label="生图" icon={<ImageIcon className="size-4" />} onClick={() => onGenerateImage(node)} /> : null}
      {isConfig ? <ToolbarAction title="生成配置" label="生成配置" icon={<Settings2 className="size-4" />} onClick={() => onInfo(node)} /> : null}
      {isText ? <ToolbarAction title="减小字号" label="缩小" icon={<Minus className="size-4" />} onClick={() => onDecreaseFont(node)} /> : null}
      {isText ? <ToolbarAction title="增大字号" label="放大" icon={<Plus className="size-4" />} onClick={() => onIncreaseFont(node)} /> : null}
      {isImage ? <ToolbarAction title={hasImage ? "替换图片" : "上传图片"} label={hasImage ? "替换图片" : "上传图片"} icon={<Upload className="size-4" />} onClick={() => onUpload(node)} /> : null}
      {hasImage ? <ToolbarAction title={node.metadata?.freeResize ? "切换为等比缩放" : "切换为自由比例"} label={node.metadata?.freeResize ? "自由比例" : "锁比例"} icon={node.metadata?.freeResize ? <LockOpen className="size-4" /> : <Lock className="size-4" />} onClick={() => onToggleFreeResize(node)} active={node.metadata?.freeResize} /> : null}
      {hasImage ? <ToolbarAction title="裁剪并生成新节点" label="裁剪" icon={<Scissors className="size-4" />} onClick={() => onCrop(node)} /> : null}
      {hasImage ? <ToolbarAction title="生成角度" label="多角度" icon={<Camera className="size-4" />} onClick={() => onAngle(node)} /> : null}
    </div>
  );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const [view, setView] = useState<"info" | "json">("info");
  const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
  const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
  const json = useMemo(() => {
    if (!node) return "";
    return JSON.stringify(node, (key, value) => {
      if (key === "title") return undefined;
      if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
        return "[base64 image]";
      }
      return value;
    }, 2);
  }, [node]);

  useEffect(() => {
    if (open) setView("info");
  }, [node?.id, open]);

  const title = (
    <div className="flex items-center justify-between gap-4 pr-12">
      <span>节点信息</span>
      <Segmented
        size="small"
        value={view}
        onChange={(value) => setView(value as "info" | "json")}
        options={[
          { label: "信息", value: "info" },
          { label: "JSON", value: "json" },
        ]}
      />
    </div>
  );

  return (
    <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
      {node ? (
        <div className="h-[56vh] min-h-[360px] text-sm">
          {view === "info" ? (
            <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
              <InfoRow label="ID" value={node.id} />
              <InfoRow label="类型" value={node.type === CanvasNodeType.Text ? "文本" : node.type === CanvasNodeType.Image ? "图片" : "生成配置"} />
              <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
              <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
              <InfoRow label="状态" value={node.metadata?.status || "idle"} />
              {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
              {node.metadata?.prompt ? <InfoRow label="提示词" value={node.metadata.prompt} /> : null}
              {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
              {node.metadata?.errorDetails ? <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>{node.metadata.errorDetails}</div> : null}
            </div>
          ) : (
            <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
              {json}
            </pre>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function ToolbarAction({ title, label, icon, onClick, hint, active = false, danger = false }: { title: string; label: string; icon: ReactNode; onClick?: () => void; hint?: string; active?: boolean; danger?: boolean }) {
  return (
    <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
      <button type="button" className={`group relative flex h-12 items-center whitespace-nowrap px-1.5 ${danger ? "text-[#ef4444]" : ""}`} onClick={onClick} aria-label={title}>
        <span className={`flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1] ${active ? "bg-[#eeeeef]" : ""}`}>
          {icon}
          <span>{label}</span>
          {hint ? <span className="text-[#a3a3a3]">{hint}</span> : null}
        </span>
      </button>
    </Tooltip>
  );
}

function IconAction({ title, icon, onClick }: { title: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
      <button type="button" className="group relative grid h-12 w-12 place-items-center px-1.5" onClick={onClick} aria-label={title}>
        <span className="grid size-9 place-items-center rounded-lg transition group-hover:bg-[#f0f0f1]">{icon}</span>
      </button>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-7 w-px scale-x-50 bg-[#dedee2]" />;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
      <span className="opacity-50">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
    </div>
  );
}
