export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
    const parts = (Array.isArray(request.query.path) ? request.query.path : String(request.query.path || "").split("/")).filter((part) => part && part !== "." && part !== "..");
    if (!parts.length) {
        response.status(404).json({ error: { message: "Ark API path is required" } });
        return;
    }
    if (request.method !== "GET" && request.method !== "POST") {
        response.setHeader("Allow", "GET, POST");
        response.status(405).json({ error: { message: "Method not allowed" } });
        return;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
        response.status(401).json({ error: { message: "Authorization is required" } });
        return;
    }

    try {
        const body = request.method === "POST" ? await readBody(request) : undefined;
        const upstream = await fetch(`https://ark.cn-beijing.volces.com/api/v3/${parts.map(encodeURIComponent).join("/")}`, {
            method: request.method,
            headers: {
                Authorization: authorization,
                Accept: request.headers.accept || "application/json",
                ...(request.headers["content-type"] ? { "Content-Type": request.headers["content-type"] } : {}),
            },
            body,
        });
        response.status(upstream.status);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
        response.send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
        response.status(502).json({ error: { message: "Failed to reach Volcengine Ark" } });
    }
}

async function readBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks);
}
