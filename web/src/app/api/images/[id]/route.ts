import { NextRequest } from "next/server";

// GET /api/images/:id 流式回传二进制；DELETE 透传给后端做归属校验。
// 同样为了避免 Next.js rewrites 对大体积响应/请求的卡顿问题改走 Route Handler。
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const API_BASE = process.env.API_BASE_URL || "http://127.0.0.1:8080";

const FORWARD_RESPONSE_HEADERS = ["content-type", "content-length", "cache-control", "etag"];

function buildResponseHeaders(upstream: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const key of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(key);
    if (value) headers[key.replace(/(^|-)\w/g, (s) => s.toUpperCase())] = value;
  }
  return headers;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API_BASE}/api/images/${encodeURIComponent(id)}`);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: buildResponseHeaders(upstream),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) headers.Authorization = auth;

  const upstream = await fetch(`${API_BASE}/api/images/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    },
  });
}
