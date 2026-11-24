import { FileText, Images, Maximize2, MessageSquare } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "画布",
        icon: Maximize2,
    },
    {
        slug: "create",
        label: "创作",
        icon: MessageSquare,
    },
    {
        slug: "assets",
        label: "资产",
        icon: Images,
    },
    {
        slug: "prompts",
        label: "素材",
        icon: FileText,
    },
] as const;
