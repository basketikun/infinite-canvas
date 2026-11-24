import { openaiScripts } from "./openai.js";
import { anthropicScripts } from "./anthropic.js";
import { geminiScripts } from "./gemini.js";
import { agnesScripts } from "./agnes.js";
import { seedanceScripts } from "./seedance.js";
import { wanScripts } from "./wan.js";
import { klingScripts } from "./kling.js";
import { viduScripts } from "./vidu.js";
import { hailuoScripts } from "./hailuo.js";
import { xaiScripts } from "./xai.js";
import { grok2apiScripts } from "./grok2api.js";
import type { CallScript } from "@infinite-canvas/shared/models";

// 新增内置脚本只需新增一个定义文件，并在此注册；OpenAI 始终优先。
export const builtinCallScripts: CallScript[] = [
    ...openaiScripts,
    ...anthropicScripts,
    ...geminiScripts,
    ...agnesScripts,
    ...seedanceScripts,
    ...wanScripts,
    ...klingScripts,
    ...viduScripts,
    ...hailuoScripts,
    ...xaiScripts,
    ...grok2apiScripts,
];
