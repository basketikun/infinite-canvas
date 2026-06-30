import { describe, expect, test } from "bun:test";

import { attachmentPayloadBytes, validateAgentAttachments } from "./http-server.js";

function imageDataUrl(bytes: number) {
    return `data:image/png;base64,${Buffer.alloc(bytes).toString("base64")}`;
}

describe("agent attachment limits", () => {
    test("counts decoded data URL bytes", () => {
        expect(attachmentPayloadBytes({ dataUrl: imageDataUrl(3) })).toBe(3);
    });

    test("rejects a single attachment over the per-file limit", () => {
        expect(validateAgentAttachments([{ dataUrl: imageDataUrl(6) }], { maxAttachmentBytes: 5, maxAttachmentsBytes: 20 })).toEqual({
            ok: false,
            bytes: 6,
            error: "attachments too large",
        });
    });

    test("rejects attachments over the total payload limit", () => {
        expect(
            validateAgentAttachments(
                [
                    { dataUrl: imageDataUrl(4) },
                    { dataUrl: imageDataUrl(4) },
                    { dataUrl: imageDataUrl(5) },
                ],
                { maxAttachmentBytes: 10, maxAttachmentsBytes: 12 },
            ),
        ).toEqual({
            ok: false,
            bytes: 13,
            error: "attachments too large",
        });
    });
});
