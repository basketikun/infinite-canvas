import Image from "@rc-component/image";
import { useState } from "react";
import { ArrowLeftRight, ArrowUpDown, ChevronLeft, ChevronRight, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";

const icons = {
    close: <X role="img" aria-label="关闭" />,
    prev: <ChevronLeft role="img" aria-label="上一张" />,
    next: <ChevronRight role="img" aria-label="下一张" />,
    flipY: <ArrowUpDown />,
    flipX: <ArrowLeftRight />,
    rotateLeft: <RotateCcw />,
    rotateRight: <RotateCw />,
    zoomOut: <ZoomOut />,
    zoomIn: <ZoomIn />,
};

type ImagePreviewGroupProps = {
    items: { src?: string; alt: string }[];
    current: number;
    open: boolean;
    onChange: (index: number) => void;
    onOpenChange: (open: boolean) => void;
};

export function ImagePreviewGroup({ items, current, open, onChange, onOpenChange }: ImagePreviewGroupProps) {
    const image = items[current];
    return <Image.PreviewGroup items={items} icons={icons} classNames={{ popup: { root: "workbench-image-preview" } }}
        preview={{ current, open, onChange, onOpenChange, alt: image?.alt,
            ...(image && image.src === undefined && {
                imageRender: () => <span role="status" className="text-sm text-(--preview-ink)">正在读取图片…</span>,
                actionsRender: () => null,
            }),
        }} />;
}

export function ImagePreview({ src, alt, container, onClose }: { src: string; alt: string; container?: HTMLElement; onClose: () => void }) {
    const [open, setOpen] = useState(true);
    return <Image src={src} alt={alt} styles={{ root: { display: "none" } }} classNames={{ popup: { root: "workbench-image-preview" } }}
        preview={{ open, alt, icons, zIndex: container ? 1101 : 1080, getContainer: container, onOpenChange: setOpen, afterOpenChange: (visible) => { if (!visible) onClose(); } }} />;
}
