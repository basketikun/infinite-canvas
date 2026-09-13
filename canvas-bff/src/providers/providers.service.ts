import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { PROVIDER_REPOSITORY, PROVIDER_SECRET_BOX, SESSION_SERVICE, SUB2API_CATALOG } from "../app.tokens.js";
import { HttpError } from "../http/errors.js";
import { ProviderSecretBox } from "../crypto/secret-box.js";
import { SessionService } from "../auth/session-service.js";
import { Sub2ApiCatalogAdapter } from "./sub2api-catalog.js";
import type { ProviderRecord, ProviderRepository } from "./repository.js";

export const providerBody = z.object({ name: z.string().trim().min(1).max(120), providerType: z.string().trim().min(1).max(80).default("openai-compatible"), baseUrl: z.string().trim().url().optional(), model: z.string().trim().max(200).optional(), group: z.string().trim().max(200).optional(), channel: z.string().trim().max(200).optional(), catalogKeyId: z.string().trim().min(1).max(200).optional(), secret: z.string().min(1).max(4_096).optional() }).superRefine((value, context) => { if (!value.catalogKeyId && !value.secret) context.addIssue({ code: z.ZodIssueCode.custom, message: "catalogKeyId or secret is required" }); });
export const providerPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), model: z.string().trim().max(200).optional(), group: z.string().trim().max(200).optional(), channel: z.string().trim().max(200).optional(), status: z.enum(["active", "disabled"]).optional() });

@Injectable()
export class ProvidersService {
    constructor(
        @Inject(PROVIDER_REPOSITORY) private readonly providers: ProviderRepository,
        @Inject(PROVIDER_SECRET_BOX) private readonly secretBox: ProviderSecretBox,
        @Inject(SUB2API_CATALOG) private readonly catalog: Sub2ApiCatalogAdapter,
        @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    ) {}

    async catalogForSession(sessionToken: string | undefined) {
        return this.catalog.listCatalog(await this.upstreamToken(sessionToken));
    }

    async models(accountId: string, id: string) {
        const record = await this.providers.get(accountId, id);
        if (!record || record.status !== "active") throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found");
        try {
            return this.catalog.listModels(this.secretBox.decrypt(record.secret), record.baseUrl);
        } catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(502, "PROVIDER_SECRET_INVALID", "Provider secret could not be decrypted");
        }
    }

    async list(accountId: string) { return (await this.providers.list(accountId)).map(toPublic); }
    async get(accountId: string, id: string) { const record = await this.providers.get(accountId, id); if (!record) throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found"); return toPublic(record); }

    async create(accountId: string, sessionToken: string | undefined, input: z.output<typeof providerBody>) {
        let secret = input.secret;
        let catalogItem: { id: string; providerType?: string; model?: string; group?: string; channel?: string } | undefined;
        if (input.catalogKeyId) { const resolved = await this.catalog.getApiKeySecret(await this.upstreamToken(sessionToken), input.catalogKeyId); secret = resolved.secret; catalogItem = resolved.item; }
        if (!secret) throw new HttpError(400, "PROVIDER_SECRET_REQUIRED", "Provider secret is required");
        const existing = input.catalogKeyId && (await this.providers.list(accountId)).find((item) => item.sub2ApiKeyId === input.catalogKeyId);
        if (existing) return toPublic(existing);
        const record = await this.providers.create({ accountId, name: input.name, providerType: catalogItem?.providerType ?? input.providerType, ...(!input.catalogKeyId && input.baseUrl ? { baseUrl: normalizeBaseUrl(input.baseUrl) } : {}), ...(input.model ?? catalogItem?.model ? { model: input.model ?? catalogItem?.model } : {}), ...(input.group ?? catalogItem?.group ? { group: input.group ?? catalogItem?.group } : {}), ...(input.channel ?? catalogItem?.channel ? { channel: input.channel ?? catalogItem?.channel } : {}), ...(input.catalogKeyId ? { sub2ApiKeyId: input.catalogKeyId } : {}), secret: this.secretBox.encrypt(secret), secretDescription: this.secretBox.describe(secret), status: "active" });
        return toPublic(record);
    }

    async update(accountId: string, id: string, input: z.output<typeof providerPatch>) { const record = await this.providers.update(accountId, id, input); if (!record) throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found"); return toPublic(record); }
    async remove(accountId: string, id: string) { if (!(await this.providers.delete(accountId, id))) throw new HttpError(404, "PROVIDER_NOT_FOUND", "Provider was not found"); }

    private async upstreamToken(sessionToken: string | undefined): Promise<string> {
        const token = sessionToken ? await this.sessions.getUpstreamAccessToken(sessionToken) : null;
        if (!token) throw new HttpError(401, "SUB2API_TOKEN_REQUIRED", "Sub2API catalog session is unavailable");
        return token;
    }
}

function toPublic(record: ProviderRecord) { return { id: record.id, name: record.name, providerType: record.providerType, ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}), ...(record.model ? { model: record.model } : {}), ...(record.group ? { group: record.group } : {}), ...(record.channel ? { channel: record.channel } : {}), ...(record.sub2ApiKeyId ? { sub2ApiKeyId: record.sub2ApiKeyId } : {}), status: record.status, fingerprint: record.secretDescription.fingerprint, maskedKey: record.secretDescription.masked, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() }; }

function normalizeBaseUrl(value: string) {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
}
