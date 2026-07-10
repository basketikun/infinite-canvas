import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cookies } from "next/headers";

const DEFAULT_PUBLIC_ORIGIN = "https://canvas.mewinyou.shop";
const DEFAULT_TOKEN_ORIGIN = "https://token.mewinyou.shop";
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;

export type CanvasCapability = "image" | "video" | "text" | "audio";

export type CanvasAccessTokens = Record<CanvasCapability, string>;

export type CanvasSession = {
    issuer: string;
    subject: string;
    username: string;
    accessTokens: CanvasAccessTokens;
    expiresAt: number;
};

type OAuthCookiePayload = {
    state: string;
    verifier: string;
    returnTo: string;
    expiresAt: number;
};

type SessionRow = {
    issuer: string;
    subject: string;
    username: string;
    token_ciphertext: string;
    expires_at: number;
};

let database: DatabaseSync | undefined;

export function getCanvasPublicOrigin() {
    return normalizeOrigin(process.env.CANVAS_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN);
}

export function getCanvasTokenOrigin() {
    return normalizeOrigin(process.env.TOKEN_API_BASE_URL || process.env.TOKEN_ISSUER_URL || DEFAULT_TOKEN_ORIGIN);
}

export function getCanvasOAuthClientId() {
    return process.env.CANVAS_OAUTH_CLIENT_ID?.trim() || "canvas";
}

export function getCanvasOAuthClientSecret() {
    const secret = process.env.CANVAS_OAUTH_CLIENT_SECRET?.trim();
    if (!secret) throw new Error("CANVAS_OAUTH_CLIENT_SECRET is required");
    return secret;
}

export function getCanvasOAuthRedirectUri() {
    return process.env.CANVAS_OAUTH_REDIRECT_URI?.trim() || `${getCanvasPublicOrigin()}/auth/callback`;
}

export function getCanvasSessionCookieName() {
    return getCanvasPublicOrigin().startsWith("https://") ? "__Host-canvas_session" : "canvas_session";
}

export function getCanvasOAuthCookieName() {
    return getCanvasPublicOrigin().startsWith("https://") ? "__Host-canvas_oauth" : "canvas_oauth";
}

export function canvasCookieOptions(maxAge: number) {
    return {
        httpOnly: true,
        secure: getCanvasPublicOrigin().startsWith("https://"),
        sameSite: "lax" as const,
        path: "/",
        maxAge,
    };
}

export function normalizeReturnTo(value: string | null | undefined) {
    if (!value) return "/";
    const candidate = value.trim();
    if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/";
    try {
        const url = new URL(candidate, getCanvasPublicOrigin());
        if (url.origin !== getCanvasPublicOrigin()) return "/";
        if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/auth/")) return "/";
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return "/";
    }
}

export function createOAuthRequest(returnTo: string) {
    const verifier = randomBytes(64).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const expiresAt = nowSeconds() + OAUTH_COOKIE_TTL_SECONDS;
    const payload: OAuthCookiePayload = { state, verifier, returnTo: normalizeReturnTo(returnTo), expiresAt };
    return { state, challenge, cookieValue: encrypt(JSON.stringify(payload)), maxAge: OAUTH_COOKIE_TTL_SECONDS };
}

export function readOAuthCookie(value: string | undefined) {
    if (!value) return null;
    try {
        const payload = JSON.parse(decrypt(value)) as OAuthCookiePayload;
        if (!payload.state || !payload.verifier || payload.expiresAt < nowSeconds()) return null;
        return { ...payload, returnTo: normalizeReturnTo(payload.returnTo) };
    } catch {
        return null;
    }
}

export async function getCanvasSession(): Promise<CanvasSession | null> {
    const cookieStore = await cookies();
    return getCanvasSessionById(cookieStore.get(getCanvasSessionCookieName())?.value);
}

