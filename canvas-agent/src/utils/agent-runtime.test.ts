import assert from "node:assert/strict";
import test from "node:test";

import { redactAgentLog } from "./agent-runtime.js";

test("redactAgentLog masks bearer tokens", () => {
    assert.equal(redactAgentLog("Error: Bearer abc.def-ghi123=="), "Error: Bearer [REDACTED]");
    assert.equal(redactAgentLog("bearer 0123456789abcdef"), "bearer [REDACTED]");
});

test("redactAgentLog masks sk- keys", () => {
    assert.equal(redactAgentLog("key=sk-abcdefgh1234"), "key=[REDACTED]");
    assert.equal(redactAgentLog("sk-proj-abcdefghijklmnopqrstuvwxyz"), "[REDACTED]");
});

test("redactAgentLog masks explicit api-key/token/authorization assignments", () => {
    assert.equal(redactAgentLog('api_key: "secretvalue123"'), "api_key: [REDACTED]");
    assert.equal(redactAgentLog("token=my-token-abc"), "token=[REDACTED]");
    assert.equal(redactAgentLog("API-KEY: foobar"), "API-KEY: [REDACTED]");
});

test("redactAgentLog keeps text without credentials intact", () => {
    assert.equal(redactAgentLog("Codex app-server exited: 0"), "Codex app-server exited: 0");
    assert.equal(redactAgentLog("model: gpt-5"), "model: gpt-5");
});
