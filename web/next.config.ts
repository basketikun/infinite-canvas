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
      // dev 和 production 都让长请求接口走 src/app/api/{v1/images/*, images} 的 Route Handler，
      // 因为实测 next dev 和 next start 的 rewrites 都会在 ~30/60s 切断响应；同时 multipart
      // 大文件上传经 rewrites 转发会 buffer 卡顿，常表现为前端 fetch 一直 pending。
      // Route Handler 走 streaming + maxDuration 5 分钟，行为可控。其它接口仍由 rewrites 直转。
      return [{ source: "/api/:path*", destination: `${apiBaseUrl}/api/:path*` }];
    },
  };
}
