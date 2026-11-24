import copy from "copy-to-clipboard";
import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";

export function useCopyText(failureFeedback: "toast" | "command" = "toast") {
    const view = useRef<AbortSignal | null>(null);
    useLayoutEffect(() => {
        const controller = new AbortController();
        view.current = controller.signal;
        return () => controller.abort();
    }, []);
    return useCallback(async (value: string, successText = "已复制", signal?: AbortSignal) => {
        const owner = view.current;
        if (!owner || owner.aborted || signal?.aborted) return false;
        const copied = await copy(value).catch(() => false);
        if (!owner.aborted && !signal?.aborted) {
            if (copied) toast.success(successText, workbenchMessageOptions.success);
            else if (failureFeedback === "toast") toast.error("复制失败，请手动复制。", workbenchMessageOptions.error);
        }
        return copied;
    }, [failureFeedback]);
}
