export function remoteMediaProxyUrl(url: string) {
    if (!/^https?:\/\//i.test(url)) return url;
    return `/api/media-proxy?url=${encodeURIComponent(url)}`;
}
