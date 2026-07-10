import { useMemo } from "react";
import { FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";

import { useTranslation } from "@/components/layout/locale-provider";
import type { TranslationKey } from "@/i18n";

const navigationToolDefs = [
    { slug: "canvas", labelKey: "nav.canvas", icon: Maximize2 },
    { slug: "image", labelKey: "nav.image", icon: ImagePlus },
    { slug: "video", labelKey: "nav.video", icon: Video },
    { slug: "prompts", labelKey: "nav.prompts", icon: FileText },
    { slug: "assets", labelKey: "nav.assets", icon: Images },
] as const;

export type NavigationToolSlug = (typeof navigationToolDefs)[number]["slug"];

export function useNavigationTools() {
    const { t } = useTranslation();

    return useMemo(
        () =>
            navigationToolDefs.map((tool) => ({
                ...tool,
                label: t(tool.labelKey as TranslationKey),
            })),
        [t],
    );
}

export const navigationToolSlugs = navigationToolDefs.map((tool) => tool.slug);