export function getCanvasSessionById(sessionId: string | undefined): CanvasSession | null {
    if (!sessionId) return null;
    const db = getDatabase();
    const sessionHash = hashSessionId(sessionId);
    const row = db.prepare("SELECT issuer, subject, username, token_ciphertext, expires_at FROM canvas_sessions WHERE session_hash = ?").get(sessionHash) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_at < nowSeconds()) {
        db.prepare("DELETE FROM canvas_sessions WHERE session_hash = ?").run(sessionHash);
        return null;
    }
    try {
        return {
            issuer: row.issuer,
            subject: row.subject,
            username: row.username,
            accessTokens: parseAccessTokens(decrypt(row.token_ciphertext)),
            expiresAt: row.expires_at,
        };
    } catch {
        db.prepare("DELETE FROM canvas_sessions WHERE session_hash = ?").run(sessionHash);
        return null;
    }
}

export function createCanvasSession(input: { issuer: string; subject: string; username: string; accessTokens: CanvasAccessTokens }) {
    const db = getDatabase();
    const sessionId = randomBytes(32).toString("base64url");
    const createdAt = nowSeconds();
    const ttl = sessionTtlSeconds();
    const expiresAt = createdAt + ttl;
    db.prepare(
        `INSERT INTO canvas_sessions (session_hash, issuer, subject, username, token_ciphertext, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_hash) DO UPDATE SET issuer = excluded.issuer, subject = excluded.subject, username = excluded.username,
             token_ciphertext = excluded.token_ciphertext, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    ).run(hashSessionId(sessionId), input.issuer, input.subject, input.username, encrypt(JSON.stringify(input.accessTokens)), createdAt, expiresAt);
    db.prepare("DELETE FROM canvas_sessions WHERE expires_at < ?").run(createdAt);
    return { sessionId, expiresAt, maxAge: ttl };
}

function parseAccessTokens(value: string): CanvasAccessTokens {
    const parsed = JSON.parse(value) as Partial<CanvasAccessTokens>;
    for (const capability of ["image", "video", "text", "audio"] as const) {
        if (!parsed[capability]?.startsWith("sk-")) throw new Error("missing " + capability + " token");
    }
    return parsed as CanvasAccessTokens;
}

export function deleteCanvasSession(sessionId: string | undefined) {
    if (!sessionId) return;
    getDatabase().prepare("DELETE FROM canvas_sessions WHERE session_hash = ?").run(hashSessionId(sessionId));
}

function getDatabase() {
    if (database) return database;
    const dataDir = process.env.CANVAS_DATA_DIR?.trim() || (process.env.NODE_ENV === "production" ? "/app/data" : join(process.cwd(), ".data"));
    mkdirSync(dataDir, { recursive: true });
    database = new DatabaseSync(join(dataDir, "canvas.db"));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    database.exec(`
        CREATE TABLE IF NOT EXISTS canvas_sessions (
            session_hash TEXT PRIMARY KEY,
            issuer TEXT NOT NULL,
            subject TEXT NOT NULL,
            username TEXT NOT NULL,
            token_ciphertext TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_canvas_sessions_expires_at ON canvas_sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_canvas_sessions_subject ON canvas_sessions(issuer, subject);
    `);
    return database;
}

function encryptionKey() {
    const raw = process.env.CANVAS_ENCRYPTION_KEY?.trim();
    if (!raw) throw new Error("CANVAS_ENCRYPTION_KEY is required");
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("CANVAS_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters");
    return key;
}

function encrypt(plainText: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decrypt(value: string) {
    const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
    if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("invalid encrypted value");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}

function hashSessionId(sessionId: string) {
    return createHash("sha256").update(sessionId).digest("hex");
}

function sessionTtlSeconds() {
    const value = Number(process.env.CANVAS_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
    return Number.isFinite(value) && value >= 300 ? Math.floor(value) : DEFAULT_SESSION_TTL_SECONDS;
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function normalizeOrigin(value: string) {
    return new URL(value).origin;
}
