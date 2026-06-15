"use client";

import React, { useState } from "react";
import { Grid2x2, Group, Rows3, SplitSquareVertical, Ungroup } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeGroup, ViewportTransform } from "../types";

type CanvasSelectionBoundingBoxProps = {
    selectedNodes: CanvasNodeData[];
    group?: CanvasNodeGroup;
    viewport: ViewportTransform;
    onGroup: () => void;
    onUngroup: () => void;
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
    onRenameGroup?: (groupId: string, label: string) => void;
    onSortNodes?: (direction: "horizontal" | "vertical" | "grid") => void;
};

const PADDING_X = 48;
const PADDING_TOP = 32;
const PADDING_BOTTOM = 48;

export function CanvasSelectionBoundingBox({ selectedNodes, group, viewport, onGroup, onUngroup, onMouseDown, onRenameGroup, onSortNodes }: CanvasSelectionBoundingBoxProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [isEditingLabel, setIsEditingLabel] = useState(false);
    const [labelDraft, setLabelDraft] = useState("");
    const [sortOpen, setSortOpen] = useState(false);

    if (!selectedNodes.length) return null;
    if (selectedNodes.length === 1 && !group) return null;

    const minX = Math.min(...selectedNodes.map((node) => node.position.x)) - PADDING_X;
    const minY = Math.min(...selectedNodes.map((node) => node.position.y)) - PADDING_TOP;
    const maxX = Math.max(...selectedNodes.map((node) => node.position.x + node.width)) + PADDING_X;
    const maxY = Math.max(...selectedNodes.map((node) => node.position.y + node.height)) + PADDING_BOTTOM;
    const width = maxX - minX;
    const height = maxY - minY;
    const isGrouped = Boolean(group);
    const uiScale = Math.min(1 / viewport.k, 1.5);

    const commitLabel = () => {
        if (group && labelDraft.trim()) onRenameGroup?.(group.id, labelDraft.trim());
        setIsEditingLabel(false);
    };

    return (
        <div
            data-selection-bounding-box
            className="absolute pointer-events-auto cursor-move"
            style={{
                left: minX,
                top: minY,
                width,
                height,
                zIndex: 5,
                border: isGrouped ? `2px solid ${theme.canvas.selectionStroke}` : `2px dashed ${theme.canvas.selectionStroke}`,
                borderRadius: 16,
                background: isGrouped ? theme.canvas.selectionFill : "transparent",
                boxShadow: isGrouped ? `0 0 0 1px ${theme.canvas.selectionStroke}22` : undefined,
            }}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onMouseDown(event);
            }}
        >
            {isGrouped && group ? (
                isEditingLabel ? (
                    <input
                        value={labelDraft}
                        onChange={(event) => setLabelDraft(event.target.value)}
                        onBlur={commitLabel}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") commitLabel();
                            if (event.key === "Escape") setIsEditingLabel(false);
                        }}
                        autoFocus
                        className="absolute h-8 rounded-lg border px-2 text-sm outline-none"
                        style={{
                            top: 8,
                            right: "calc(100% + 8px)",
                            width: 150,
                            transform: `scale(${uiScale})`,
                            transformOrigin: "top right",
                            background: theme.toolbar.panel,
                            borderColor: theme.toolbar.border,
                            color: theme.node.text,
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                ) : (
                    <button
                        type="button"
                        className="absolute h-8 max-w-44 truncate rounded-lg border px-2 text-sm font-medium shadow-lg backdrop-blur transition hover:opacity-85"
                        style={{
                            top: 8,
                            right: "calc(100% + 8px)",
                            transform: `scale(${uiScale})`,
                            transformOrigin: "top right",
                            background: theme.toolbar.panel,
                            borderColor: theme.toolbar.border,
                            color: theme.node.text,
                        }}
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            setLabelDraft(group.label);
                            setIsEditingLabel(true);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        {group.label}
                    </button>
                )
            ) : null}

            {!isGrouped && selectedNodes.length > 1 ? (
                <div
                    className="absolute right-0 top-0 flex -translate-y-full gap-2 pb-2"
                    style={{
                        transform: `scale(${uiScale}) translateY(-100%)`,
                        transformOrigin: "bottom right",
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <ToolbarButton icon={<Group className="size-4" />} label="Group" onClick={onGroup} />
                </div>
            ) : null}

            {isGrouped ? (
                <div
                    className="absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-full gap-2 pb-2"
                    style={{
                        transform: `translateX(-50%) scale(${uiScale}) translateY(-100%)`,
                        transformOrigin: "bottom center",
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <div className="relative">
                        <ToolbarButton icon={<Rows3 className="size-4" />} label="Sort" onClick={() => setSortOpen((value) => !value)} />
                        {sortOpen ? (
                            <div className="absolute bottom-full left-0 mb-1 w-36 overflow-hidden rounded-xl border shadow-xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
                                <SortButton
                                    icon={<SplitSquareVertical className="size-4 rotate-90" />}
                                    label="Horizontal"
                                    onClick={() => {
                                        onSortNodes?.("horizontal");
                                        setSortOpen(false);
                                    }}
                                />
                                <SortButton
                                    icon={<SplitSquareVertical className="size-4" />}
                                    label="Vertical"
                                    onClick={() => {
                                        onSortNodes?.("vertical");
                                        setSortOpen(false);
                                    }}
                                />
                                <SortButton
                                    icon={<Grid2x2 className="size-4" />}
                                    label="Grid"
                                    onClick={() => {
                                        onSortNodes?.("grid");
                                        setSortOpen(false);
                                    }}
                                />
                            </div>
                        ) : null}
                    </div>
                    <ToolbarButton icon={<Ungroup className="size-4" />} label="Ungroup" onClick={onUngroup} />
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <button
            type="button"
            className="flex h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium shadow-lg backdrop-blur transition hover:opacity-85"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onClick={onClick}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

function SortButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <button type="button" className="flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm transition hover:opacity-75" style={{ color: theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
