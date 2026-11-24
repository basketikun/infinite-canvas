import { useEffect, useState, useSyncExternalStore } from "react";
import { ImageIcon } from "lucide-react";
import { getImagePreviewRevision, loadImagePreview, previewUrlFor, subscribeImagePreviews } from "@workbench/services/image-storage";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";

export function ImageThumbnail({ storageKey, alt, className }: { storageKey?: string; alt: string; className?: string }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [failed, setFailed] = useState<string>();
    const preview = previewUrlFor(storageKey);
    useEffect(() => { void loadImagePreview(storageKey); }, [storageKey]);
    return <span className={cn("grid overflow-hidden place-items-center", className)}>
        {preview && preview !== failed
            ? <img src={preview} alt={alt} onError={() => setFailed(preview)} className="size-full object-cover" />
            : <ImageIcon aria-label={alt} className="size-5 opacity-40" />}
    </span>;
}
