import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_PROXY_TIMEOUT_MS = 300000; // 5 min
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/** When running inside Docker, 127.0.0.1/localhost points to the container,
 * not the host. Rewrite to DOCKER_HOST_GATEWAY so the proxy can reach
 * services running on the host machine (e.g. sub2api/Cherry Studio at port 8751). */
function resolveProxyTarget(target: string): string {
  const gateway = process.env.DOCKER_HOST_GATEWAY;
  if (!gateway) return target;

  try {
    const url = new URL(target);
    if (LOCAL_HOSTNAMES.has(url.hostname)) {
      url.hostname = gateway;
      return url.toString();
    }
  } catch {
    // invalid URL, return as-is
  }
  return target;
}

async function proxyRequest(request: NextRequest, method: string) {
    const rawTarget = request.headers.get("x-ai-proxy-target") || "";
    const target = resolveProxyTarget(rawTarget);
    const auth = request.headers.get("x-ai-proxy-auth") || "";
    if (!target) return new Response("Missing x-ai-proxy-target", { status: 400 });

    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return new Response("Invalid x-ai-proxy-target", { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return new Response("Unsupported target protocol", { status: 400 });
    }

    const headers = new Headers();
    if (auth) headers.set("Authorization", auth);

    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);

    const accept = request.headers.get("accept");
    if (accept) headers.set("Accept", accept);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_PROXY_TIMEOUT_MS);
    try {
        const body = method === "GET" || method === "HEAD" || method === "DELETE"
            ? undefined
            : await request.arrayBuffer();

        const response = await fetch(url, {
            method,
            headers,
            body: body?.byteLength ? body : undefined,
            signal: controller.signal,
            redirect: "manual",
        });

        // Read response as text to avoid issues with gzip/content-encoding forwarding
        const responseText = await response.text();
        console.log("[AI Proxy] Response body length:", responseText.length);

        // Build safe headers - DO NOT forward Content-Encoding (fetch auto-decompresses)
        // or Content-Length (it changes after re-serialization).
        const forwardedHeaders = new Headers();
        forwardedHeaders.set("Content-Type", "application/json");

        return new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: forwardedHeaders,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return new Response("AI proxy timeout", { status: 504 });
        }
        return new Response(
            error instanceof Error ? error.message : "AI proxy error",
            { status: 502 },
        );
    } finally {
        clearTimeout(timer);
    }
}

export async function GET(request: NextRequest) {
    return proxyRequest(request, "GET");
}

export async function POST(request: NextRequest) {
    return proxyRequest(request, "POST");
}

export async function DELETE(request: NextRequest) {
    return proxyRequest(request, "DELETE");
}
