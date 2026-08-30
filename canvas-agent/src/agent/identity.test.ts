import assert from "node:assert/strict";
import test from "node:test";

import { agentIdentityHeaders, parseAgentIdentity, readAgentIdentity } from "./identity.js";

test("parses an explicit MCP agent identity", () => {
    const identity = parseAgentIdentity(["--agent", "zcode", "--name", "ZCode", "--instance", "zcode-1"]);
    assert.deepEqual(identity, { kind: "zcode", name: "ZCode", instanceId: "zcode-1" });
    assert.equal(agentIdentityHeaders(identity)["x-canvas-agent-kind"], "zcode");
});

test("creates a runtime instance id when it is omitted", () => {
    const identity = parseAgentIdentity(["--agent", "trae", "--name", "TraeCode"]);
    assert.match(identity.instanceId, /^[a-f0-9-]{36}$/);
});

test("keeps the legacy MCP command usable with a default Codex identity", () => {
    const identity = parseAgentIdentity([]);
    assert.equal(identity.kind, "codex");
    assert.equal(identity.name, "Codex");
    assert.match(identity.instanceId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(readAgentIdentity({ header: () => undefined }), { kind: "codex", name: "Legacy MCP", instanceId: "legacy-mcp" });
});

test("rejects unsupported or incomplete identities", () => {
    assert.throws(() => parseAgentIdentity(["--agent", "other", "--name", "Other"]), /--agent/);
    assert.throws(() => parseAgentIdentity(["--agent", "codex"]), /--name/);
});
