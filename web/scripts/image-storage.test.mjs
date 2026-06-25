import assert from "node:assert/strict";

import { remoteMediaProxyUrl } from "../src/services/media-proxy-url.ts";

const remote = "https://upload.apib.ai/f/image/example.png?x=1&y=2";
assert.equal(remoteMediaProxyUrl(remote), "/api/media-proxy?url=https%3A%2F%2Fupload.apib.ai%2Ff%2Fimage%2Fexample.png%3Fx%3D1%26y%3D2");

const apimartResult = "https://getapib.org/f/image/generated.png";
assert.equal(remoteMediaProxyUrl(apimartResult), "/api/media-proxy?url=https%3A%2F%2Fgetapib.org%2Ff%2Fimage%2Fgenerated.png");

assert.equal(remoteMediaProxyUrl("data:image/png;base64,abc"), "data:image/png;base64,abc");
assert.equal(remoteMediaProxyUrl("blob:http://localhost:3000/abc"), "blob:http://localhost:3000/abc");
