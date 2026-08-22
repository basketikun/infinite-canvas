/** Redact bearer tokens, sk- keys, and explicit credential assignments before a string is logged or sent to the browser. */
export function redactAgentLog(text: string): string {
    return text
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
        .replace(/((?:api[_-]?key|token|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]");
}
