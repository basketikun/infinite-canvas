import { buildCanvasTheme } from "@/lib/theme-presets";
import { useActiveTheme } from "@/stores/use-theme-store";

export function useCanvasTheme() {
    return buildCanvasTheme(useActiveTheme());
}
