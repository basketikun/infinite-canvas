import { describe, expect, it } from "vitest";

import { sanitizeWebdavTargetForLog, validateWebdavTarget } from "./webdav-target";

describe("validateWebdavTarget", () => {
    it("allows public http and https targets", () => {
        expect(validateWebdavTarget("https://dav.example.com/remote.php/dav/files/a?token=secret").ok).toBe(true);
        expect(validateWebdavTarget("http://dav.example.com/remote.php/dav/files/a").ok).toBe(true);
    });

    it("blocks localhost, metadata and private address targets", () => {
        expect(validateWebdavTarget("http://localhost:8080").ok).toBe(false);
        expect(validateWebdavTarget("http://app.localhost:8080").ok).toBe(false);
        expect(validateWebdavTarget("http://metadata.google.internal").ok).toBe(false);
        expect(validateWebdavTarget("http://127.0.0.1:8080").ok).toBe(false);
        expect(validateWebdavTarget("http://10.0.0.5").ok).toBe(false);
        expect(validateWebdavTarget("http://172.16.0.5").ok).toBe(false);
        expect(validateWebdavTarget("http://192.168.1.2").ok).toBe(false);
        expect(validateWebdavTarget("http://169.254.169.254").ok).toBe(false);
        expect(validateWebdavTarget("http://[::1]").ok).toBe(false);
        expect(validateWebdavTarget("http://[fd00::1]").ok).toBe(false);
    });

    it("rejects unsupported targets and removes query strings from logs", () => {
        expect(validateWebdavTarget("ftp://dav.example.com/path").ok).toBe(false);
        expect(validateWebdavTarget("https://user:pass@dav.example.com/path").ok).toBe(false);

        const result = validateWebdavTarget("https://dav.example.com/path?password=secret");
        expect(result.ok && sanitizeWebdavTargetForLog(result.url)).toBe("https://dav.example.com/path");
    });
});
