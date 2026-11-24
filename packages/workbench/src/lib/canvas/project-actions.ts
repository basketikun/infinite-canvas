import { PluginError } from "@infinite-canvas/shared/plugins";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";

const deletions = new Map<string, Promise<void>>();

function deleteProject(projectId: string) {
    const pending = deletions.get(projectId);
    if (pending) return pending;
    const store = useCanvasStore.getState();
    store.beginProjectDeletion([projectId]);
    const deletion = (async () => {
        try {
            const [{ stopAgentMessage }, { useAgentChatStore }] = await Promise.all([
                import("@workbench/services/api/agent-chat"),
                import("@workbench/stores/use-agent-chat-store"),
            ]);
            await stopAgentMessage([projectId]);
            await useAgentChatStore.getState().flush(projectId);
            await useAgentChatStore.getState().deleteProjectThreads([projectId]);
            await store.deleteProjects([projectId]);
        } catch (error) {
            store.failProjectDeletion([projectId]);
            throw error;
        } finally {
            if (deletions.get(projectId) === deletion) deletions.delete(projectId);
        }
    })();
    deletions.set(projectId, deletion);
    return deletion;
}

export async function createProject(title: string) {
    if (!useCanvasStore.getState().hydrated) throw new PluginError("PLUGIN_OPERATION_FAILED");
    const projectId = useCanvasStore.getState().createProject(title);
    await useCanvasStore.getState().flush(projectId);
    return projectId;
}

export async function renameProject(projectId: string, title: string) {
    if (!useCanvasStore.getState().hydrated) throw new PluginError("PLUGIN_OPERATION_FAILED");
    if (!useCanvasStore.getState().openProject(projectId)) throw new PluginError("PLUGIN_NOT_FOUND");
    useCanvasStore.getState().renameProject(projectId, title);
    await useCanvasStore.getState().flush(projectId);
}

export async function deleteProjects(projectIds: string[]) {
    const store = useCanvasStore.getState();
    if (!store.hydrated) throw new PluginError("PLUGIN_OPERATION_FAILED");
    const ids = [...new Set(projectIds)];
    if (!ids.length) return;
    if (ids.some((id) => !store.projects.some((project) => project.id === id) && !store.deletedProjects.some((project) => project.id === id))) throw new PluginError("PLUGIN_NOT_FOUND");
    const results = await Promise.allSettled(ids.map(deleteProject));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
}
