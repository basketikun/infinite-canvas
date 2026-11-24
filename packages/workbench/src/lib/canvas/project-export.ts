import { PluginError } from "@infinite-canvas/shared/plugins";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { exportCanvasNodes, exportCanvasProjects } from "./canvas-export";
import type { CanvasSession } from "./canvas-session";
import { bindHostActions } from "./host-actions";
import { readNodeResource } from "./node-registry";

export function registerCanvasProjectExport(session: CanvasSession) {
    return bindHostActions(session, {
        canvasExportProject: async (_, context) => {
            context.signal.throwIfAborted();
            const canvas = context.canvas!;
            const snapshot = canvas.getSnapshot();
            const project = useCanvasStore.getState().projects.find((item) => item.id === session.projectId);
            if (!project) throw new PluginError("PLUGIN_NOT_FOUND");
            await exportCanvasProjects([{ ...project, nodes: snapshot.nodes, connections: snapshot.connections, viewport: snapshot.viewport }], project.title || "无限画布", canvas.signal);
        },
        canvasExportNodes: async ({ nodeIds }, context) => {
            context.signal.throwIfAborted();
            const canvas = context.canvas!;
            const ids = new Set(nodeIds);
            const nodes = canvas.getSnapshot().nodes.filter((node) => ids.has(node.id));
            if (!ids.size || nodes.length !== ids.size) throw new PluginError("PLUGIN_NOT_FOUND");
            const targets = nodes.map((node) => {
                const resource = readNodeResource(node, "export", context.scope);
                if (resource && (resource.kind === "text" ? resource.text === undefined : !(resource.storageKey || resource.url))) throw new PluginError("PLUGIN_NOT_FOUND");
                return { node, resource };
            });
            const caller = AbortSignal.any([context.signal, canvas.signal, session.signal]);
            const sources = targets.flatMap(({ resource }) => resource ? [resource.signal] : []);
            try { await exportCanvasNodes(targets, AbortSignal.any([caller, ...sources])); }
            catch (error) {
                caller.throwIfAborted();
                if (sources.some((source) => source.aborted)) throw new PluginError("PLUGIN_INACTIVE", { cause: error });
                throw error;
            }
        },
    });
}
