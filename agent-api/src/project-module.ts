import { AppError } from "./errors.js";
import type { ResearchStore } from "./store.js";
import type { Conversation, Project, RequestContext } from "./types.js";

export class ProjectModule {
    constructor(private readonly store: ResearchStore) {}

    async create(userId: string, input: { name?: unknown }): Promise<Project> {
        const name = requiredText(input.name, "项目名称不能为空");
        return await this.store.createProject(userId, name);
    }

    listMine(userId: string) {
        return this.store.listProjects(userId);
    }

    readOwned(userId: string, projectId: string) {
        return this.store.readProject(userId, projectId);
    }

    async context(userId: string, projectId: string): Promise<RequestContext> {
        const project = await this.readOwned(userId, projectId);
        return { userId, projectId: project.id, canvasWorkspaceId: project.canvasWorkspaceId };
    }

    deleteOwned(userId: string, projectId: string) {
        return this.store.deleteProject(userId, projectId);
    }
}

export class ConversationModule {
    constructor(private readonly store: ResearchStore) {}

    create(ctx: RequestContext, input: { title?: unknown }): Promise<Conversation> {
        const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "新对话";
        return this.store.createConversation(ctx, title);
    }

    list(ctx: RequestContext) {
        return this.store.listConversations(ctx);
    }

    read(ctx: RequestContext, conversationId: string) {
        return this.store.readConversation(ctx, conversationId);
    }

    archive(ctx: RequestContext, conversationId: string) {
        return this.store.archiveConversation(ctx, conversationId);
    }
}

export function requiredText(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) throw new AppError(message, 400, "invalid_input");
    return value.trim();
}
