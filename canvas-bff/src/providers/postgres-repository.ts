import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import type { ProviderRecord, ProviderRepository } from "./repository.js";

export class PostgresProviderRepository implements ProviderRepository {
    constructor(private readonly pool: Pool) {}

    async list(accountId: string): Promise<ProviderRecord[]> {
        const result = await this.pool.query(`${baseQuery} WHERE account_id = $1 ORDER BY updated_at DESC`, [accountId]);
        return result.rows.map(toProvider);
    }

    async get(accountId: string, id: string): Promise<ProviderRecord | undefined> {
        const result = await this.pool.query(`${baseQuery} WHERE account_id = $1 AND id = $2`, [accountId, id]);
        return result.rows[0] ? toProvider(result.rows[0]) : undefined;
    }

    async create(input: Omit<ProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<ProviderRecord> {
        const inserted = await this.pool.query(
            `INSERT INTO canvas_providers (id, account_id, name, provider_type, base_url, model, group_name, channel, sub2api_key_id, secret_ciphertext, secret_iv, secret_auth_tag, secret_key_version, secret_fingerprint, secret_masked, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${columns}`,
            [randomUUID(), input.accountId, input.name, input.providerType, input.baseUrl ?? null, input.model ?? null, input.group ?? null, input.channel ?? null, input.sub2ApiKeyId ?? null, input.secret.ciphertext, input.secret.iv, input.secret.authTag, input.secret.keyVersion, input.secretDescription.fingerprint, input.secretDescription.masked, input.status],
        );
        return toProvider(inserted.rows[0]);
    }

    async update(accountId: string, id: string, patch: Partial<Pick<ProviderRecord, "name" | "model" | "group" | "channel" | "status">>): Promise<ProviderRecord | undefined> {
        const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
        if (!entries.length) return this.get(accountId, id);
        const values: unknown[] = [accountId, id];
        const fields = entries.map(([key, value]) => {
            values.push(value);
            return `${key === "group" ? "group_name" : key} = $${values.length}`;
        });
        const result = await this.pool.query(`UPDATE canvas_providers SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE account_id = $1 AND id = $2 RETURNING ${columns}`, values);
        return result.rows[0] ? toProvider(result.rows[0]) : undefined;
    }

    async delete(accountId: string, id: string): Promise<boolean> {
        const result = await this.pool.query("DELETE FROM canvas_providers WHERE account_id = $1 AND id = $2", [accountId, id]);
        return result.rowCount === 1;
    }
}

const columns = "id, account_id, name, provider_type, base_url, model, group_name, channel, sub2api_key_id, secret_ciphertext, secret_iv, secret_auth_tag, secret_key_version, secret_fingerprint, secret_masked, status, created_at, updated_at";
const baseQuery = `SELECT ${columns} FROM canvas_providers`;

function toProvider(row: Record<string, unknown>): ProviderRecord {
    return {
        id: String(row.id),
        accountId: String(row.account_id),
        name: String(row.name),
        providerType: String(row.provider_type),
        ...(row.base_url ? { baseUrl: String(row.base_url) } : {}),
        ...(row.model ? { model: String(row.model) } : {}),
        ...(row.group_name ? { group: String(row.group_name) } : {}),
        ...(row.channel ? { channel: String(row.channel) } : {}),
        ...(row.sub2api_key_id ? { sub2ApiKeyId: String(row.sub2api_key_id) } : {}),
        secret: { ciphertext: String(row.secret_ciphertext), iv: String(row.secret_iv), authTag: String(row.secret_auth_tag), keyVersion: String(row.secret_key_version) },
        secretDescription: { fingerprint: String(row.secret_fingerprint), masked: String(row.secret_masked ?? "****") },
        status: row.status as ProviderRecord["status"],
        createdAt: new Date(String(row.created_at)),
        updatedAt: new Date(String(row.updated_at)),
    };
}
