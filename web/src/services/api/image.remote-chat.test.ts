import { expect, test } from "bun:test";

import { requestRemoteChatCompletion, type AiTextMessage } from "./image";
import { defaultConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

test("服务端模式通过控制平面的 chat completions 流式生成文本", async () => {
    const previousToken = useUserStore.getState().token;
    useUserStore.setState({ token: "session-token" });
    const messages: AiTextMessage[] = [{ role: "user", content: "你好" }];
    const deltas: string[] = [];

    try {
        const result = await requestRemoteChatCompletion(
            { ...defaultConfig, channelMode: "remote", model: "gpt-5.5" },
            messages,
            (text) => deltas.push(text),
            undefined,
            async (input, init) => {
                expect(input).toBe("/api/v1/chat/completions");
                expect(init?.method).toBe("POST");
                expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-token");
                expect(JSON.parse(String(init?.body))).toEqual({ model: "gpt-5.5", messages, stream: true });
                return new Response('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
            },
        );

        expect(result).toBe("你好");
        expect(deltas).toEqual(["你", "你好"]);
    } finally {
        useUserStore.setState({ token: previousToken });
    }
});
