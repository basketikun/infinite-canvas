import { NextRequest } from "next/server";

// 图生图同样可能超过 30s，dev 模式走 Route Handler 透传 multipart 给后端；
// 生产模式由 next.config.ts 的 beforeFiles rewrites 优先匹配，跳过这里。
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const API_BASE = process.env.API_BASE_URL || "http://127.0.0.1:8080";

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  const auth = req.headers.get("authorization");
  if (auth) headers.Authorization = auth;

  const upstream = await fetch(`${API_BASE}/api/v1/images/edits`, {
    method: "POST",
    headers,
    body: req.body,
    // @ts-expect-error duplex 不在标准 RequestInit 类型里
    duplex: "half",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    },
  });
}
