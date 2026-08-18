import { Button, Dropdown, Space, type MenuProps } from "antd";
import { ChevronDown, Folder, FolderOpen, FolderPlus, RefreshCw } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { EagleFolder } from "@/services/eagle-assets";
import type { AssetSaveTarget } from "@/services/asset-save";
import { cn } from "@/lib/utils";

export type AssetSaveMenuOptions = {
    eagleFolders: EagleFolder[];
    eagleLoading?: boolean;
    eagleError?: string | null;
    onRefreshEagle?: () => void;
};

type SharedProps = AssetSaveMenuOptions & {
    onSave: (target: AssetSaveTarget) => void | Promise<void>;
};

export function AssetSaveButton({
    label,
    icon = <FolderPlus className="size-3.5" />,
    type = "default",
    size = "small",
    className,
    style,
    disabled,
    ...props
}: SharedProps & { label: ReactNode; icon?: ReactNode; type?: "default" | "primary" | "dashed" | "text" | "link"; size?: "small" | "middle" | "large"; className?: string; style?: CSSProperties; disabled?: boolean }) {
    const { t } = useTranslation();
    const menu = useAssetSaveMenu(props);
    return (
        <Space.Compact block className={cn("min-w-0", className)} style={style}>
            <Button size={size} type={type} disabled={disabled} className="min-w-0 flex-1" onClick={() => void props.onSave({ provider: "local" })}>
                <span className="flex min-w-0 items-center justify-center gap-1.5 truncate">
                    {icon}
                    <span className="truncate">{label}</span>
                </span>
            </Button>
            <Dropdown trigger={["click"]} placement="bottomLeft" menu={menu}>
                <Button size={size} type={type} disabled={disabled} aria-label={t("assets.target")} className="shrink-0 !px-1.5" icon={<ChevronDown className="size-3.5" />} />
            </Dropdown>
        </Space.Compact>
    );
}

export function AssetSaveMenu({ children, placement = "bottomLeft", onOpenChange, ...props }: SharedProps & { children: ReactNode; placement?: "bottomLeft" | "bottomRight" | "topLeft" | "topRight"; onOpenChange?: (open: boolean) => void }) {
    const menu = useAssetSaveMenu(props);
    return (
        <Dropdown trigger={["click"]} placement={placement} menu={menu} onOpenChange={onOpenChange}>
            {children}
        </Dropdown>
    );
}

function useAssetSaveMenu({ eagleFolders, eagleLoading = false, eagleError, onRefreshEagle, onSave }: SharedProps): MenuProps {
    const { t } = useTranslation();
    return useMemo(() => {
        const eagleChildren: NonNullable<MenuProps["items"]> = eagleError
            ? [{ key: "eagle:retry", icon: <RefreshCw className="size-4" />, label: t("assets.retryEagle") }]
            : [{ key: "eagle:uncategorized", icon: <FolderOpen className="size-4" />, label: t("assets.folders.uncategorized") }, ...buildFolderItems(eagleFolders)];
        const items: MenuProps["items"] = [
            { key: "local", icon: <Folder className="size-4" />, label: t("assets.targets.local") },
            { type: "divider" },
            {
                key: "eagle",
                icon: <FolderOpen className="size-4 text-sky-500" />,
                label: eagleLoading ? `${t("assets.targets.eagle")} · ${t("assets.eagleLoading")}` : eagleError ? `${t("assets.targets.eagle")} · ${t("assets.eagleUnavailable")}` : t("assets.targets.eagle"),
                disabled: eagleLoading,
                children: eagleChildren,
            },
        ];
        return {
            items,
            onClick: ({ key }) => {
                if (key === "local") return void onSave({ provider: "local" });
                if (key === "eagle:retry") return void onRefreshEagle?.();
                if (key === "eagle:uncategorized") return void onSave({ provider: "eagle" });
                if (key.startsWith("eagle:")) return void onSave({ provider: "eagle", folderId: key.slice("eagle:".length) });
            },
        };
    }, [eagleError, eagleFolders, eagleLoading, onRefreshEagle, onSave, t]);
}

function buildFolderItems(folders: EagleFolder[], parent = ""): NonNullable<MenuProps["items"]> {
    return folders
        .filter((folder) => (folder.parent || "") === parent)
        .map((folder) => {
            const children = buildFolderItems(folders, folder.id);
            return {
                key: `eagle:${folder.id}`,
                icon: <Folder className="size-4" />,
                label: folder.name,
                ...(children.length ? { children } : {}),
            };
        });
}

export function eagleSaveMessageKey(kind: "text" | "image" | "video", provider: AssetSaveTarget["provider"]) {
    if (provider === "local") return "common.addedToAssets" as const;
    return kind === "text" ? "assets.eagleTextSaved" : "assets.eagleSaved";
}
