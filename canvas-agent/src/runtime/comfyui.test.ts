import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkflow } from "./comfyui.js";

const upload = async (file: string) => `uploaded-${file}`;

test("MiniMax H3 selects the workflow node for each task mode", async () => {
    const cases = [
        ["t2v", "MiniMaxH3ImageToVideo", { references: [] }],
        ["i2v", "MiniMaxH3ImageToVideo", { references: ["first.png"] }],
        ["fl2v", "MiniMaxH3ImageToVideo", { references: ["first.png", "last.png"] }],
        ["r2v", "JZL_MiniMaxH3ReferenceToVideo2", { references: ["character.png"] }],
        ["rv2v", "MiniMaxH3AudioConditioningT8", { video: "source.mp4", references: ["character.png"], audios: [] }],
    ] as const;

    for (const [taskMode, classType, input] of cases) {
        const workflow = await buildWorkflow("minimax-h3", input, { taskMode }, upload) as Record<string, any>;
        assert.equal(workflow["136"].class_type, classType, taskMode);
    }
});

test("MiniMax H3 rejects incompatible task inputs", async () => {
    await assert.rejects(() => buildWorkflow("minimax-h3", { references: ["one.png"] }, { taskMode: "t2v" }, upload), /t2v/);
    await assert.rejects(() => buildWorkflow("minimax-h3", { references: [] }, { taskMode: "i2v" }, upload), /i2v/);
    await assert.rejects(() => buildWorkflow("minimax-h3", { references: ["one.png"] }, { taskMode: "fl2v" }, upload), /fl2v/);
    await assert.rejects(() => buildWorkflow("minimax-h3", { references: ["one.png"] }, { taskMode: "rv2v" }, upload), /rv2v/);
});

test("MiniMax H3 normalizes legacy model names to ComfyUI model paths", async () => {
    const workflow = await buildWorkflow("minimax-h3", { references: ["character.png"] }, {
        taskMode: "r2v",
        modelName: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    }, upload) as Record<string, any>;
    assert.equal(workflow["127"].inputs.unet_name, "h3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors");
});

test("MiniMax H3 repairs truncated Turbo model suffixes", async () => {
    const workflow = await buildWorkflow("minimax-h3", { references: ["character.png"] }, {
        taskMode: "r2v",
        modelName: "-hybrid_beta4_int8_convrot_2.safetensors",
    }, upload) as Record<string, any>;
    assert.equal(workflow["127"].inputs.unet_name, "h3\\10Eros_minimax_h3_TURBO-hybrid_beta4_int8_convrot_2.safetensors");
});
