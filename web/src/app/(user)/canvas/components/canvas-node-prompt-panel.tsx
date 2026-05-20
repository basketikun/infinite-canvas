"use client";

import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { Button, InputNumber } from "antd";

import { defaultConfig, type AiConfig } from "@/lib/ai-config";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAiConfigStore } from "@/stores/use-ai-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasSizePicker } from "./canvas-size-picker";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
  node: CanvasNodeData;
  isRunning: boolean;
  onPromptChange: (nodeId: string, prompt: string) => void;
  onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
  onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate }: CanvasNodePromptPanelProps) {
  const globalConfig = useAiConfigStore((state) => state.config);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const mode = defaultMode(node.type);
  const config = buildNodeConfig(globalConfig, node, mode);
  const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
  const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
  const isEditingExistingContent = hasTextContent || hasImageContent;
  const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");

  useEffect(() => {
    setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
  }, [isEditingExistingContent, node.id]);

  const updatePrompt = (value: string) => {
    setPrompt(value);
    if (!isEditingExistingContent) onPromptChange(node.id, value);
  };

  const submit = () => {
    const text = prompt.trim();
    if (!text || isRunning) return;
    onGenerate(node.id, mode, text);
    setPrompt("");
  };

  return (
    <div
      className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
      style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <textarea
        value={prompt}
        onChange={(event) => updatePrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.shiftKey) return;
          event.preventDefault();
          submit();
        }}
        className="thin-scrollbar h-24 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-5 outline-none"
        style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
        placeholder={mode === "image" ? hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容" : hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容"}
      />

      <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CanvasPromptLibrary onSelect={updatePrompt} />
          {mode === "image" ? (
            <CanvasSizePicker className="h-10 w-[92px] shrink-0" value={config.size} onChange={(value) => onConfigChange(node.id, { size: value })} />
          ) : null}
          {mode === "image" ? (
            <InputNumber min={1} max={15} className="canvas-compact-control canvas-control-number h-10 shrink-0 !w-[58px]" value={Math.floor(Math.abs(Number(config.count)) || 1)} onChange={(value) => onConfigChange(node.id, { count: Number(value) || 1 })} />
          ) : null}
        </div>
        <Button
          type="primary"
          shape="circle"
          className="!h-10 !w-10 !min-w-10 shrink-0"
          disabled={isRunning || !prompt.trim()}
          onClick={submit}
          icon={isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          aria-label="生成"
        />
      </div>
    </div>
  );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
  return type === CanvasNodeType.Text ? "text" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
  return {
    quality: globalConfig.quality || defaultConfig.quality,
    size: node.metadata?.size || globalConfig.size || defaultConfig.size,
    count: String(node.metadata?.count || (mode === "image" ? 3 : globalConfig.count) || defaultConfig.count),
  };
}
