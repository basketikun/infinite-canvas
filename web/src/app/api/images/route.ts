import { NextRequest } from "next/server";

// /api/images POST 是 multipart 文件上传。Next.js rewrites 在转发 multipart
// 时既要 buffer 又有 30/60s 超时，大文件容易卡死前端（一直 pending）。
// 这里走 Route Handler 直接 streaming 给后端，跟 /api/v1/images/* 同一套路。
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const API_BASE = process.env.API_BASE_URL || "http://127.0.0.1:8080";

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") || "application/octet-stream",
  };
  const auth = req.headers.get("authorization");
  if (auth) headers.Authorization = auth;

  const upstream = await fetch(`${API_BASE}/api/images`, {
    method: "POST",
    headers,
    body: req.body,
    // Node 18+ 流式 body 必须声明 duplex；TS 类型暂未收录该字段。
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
