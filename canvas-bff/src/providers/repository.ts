import { randomUUID } from "node:crypto";

import type { EncryptedSecret, MaskedSecret } from "../crypto/secret-box.js";

export type ProviderRecord = {
    id: string;
    accountId: string;
    name: string;
    providerType: string;
    baseUrl?: string;
    model?: string;
    group?: string;
    channel?: string;
    sub2ApiKeyId?: string;
    secret: EncryptedSecret;
    secretDescription: MaskedSecret;
    status: "active" | "disabled";
    createdAt: Date;
    updatedAt: Date;
};

export interface ProviderRepository {
    list(accountId: string): ProviderRecord[] | Promise<ProviderRecord[]>;
    get(accountId: string, id: string): ProviderRecord | undefined | Promise<ProviderRecord | undefined>;
    create(input: Omit<ProviderRecord, "id" | "createdAt" | "updatedAt">): ProviderRecord | Promise<ProviderRecord>;
    update(accountId: string, id: string, patch: Partial<Pick<ProviderRecord, "name" | "model" | "group" | "channel" | "status">>): ProviderRecord | undefined | Promise<ProviderRecord | undefined>;
    delete(accountId: string, id: string): boolean | Promise<boolean>;
}

export class InMemoryProviderRepository implements ProviderRepository {
    private readonly records = new Map<string, ProviderRecord>();

    list(accountId: string): ProviderRecord[] {
        return [...this.records.values()].filter((record) => record.accountId === accountId).map(cloneProvider);
    }

    get(accountId: string, id: string): ProviderRecord | undefined {
        const record = this.records.get(id);
        return record?.accountId === accountId ? cloneProvider(record) : undefined;
    }

    create(input: Omit<ProviderRecord, "id" | "createdAt" | "updatedAt">): ProviderRecord {
        const now = new Date();
        const record: ProviderRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
        this.records.set(record.id, record);
        return cloneProvider(record);
    }

    update(accountId: string, id: string, patch: Partial<Pick<ProviderRecord, "name" | "model" | "group" | "channel" | "status">>): ProviderRecord | undefined {
        const record = this.records.get(id);
        if (!record || record.accountId !== accountId) return undefined;
        Object.assign(record, patch, { updatedAt: new Date() });
        return cloneProvider(record);
    }

    delete(accountId: string, id: string): boolean {
        const record = this.records.get(id);
        return Boolean(record?.accountId === accountId && this.records.delete(id));
    }
}

function cloneProvider(record: ProviderRecord): ProviderRecord {
    return {
        ...record,
        secret: { ...record.secret },
        secretDescription: { ...record.secretDescription },
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}
