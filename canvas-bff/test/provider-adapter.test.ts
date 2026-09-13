import assert from "node:assert/strict";
import test from "node:test";

import { ProviderSecretBox } from "../src/crypto/secret-box.js";
import { InMemoryProviderRepository } from "../src/providers/repository.js";
import { HttpGenerationProvider } from "../src/providers/http-generation-provider.js";

const secretBox = new ProviderSecretBox(Buffer.alloc(32, 7));

function fixture(baseUrl?: string) {
  const providers = new InMemoryProviderRepository();
  const provider = providers.create({
    accountId: "account-a",
    name: "Sub2API key",
    providerType: "openai-compatible",
    ...(baseUrl ? { baseUrl } : {}),
    model: "gpt-image-2",
    secret: secretBox.encrypt("sk-provider-secret"),
    secretDescription: secretBox.describe("sk-provider-secret"),
    status: "active",
  });
  return { providers, provider };
}

test("image adapter decrypts the provider secret and ingests base64 output", async () => {
  const { providers, provider } = fixture();
  let request: Request | undefined;
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const result = await adapter.start({
    id: "generation-1",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "a tree", model: "gpt-image-2" },
    inputHash: "hash",
    clientRequestId: "request-1",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded")
    assert.equal(Buffer.from(result.data).toString(), "image-bytes");
  assert.equal(
    request?.url,
    "https://sub2api.example.test/v1/images/generations",
  );
  assert.equal(
    request?.headers.get("authorization"),
    "Bearer sk-provider-secret",
  );
  assert.equal((await request?.json()).prompt, "a tree");
});

test("image adapter uses the provider-specific endpoint for third-party providers", async () => {
  const { providers, provider } = fixture("https://third-party.example.test");
  let requestUrl = "";
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("third-party-image").toString("base64") }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await adapter.start({
    id: "generation-third-party",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "a tree", model: "image-model" },
    inputHash: "hash-third-party",
    clientRequestId: "request-third-party",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(requestUrl, "https://third-party.example.test/v1/images/generations");
});

test("audio adapter returns binary provider output", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
  });
  const result = await adapter.start({
    id: "generation-2",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "audio",
    input: { prompt: "hello", model: "tts-1", voice: "alloy" },
    inputHash: "hash",
    clientRequestId: "request-2",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded")
    assert.deepEqual(Buffer.from(result.data), Buffer.from([1, 2, 3]));
});

test("adapter does not impose a default provider request timeout", async () => {
  const { providers, provider } = fixture();
  let signal: AbortSignal | undefined;
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input, init) => {
      signal = init?.signal;
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("image").toString("base64") }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const result = await adapter.start({
    id: "generation-no-timeout",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "long-running" },
    inputHash: "hash",
    clientRequestId: "request-no-timeout",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(signal, undefined);
});

test("video adapter maps asynchronous start and completed poll", async () => {
  const { providers, provider } = fixture();
  const calls: string[] = [];
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/videos"))
        return new Response(
          JSON.stringify({ id: "video-task-1", status: "queued" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      if (url.endsWith("/v1/videos/video-task-1"))
        return new Response(
          JSON.stringify({ id: "video-task-1", status: "completed" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    },
  });
  const generation = {
    id: "generation-3",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video" as const,
    input: { prompt: "a moving tree", model: "video-model" },
    inputHash: "hash",
    clientRequestId: "request-3",
    status: "running" as const,
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const started = await adapter.start(generation);
  assert.deepEqual(started, {
    status: "pending",
    providerTaskId: "video-task-1",
    progress: 0,
  });
  const completed = await adapter.poll({
    ...generation,
    providerTaskId: "video-task-1",
  });
  assert.equal(completed.status, "succeeded");
  if (completed.status === "succeeded")
    assert.deepEqual(Buffer.from(completed.data), Buffer.from([9, 8, 7]));
  assert.deepEqual(calls, [
    "https://sub2api.example.test/v1/videos",
    "https://sub2api.example.test/v1/videos/video-task-1",
    "https://sub2api.example.test/v1/videos/video-task-1/content",
  ]);
});

test("video adapter follows Sub2API request_id and done response", async () => {
  const { providers, provider } = fixture();
  const calls: string[] = [];
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/videos"))
        return new Response(JSON.stringify({ request_id: "grok-task-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.endsWith("/v1/videos/grok-task-1"))
        return new Response(
          JSON.stringify({
            status: "done",
            video: { url: "https://cdn.x.ai/video.mp4" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    },
  });
  const generation = {
    id: "generation-grok-video",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video" as const,
    input: { prompt: "a moving tree", model: "grok-imagine-video" },
    inputHash: "hash",
    clientRequestId: "request-grok-video",
    status: "running" as const,
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const started = await adapter.start(generation);
  assert.deepEqual(started, {
    status: "pending",
    providerTaskId: "grok-task-1",
    progress: 0,
  });
  const completed = await adapter.poll({
    ...generation,
    providerTaskId: "grok-task-1",
  });
  assert.equal(completed.status, "succeeded");
  if (completed.status === "succeeded")
    assert.deepEqual(Buffer.from(completed.data), Buffer.from([4, 5, 6]));
  assert.deepEqual(calls, [
    "https://sub2api.example.test/v1/videos",
    "https://sub2api.example.test/v1/videos/grok-task-1",
    "https://sub2api.example.test/v1/videos/grok-task-1/content",
  ]);
});

test("video adapter treats expired and unknown statuses as terminal failures", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async (input) => {
      const url = String(input);
      const status = url.endsWith("expired") ? "expired" : "mystery";
      return new Response(JSON.stringify({ status }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const generation = {
    id: "generation-status",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "video" as const,
    input: { prompt: "status" },
    inputHash: "hash",
    clientRequestId: "request-status",
    status: "provider_polling" as const,
    progress: 0,
    providerTaskId: "expired",
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  assert.deepEqual(await adapter.poll(generation), {
    status: "failed",
    retryable: false,
    errorCode: "PROVIDER_EXPIRED",
  });
  assert.deepEqual(
    await adapter.poll({ ...generation, providerTaskId: "unknown" }),
    {
      status: "failed",
      retryable: false,
      errorCode: "PROVIDER_STATUS_UNKNOWN",
    },
  );
});

test("adapter marks upstream rate limits retryable without exposing secrets", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () => new Response("", { status: 429 }),
  });
  const result = await adapter.start({
    id: "generation-4",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "retry" },
    inputHash: "hash",
    clientRequestId: "request-4",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(result, {
    status: "failed",
    retryable: true,
    errorCode: "UPSTREAM_HTTP_429",
  });
});

test("adapter rejects media URLs outside the configured Sub2API origin", async () => {
  const { providers, provider } = fixture();
  const adapter = new HttpGenerationProvider({
    baseUrl: "https://sub2api.example.test",
    providers,
    secretBox,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: [{ url: "https://attacker.example.test/image.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  const result = await adapter.start({
    id: "generation-5",
    accountId: "account-a",
    projectId: "project-1",
    providerId: provider.id,
    kind: "image",
    input: { prompt: "blocked" },
    inputHash: "hash",
    clientRequestId: "request-5",
    status: "running",
    progress: 0,
    attempt: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(result, {
    status: "failed",
    retryable: false,
    errorCode: "PROVIDER_OUTPUT_URL_NOT_ALLOWED",
  });
});
