const NON_PUBLIC_HOST_SUFFIXES = ["localhost", "local", "localdomain", "home.arpa", "test", "invalid"];
const PUBLIC_IPV6_CIDRS = [
    { prefix: "2001:1::1", bits: 128 },
    { prefix: "2001:1::2", bits: 128 },
    { prefix: "2001:1::3", bits: 128 },
    { prefix: "2001:3::", bits: 32 },
    { prefix: "2001:4:112::", bits: 48 },
    { prefix: "2001:20::", bits: 28 },
    { prefix: "2001:30::", bits: 28 },
    { prefix: "64:ff9b::", bits: 96 },
    { prefix: "2620:4f:8000::", bits: 48 },
];
const NON_PUBLIC_IPV6_CIDRS = [
    { prefix: "::", bits: 96 },
    { prefix: "100::", bits: 64 },
    { prefix: "100:0:0:1::", bits: 64 },
    { prefix: "5f00::", bits: 16 },
    { prefix: "64:ff9b:1::", bits: 48 },
    { prefix: "2001::", bits: 23 },
    { prefix: "2001:2::", bits: 48 },
    { prefix: "2001:db8::", bits: 32 },
    { prefix: "2002::", bits: 16 },
    { prefix: "3fff::", bits: 20 },
    { prefix: "fc00::", bits: 7 },
    { prefix: "fe80::", bits: 10 },
    { prefix: "fec0::", bits: 10 },
    { prefix: "ff00::", bits: 8 },
];

export function duomiRequestUrl(baseUrl, path, useProxy, proxyUrl) {
    if (useProxy) return proxyUrl;
    return `${normalizedBaseUrl(baseUrl)}${path}`;
}

export function duomiRequestHeaders(baseUrl, apiKey, useProxy, proxyHeaders = {}, proxyTargetHeader = "x-ai-proxy-target-base-url") {
    return {
        ...proxyHeaders,
        Authorization: apiKey,
        "Content-Type": "application/json",
        ...(useProxy ? { [proxyTargetHeader]: normalizedBaseUrl(baseUrl) } : {}),
    };
}

export function isDuomiRequestTimeout(error) {
    return isRecord(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT");
}

export function duomiPublicReferenceUrls(urls, { min = 0, max = Infinity, errorMessage = "参考图必须是公网图片 URL" } = {}) {
    if (!Array.isArray(urls) || urls.length < min || urls.length > max || !urls.every(isPublicHttpUrl)) {
        throw new Error(errorMessage);
    }
    return [...urls];
}

function isPublicHttpUrl(value) {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
        const mappedIpv4 = mappedIpv4FromHostname(hostname);
        if (mappedIpv4) return !isNonPublicIpv4(mappedIpv4);
        if (hostname.includes(":")) return !isNonPublicIpv6(hostname);
        if (isNonPublicHostname(hostname)) return false;
        return !isNonPublicIpv4(hostname);
    } catch {
        return false;
    }
}

function isNonPublicHostname(hostname) {
    if (!hostname.includes(".")) return true;
    return NON_PUBLIC_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function mappedIpv4FromHostname(hostname) {
    const match = hostname.replace(/^\[|\]$/g, "").match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
    if (!match) return "";
    const high = Number.parseInt(match[1], 16);
    const low = Number.parseInt(match[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function isNonPublicIpv4(hostname) {
    const octets = hostname.split(".");
    if (octets.length !== 4 || octets.some((value) => !/^\d+$/.test(value) || Number(value) > 255)) return false;
    const [first, second, third, fourth] = octets.map(Number);
    return (
        first === 0 ||
        first === 10 ||
        (first === 100 && second >= 64 && second <= 127) ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 192 && second === 0 && third === 0 && fourth !== 9 && fourth !== 10) ||
        (first === 192 && second === 0 && third === 2) ||
        (first === 192 && second === 88 && third === 99) ||
        (first === 198 && (second === 18 || second === 19)) ||
        (first === 198 && second === 51 && third === 100) ||
        (first === 203 && second === 0 && third === 113) ||
        first >= 224
    );
}

function isNonPublicIpv6(hostname) {
    if (PUBLIC_IPV6_CIDRS.some(({ prefix, bits }) => isIpv6InCidr(hostname, prefix, bits))) return false;
    return NON_PUBLIC_IPV6_CIDRS.some(({ prefix, bits }) => isIpv6InCidr(hostname, prefix, bits));
}

function isIpv6InCidr(hostname, prefix, bits) {
    const address = ipv6Hextets(hostname);
    const network = ipv6Hextets(prefix);
    if (address.length !== 8 || network.length !== 8) return false;
    const wholeHextets = Math.floor(bits / 16);
    for (let index = 0; index < wholeHextets; index += 1) {
        if (address[index] !== network[index]) return false;
    }
    const remainingBits = bits % 16;
    if (!remainingBits) return true;
    const mask = (0xffff << (16 - remainingBits)) & 0xffff;
    return (address[wholeHextets] & mask) === (network[wholeHextets] & mask);
}

function ipv6Hextets(hostname) {
    const value = hostname.replace(/^\[|\]$/g, "");
    const separatorIndex = value.indexOf("::");
    const left = (separatorIndex < 0 ? value : value.slice(0, separatorIndex)).split(":").filter(Boolean);
    const right = (separatorIndex < 0 ? "" : value.slice(separatorIndex + 2)).split(":").filter(Boolean);
    const missing = separatorIndex < 0 ? 0 : 8 - left.length - right.length;
    const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
    if (parts.length !== 8 || parts.some((part) => !/^[\da-f]{1,4}$/.test(part))) return [];
    return parts.map((part) => Number.parseInt(part, 16));
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedBaseUrl(baseUrl) {
    return String(baseUrl || "")
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/v1$/i, "");
}
