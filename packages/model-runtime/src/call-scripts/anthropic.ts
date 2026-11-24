import type { CallScript } from "@infinite-canvas/shared/models";
import { createCallScriptSource } from "./template.js";

export const anthropicScripts: CallScript[] = [
    {
        id: "anthropic-text",
        name: "Messages 协议文本",
        description: "POST /v1/messages\n输出上限 16384 tokens。",
        logo: "/icons/claude.svg",
        capability: "text",
        source: createCallScriptSource("text", String.raw`if (params.tools) {
    return params.utils.runTextAgent("anthropic", {
        maxOutputTokens: 16384,
        providerOptions: params.reasoningEffort === "auto" ? undefined : {
            anthropic: { thinking: { type: "adaptive" }, effort: params.reasoningEffort },
        },
    });
}

const { model, messages, apiKey, utils } = params;
const system = messages
    .filter((message) => message.role === "system")
    .flatMap((message) =>
        typeof message.content === "string"
            ? [
                  {
                      type: "text",
                      text: message.content,
                  },
              ]
            : message.content,
    );
const input = await Promise.all(
    messages
        .filter((message) => message.role !== "system")
        .map(async ({ role, content }) => ({
            role,
            content:
                typeof content === "string"
                    ? content
                    : await Promise.all(
                          content.map(async (part) => {
                              if (part.type === "text") {
                                  return part;
                              }
                              const url = part.image_url.url;
                              if (url.startsWith("https:") || url.startsWith("http:")) {
                                  return {
                                      type: "image",
                                      source: {
                                          type: "url",
                                          url,
                                      },
                                  };
                              }
                              const dataUrl = await utils.toDataUrl(url);
                              const [metadata, data] = dataUrl.split(",");
                              return {
                                  type: "image",
                                  source: {
                                      type: "base64",
                                      media_type: metadata.slice(5, metadata.indexOf(";")),
                                      data,
                                  },
                              };
                          }),
                      ),
        })),
);
let text = "";
let completed = false;
await utils.stream(
    {
        url: utils.http.url("/messages"),
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        data: {
            model,
            messages: input,
            ...(system.length ? { system } : {}),
            max_tokens: 16384,
            stream: true,
        },
    },
    (event) => {
        if (event.type === "error" || event.error) {
            throw new Error("text request failed");
        }
        const stopReason =
            event.type === "message_delta" ? event.delta.stop_reason : event.stop_reason;
        if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") {
            throw new Error("SCRIPT_TEXT_INCOMPLETE");
        }
        if (stopReason && stopReason !== "end_turn" && stopReason !== "stop_sequence") {
            throw new Error("text request failed");
        }
        if (event.type === "content_block_start" && event.content_block.type === "text") {
            text += event.content_block.text;
        }
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            text += event.delta.text;
        }
        if (event.type === "message") {
            text = event.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("");
        }
        if (event.type === "message_stop" || (event.type === "message" && stopReason)) {
            completed = true;
        }
        if (text) {
            utils.onDelta(text);
        }
    },
);
if (!completed) {
    throw new Error("SCRIPT_TEXT_INCOMPLETE");
}
return text;`),
    },
];
