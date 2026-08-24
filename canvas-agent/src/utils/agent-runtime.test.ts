import assert from "node:assert/strict";
import test from "node:test";

import { createAgentLogWriter, redactAgentLog } from "./agent-runtime.js";

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
    assert.equal(redactAgentLog("API key: foobar"), "API key: [REDACTED]");
    assert.equal(redactAgentLog("Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l"), "Authorization: [REDACTED]");
    assert.equal(redactAgentLog("authorization=Basic abc123; retrying"), "authorization=[REDACTED]; retrying");
});

test("createAgentLogWriter redacts ANSI-colored credentials split across chunks", () => {
    const messages: string[] = [];
    const writer = createAgentLogWriter((text) => messages.push(text));
    writer.write("\u001b[31mAuthorization: Basic abc");
    assert.deepEqual(messages, []);
    writer.write("123\u001b[0m\nAPI key: sec");
    writer.write("ret");
    writer.flush();
    assert.deepEqual(messages, ["Authorization: [REDACTED]\n", "API key: [REDACTED]"]);
});

test("redactAgentLog keeps text without credentials intact", () => {
    assert.equal(redactAgentLog("Codex app-server exited: 0"), "Codex app-server exited: 0");
    assert.equal(redactAgentLog("model: gpt-5"), "model: gpt-5");
});
