export const defaultPrompt = "保持原视频的动作、镜头和环境，替换主体角色，动作连贯，人物外观稳定。";
export const defaultH3Model = "h3\\10Eros_minimax_h3_TURBO-hybrid_beta4_int8_convrot_2.safetensors";

export const h3ModelOptions = [
    { value: "h3\\10Eros_minimax_h3_TURBO-hybrid_beta4_int8_convrot_2.safetensors", label: "10Eros H3 Turbo Hybrid Beta4 INT8" },
    { value: "h3\\10Eros_minimax_h3_TURBO-hybrid_beta3_int8_convrot.safetensors", label: "10Eros H3 Turbo Hybrid Beta3 INT8" },
    { value: "h3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors", label: "Ref2VA Pruned INT8 ConvRot" },
    { value: "h3\\minimax_h3_ref2va_int8_convrot.safetensors", label: "Ref2VA INT8 ConvRot" },
    { value: "h3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors", label: "FL2VA Pruned INT8 ConvRot" },
    { value: "h3\\minimax_h3_fl2va_int8_convrot.safetensors", label: "FL2VA INT8 ConvRot" },
    { value: "h3\\minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors", label: "Hybrid FL2VA / Ref2VA B25-49 INT8" },
    { value: "h3\\DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors", label: "Dasiwa REF2VA Hybrid V1" },
];

export const h3LoraOptions = [
    { value: "", label: "关闭 LoRA" },
    { value: "Minimax\\minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors", label: "Ref2VA Turbo 8-step" },
    { value: "Minimax\\minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors", label: "Ref2VA Turbo 4-step（lightx2v）" },
    { value: "Minimax\\minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors", label: "Ref2VA Turbo 4-step" },
    { value: "Minimax\\minimax_h3_fl2v_turbo_4step_v0.1_768p_sla_comfyui_bf16.safetensors", label: "FL2V Turbo 4-step（768p SLA）" },
    { value: "Minimax\\minimax_h3_turbo_4步加速_comfyui（最老版本-推荐）.safetensors", label: "MiniMax Turbo 4步（最老版本·推荐）" },
    { value: "Minimax\\minimax_h3_turbo_4step_ema_ckpt850_pruned_comfyui.safetensors", label: "MiniMax Turbo 4step EMA ckpt850" },
    { value: "Minimax\\minimax_h3_turbo_4步加速_DasiwaREF2VAHybridV1_curveproj1025_compat_v001-T8.safetensors", label: "Dasiwa Turbo 4步加速" },
];

export const characterSwapLora = h3LoraOptions[1].value;
