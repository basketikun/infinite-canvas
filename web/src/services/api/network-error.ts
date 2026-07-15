export type NetworkFailure = {
    fallback: string;
    code?: string;
    requestUrl?: string;
    pageProtocol?: string;
};

const timeoutCodes = new Set(["ECONNABORTED", "ETIMEDOUT"]);

/**
 * 浏览器不会把 CORS、证书和 DNS 等底层失败详情暴露给前端，
 * 这里只根据 Axios 可见信息给出不会误导为鉴权失败的排查建议。
 */
export function networkFailureMessage({ fallback, code, requestUrl, pageProtocol }: NetworkFailure) {
    const normalizedCode = (code || "").toUpperCase();
    if (normalizedCode === "ERR_CANCELED") return "请求已取消";
    if (timeoutCodes.has(normalizedCode)) return `${fallback}：请求超时，请检查接口地址、网络状态或上游服务`;
    if (isMixedContent(requestUrl, pageProtocol)) return `${fallback}：当前页面使用 HTTPS，浏览器禁止直连 HTTP 接口；请改用 HTTPS 地址或后端渠道`;
    return `${fallback}：浏览器未收到接口响应。通常是第三方接口未允许 CORS/OPTIONS、HTTPS 证书异常、DNS 或网络不可达；请改用后端渠道，或让接口放行当前站点来源`;
}

function isMixedContent(requestUrl?: string, pageProtocol?: string) {
    if (pageProtocol !== "https:" || !requestUrl) return false;
    try {
        return new URL(requestUrl, "https://infinite-canvas.invalid").protocol === "http:";
    } catch {
        return false;
    }
}
