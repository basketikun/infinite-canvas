import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const webDir = dirname(fileURLToPath(import.meta.url));
const version = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";

export default function nextConfig(phase: string): NextConfig {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  loadEnvConfig(resolve(webDir, ".."), isDev, undefined, true);
  const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8080";
  return {
    allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
    typescript: {
      ignoreBuildErrors: true,
    },
    env: {
      NEXT_PUBLIC_APP_VERSION: version,
    },
    async rewrites() {
      const passthrough = { source: "/api/:path*", destination: `${apiBaseUrl}/api/:path*` };
      if (isDev) {
        // dev 模式：长请求让 src/app/api/v1/images/* 的 Route Handler 处理，
        // 绕过 next dev rewrites 的 30 秒代理超时；其它接口走 rewrites 直转。
        return [passthrough];
      }
      // 生产模式：next start 的 rewrites 没有 30s 限制，把长请求放到 beforeFiles
      // 优先匹配，跳过 Route Handler 这层 Node 中转，少一跳延迟。
      return {
        beforeFiles: [
          { source: "/api/v1/images/generations", destination: `${apiBaseUrl}/api/v1/images/generations` },
          { source: "/api/v1/images/edits", destination: `${apiBaseUrl}/api/v1/images/edits` },
        ],
        afterFiles: [passthrough],
        fallback: [],
      };
    },
  };
}
