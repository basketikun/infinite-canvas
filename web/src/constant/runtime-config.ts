// 运行期配置读取层。
// 优先级：window.__RUNTIME_CONFIG__（容器启动时由 entrypoint 注入）> 构建期 VITE_ 变量 > 默认值。
// 这样既支持「同一镜像 docker run -e 配置」，也兼容自行 build 时的构建期注入。
//
// 统计按「每家一个独立变量」配置：填了谁就启用谁，可同时启用多家，默认全空即关闭。
// 仅支持 GA4 与百度：两者都只接受 ID，脚本地址由代码固定拼接，不接受任意脚本/内联 JS。

type RuntimeConfig = {
    ANALYTICS_GA4_ID?: string; // GA4 衡量 ID（G-XXXX）
    ANALYTICS_BAIDU_ID?: string; // 百度统计站点 ID
    CONTROL_PLANE_URL?: string;
};

declare global {
    interface Window {
        __RUNTIME_CONFIG__?: RuntimeConfig;
    }
}

const runtime: RuntimeConfig = (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) || {};

function read(key: keyof RuntimeConfig, buildTime: string | undefined, fallback = ""): string {
    const value = runtime[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof buildTime === "string" && buildTime.trim()) return buildTime.trim();
    return fallback;
}

export const ANALYTICS_GA4_ID = read("ANALYTICS_GA4_ID", import.meta.env.VITE_ANALYTICS_GA4_ID);
export const ANALYTICS_BAIDU_ID = read("ANALYTICS_BAIDU_ID", import.meta.env.VITE_ANALYTICS_BAIDU_ID);
export const CONTROL_PLANE_URL = read("CONTROL_PLANE_URL", import.meta.env.VITE_CONTROL_PLANE_URL);
