import axios from "axios";

import i18n from "@/i18n";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

/**
 * Dig the human-readable reason out of whatever shape a provider used for its error body.
 * Providers disagree on the envelope (`error`, `error.message`, `msg`, `detail`, a JSON string,
 * sometimes an HTML page), and the reason a request was refused - a content filter, a bad
 * parameter, an exhausted quota - is the one thing the user actually needs, so it is worth
 * trying every shape rather than falling back to "request failed".
 */
export function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        // The value may be serialized JSON, such as error.message, or a plain-text error.
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            // Treat an empty parsed object such as "{}" as having no useful message.
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            // Detect HTML error pages.
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg = typeof payload.error === "string" ? payload.error : (payload.error as { message?: unknown })?.message;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(errorMsg) || readApiErrorMessage(payload.detail) || "";
}

/**
 * Turn a failed request into a message worth showing. Axios reports only "Request failed with
 * status code 400", which hides the sentence the provider actually wrote - a moderation refusal
 * or an unsupported parameter reads identically. Prefer the response body, and name the status
 * alongside it so a bare refusal is still attributable.
 */
export function readRequestError(error: unknown, fallback = ""): string {
    if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : fallback;
    const status = error.response?.status;
    const provider = readApiErrorMessage(error.response?.data);
    if (provider && status) return apiText("providerRefused", { status, message: provider });
    if (provider) return provider;
    if (status) return apiText("httpFailed", { status });
    return error.message || fallback;
}
