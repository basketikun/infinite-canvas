import { ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { EagleFolder } from "@/services/eagle-assets";
import type { Asset } from "@/stores/use-asset-store";
import { cn } from "@/lib/utils";

export type AssetFolderSelection = "all" | "local" | "eagle" | "eagle:uncategorized" | `eagle:${string}`;

type Props = {
    folders: EagleFolder[];
    assets: Asset[];
    localAssetCount: number;
    totalAssetCount: number;
    selection: AssetFolderSelection;
    onSelect: (selection: AssetFolderSelection) => void;
};

export function AssetFolderTree({ folders, assets, localAssetCount, totalAssetCount, selection, onSelect }: Props) {
    const { t } = useTranslation();
    const counts = new Map<string, number>();
    let uncategorizedCount = 0;
    assets.forEach((asset) => {
        const folderIds = asset.metadata?.eagleFolderIds;
        const ids = Array.isArray(folderIds) ? folderIds.filter((id): id is string => typeof id === "string") : [];
        if (!ids.length) uncategorizedCount += 1;
        ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    });

    return (
        <aside className="flex h-full min-w-0 w-64 shrink-0 flex-col overflow-hidden border-r border-stone-200 bg-white/90 px-3 py-5 dark:border-stone-800 dark:bg-stone-950/90">
            <div className="flex items-center gap-2 px-2 text-base font-semibold text-stone-900 dark:text-stone-100">
                <span className="grid size-8 place-items-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-300">
                    <FolderOpen className="size-4" />
                </span>
                <span className="flex-1 truncate">{t("assets.title")}</span>
                <ChevronDown className="size-4 text-stone-400" />
            </div>

            <div className="mt-6 grid gap-1">
                <FolderButton active={selection === "all"} label={t("assets.folders.all")} count={totalAssetCount} onClick={() => onSelect("all")} />
                <FolderButton active={selection === "local"} label={t("assets.folders.local")} count={localAssetCount} onClick={() => onSelect("local")} />
            </div>

            <div className="mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">
                {t("assets.folders.title")} ({folders.length})
            </div>
            <div className="mt-2 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
                <FolderButton active={selection === "eagle"} label={t("assets.folders.eagle")} count={assets.length} onClick={() => onSelect("eagle")} />
                <div className="ml-4 min-w-0 border-l border-stone-200 pl-2 dark:border-stone-800">
                    <FolderButton active={selection === "eagle:uncategorized"} label={t("assets.folders.uncategorized")} count={uncategorizedCount} depth={1} onClick={() => onSelect("eagle:uncategorized")} />
                    <EagleFolderNodes folders={folders} counts={counts} parentId="" selection={selection} onSelect={onSelect} />
                </div>
            </div>
        </aside>
    );
}

function FolderButton({ active, label, count, depth = 0, onClick }: { active: boolean; label: string; count?: number; depth?: number; onClick: () => void }) {
    return (
        <button
            type="button"
            className={cn(
                "group flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition",
                active ? "bg-stone-100 font-medium text-stone-950 shadow-[inset_2px_0_0_#1c1917] dark:bg-stone-800 dark:text-stone-50 dark:shadow-[inset_2px_0_0_#f5f5f4]" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900",
            )}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={onClick}
        >
            {active ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0 text-stone-400 group-hover:text-stone-600 dark:text-stone-500 dark:group-hover:text-stone-300" />}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {typeof count === "number" ? <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">{count}</span> : null}
        </button>
    );
}

function EagleFolderNodes({ folders, counts, parentId, selection, onSelect, depth = 0 }: { folders: EagleFolder[]; counts: Map<string, number>; parentId: string; selection: AssetFolderSelection; onSelect: (selection: AssetFolderSelection) => void; depth?: number }) {
    return (
        <div className="grid min-w-0 gap-1">
            {folders
                .filter((folder) => (folder.parent || "") === parentId)
                .map((folder) => {
                    const id = `eagle:${folder.id}` as AssetFolderSelection;
                    return (
                        <div key={folder.id} className="min-w-0">
                            <FolderButton active={selection === id} label={folder.name} count={counts.get(folder.id) || 0} depth={depth} onClick={() => onSelect(id)} />
                            <EagleFolderNodes folders={folders} counts={counts} parentId={folder.id} selection={selection} onSelect={onSelect} depth={depth + 1} />
                        </div>
                    );
                })}
        </div>
    );
}
