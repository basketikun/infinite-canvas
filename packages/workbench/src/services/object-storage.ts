import { network } from "@workbench/services/network/runtime";
import { uploadPublicMedia } from "@infinite-canvas/model-runtime/object-storage";
import { useWorkspaceConfigStore, workspaceConfigWrites } from "@workbench/stores/use-workspace-config-store";

export async function toPublicMediaUrl(source: string | Blob, signal?: AbortSignal) {
    await workspaceConfigWrites.flush();
    return uploadPublicMedia(source, useWorkspaceConfigStore.getState().objectStorage, async (source) => {
        if (source instanceof Blob) return source;
        const response = await fetch(network.url(source), { signal });
        if (!response.ok) throw new Error("SCRIPT_REFERENCE_READ_FAILED");
        return response.blob();
    }, network.url, signal);
}
