import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Textarea } from "@infinite-canvas/plugin-sdk/ui/textarea";
import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { MediaPlayer } from "@workbench/components/media-player";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { getImagePreviewRevision, loadImagePreview, previewUrlFor, subscribeImagePreviews } from "@workbench/services/image-storage";
import { flushAssetWrites, useAssetStore, type Asset } from "@workbench/stores/use-asset-store";
import { AssetDialog } from "./asset-dialog";

export function AssetEditor({ asset, trigger, onClosed }: { asset: Asset; trigger: HTMLElement | null; onClosed: () => void }) {
    const id = useId();
    const [open, setOpen] = useState(true);
    const [saving, setSaving] = useState(false);
    const [title, setTitle] = useState(asset.title);
    const [content, setContent] = useState(asset.kind === "text" ? asset.data.content : "");
    const [error, setError] = useState("");
    const [failedPreview, setFailedPreview] = useState<string>();
    const updateAsset = useAssetStore((state) => state.updateAsset);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const image = asset.kind === "image" ? asset : null;
    useEffect(() => {
        if (image) void loadImagePreview(image.data.storageKey);
    }, [image, image?.data.storageKey]);
    const preview = asset.kind === "image" ? asset.coverUrl || previewUrlFor(asset.data.storageKey) : undefined;

    const save = async () => {
        const nextTitle = title.trim();
        if (!nextTitle) {
            setError("请输入标题");
            return;
        }
        if (!useAssetStore.getState().assets.some((item) => item.id === asset.id)) {
            setError("资产已发生变化，请关闭后重试");
            return;
        }
        setSaving(true);
        try {
            if (asset.kind === "text") updateAsset(asset.id, { title: nextTitle, data: { content } });
            else updateAsset(asset.id, { title: nextTitle });
            await flushAssetWrites();
            toast.success("资产已更新", workbenchMessageOptions.success);
            setOpen(false);
        } catch (saveError) {
            console.error("[assets] update", saveError);
            toast.error("资产未能保存，请重试。", workbenchMessageOptions.error);
        } finally { setSaving(false); }
    };

    return <AssetDialog open={open} title="编辑资产" width={760} trigger={trigger} onClosed={onClosed}
        onDismiss={() => { if (!saving) setOpen(false); }}
        action={<Button type="button" aria-label="保存" aria-busy={saving} disabled={saving} onClick={() => void save()}>{saving && <LoaderCircle aria-hidden className="size-4 animate-spin" />}保 存</Button>}>
        <div className="asset-editor-body flex h-[min(520px,68vh)] flex-col gap-5 pt-1">
            <div className="asset-field shrink-0">
                <label htmlFor={`${id}-title`} className="block pb-2">标题</label>
                <Input id={`${id}-title`} value={title} autoFocus aria-required aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-title-error` : undefined} className="asset-input-large"
                    onChange={(event) => { setTitle(event.target.value); if (error) setError(""); }} />
                {error ? <p id={`${id}-title-error`} role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
            </div>
            {asset.kind === "text" ? <div className="asset-field flex min-h-0 flex-1 flex-col">
                <label htmlFor={`${id}-content`} className="block shrink-0 pb-2">文本内容</label>
                <Textarea id={`${id}-content`} value={content} aria-required className="asset-editor-textarea" onChange={(event) => setContent(event.target.value)} />
            </div> : <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-950 dark:border-stone-800">
                {asset.kind === "image" ? (
                    preview && preview !== failedPreview
                        ? <img src={preview} alt="" onError={() => setFailedPreview(preview)} className="mx-auto block max-h-full max-w-full object-contain" />
                        : <div className="grid min-h-40 place-items-center text-sm text-stone-400">暂无预览</div>
                ) : asset.kind === "video" ? (
                    <MediaPlayer key={asset.id} source={{ kind: "video", storageKey: asset.data.storageKey, url: asset.data.url }} className="max-h-full w-full" />
                ) : (
                    <MediaPlayer key={asset.id} source={{ kind: "audio", storageKey: asset.data.storageKey, url: asset.data.url }} className="w-full p-3" />
                )}
            </div>}
        </div>
    </AssetDialog>;
}
