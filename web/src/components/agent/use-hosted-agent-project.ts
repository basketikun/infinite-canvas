import { useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { useParams } from "react-router-dom";

import { hostedAgentApi } from "@/services/api/hosted-agent";
import { hostedAgentConfigured } from "@/services/api/supabase";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const bindingRequests = new Set<string>();
const publishedRevisions = new Map<string, number>();

export function useHostedAgentProject() {
    const { message } = App.useApp();
    const { id = "" } = useParams<{ id: string }>();
    const [bindingAttempt, setBindingAttempt] = useState(0);
    const [binding, setBinding] = useState(false);
    const [canvasHydrated, setCanvasHydrated] = useState(false);
    const user = useUserStore((state) => state.user);
    const accessToken = useUserStore((state) => state.accessToken);
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === id && item.localOwnerUserId === user?.id));
    const bindAgentProject = useCanvasStore((state) => state.bindAgentProject);
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const bound = Boolean(user && project?.agentOwnerUserId === user.id && project.agentProjectId && project.agentCanvasWorkspaceId);

    useEffect(() => {
        if (!hostedAgentConfigured || !user || !accessToken || !project || bound) return;
        const key = `${user.id}:${project.id}`;
        if (bindingRequests.has(key)) return;
        bindingRequests.add(key);
        setBinding(true);
        void hostedAgentApi.createProject(accessToken, project.title).then((created) => {
            bindAgentProject(project.id, { projectId: created.id, canvasWorkspaceId: created.canvasWorkspaceId, ownerUserId: user.id });
        }).catch((error) => {
            bindingRequests.delete(key);
            message.error(error instanceof Error ? error.message : "创建托管项目失败");
        }).finally(() => setBinding(false));
    }, [accessToken, bindAgentProject, bindingAttempt, bound, message, project, user]);

    const snapshot = useMemo(() => {
        if (!canvasContext || canvasContext.snapshot.projectId !== project?.id) return null;
        return sanitizeHostedSnapshot(canvasContext.snapshot);
    }, [canvasContext, project?.id]);

    useEffect(() => {
        if (!bound || !accessToken || !project?.agentProjectId) {
            setCanvasHydrated(false);
            return;
        }
        const canvasProjectId = project.id;
        const hostedProjectId = project.agentProjectId;
        let cancelled = false;
        setCanvasHydrated(false);
        void hostedAgentApi.readCanvas(accessToken, hostedProjectId).then((canvas) => {
            if (cancelled) return;
            const current = useCanvasStore.getState().projects.find((item) => item.id === canvasProjectId);
            const snapshotValue = canvas.snapshot;
            const nodes = Array.isArray(snapshotValue?.nodes) ? snapshotValue.nodes as CanvasNodeData[] : null;
            const localRevision = current?.agentRevision || 0;
            if (current && nodes && canvas.revision >= localRevision && (canvas.revision > localRevision || current.nodes.length === 0)) {
                useCanvasStore.setState((state) => ({
                    projects: state.projects.map((item) => item.id === canvasProjectId ? {
                        ...item,
                        nodes,
                        connections: Array.isArray(snapshotValue?.connections) ? snapshotValue.connections as CanvasConnection[] : [],
                        agentRevision: canvas.revision,
                        updatedAt: new Date().toISOString(),
                    } : item),
                }));
            }
        }).catch((error) => {
            if (!cancelled) message.error(error instanceof Error ? error.message : "读取托管画布失败");
        }).finally(() => {
            if (!cancelled) setCanvasHydrated(true);
        });
        return () => {
            cancelled = true;
        };
    }, [accessToken, bound, message, project?.agentProjectId, project?.id]);

    useEffect(() => {
        if (!canvasHydrated || !bound || !accessToken || !project?.agentProjectId || !snapshot) return;
        if (project.nodes.length > 0 && snapshot.nodes.length === 0) return;
        const revision = project.agentRevision || 0;
        if (publishedRevisions.get(project.agentProjectId) === revision) return;
        publishedRevisions.set(project.agentProjectId, revision);
        void hostedAgentApi.publishCanvas(accessToken, project.agentProjectId, hostedBrowserClientId(), revision, snapshot).catch((error) => {
            publishedRevisions.delete(project.agentProjectId!);
            message.error(error instanceof Error ? error.message : "同步画布失败");
        });
    }, [accessToken, bound, canvasHydrated, message, project?.agentProjectId, project?.agentRevision, project?.nodes.length, snapshot]);

    return {
        enabled: hostedAgentConfigured && bound,
        token: accessToken,
        project,
        canvasContext,
        binding,
        retryBinding: () => {
            if (user && project) bindingRequests.delete(`${user.id}:${project.id}`);
            setBindingAttempt((value) => value + 1);
        },
    };
}

export function hostedBrowserClientId() {
    const key = "research-canvas:agent-client-id";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const value = crypto.randomUUID();
    sessionStorage.setItem(key, value);
    return value;
}

export function sanitizeHostedSnapshot<T extends { nodes: Array<{ metadata?: { content?: string } }> }>(snapshot: T) {
    return {
        ...snapshot,
        nodes: snapshot.nodes.map((node) => ({
            ...node,
            metadata: node.metadata?.content?.startsWith("data:") ? { ...node.metadata, content: undefined, hasLocalContent: true } : node.metadata,
        })),
    };
}
