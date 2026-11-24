import { contribute, definePlugin } from "@infinite-canvas/plugin-sdk";
import { syncTransports } from "@infinite-canvas/plugin-sdk/builtin";
import { webdavTransport } from "./transports/webdav";

export default definePlugin({
    contributions: [contribute(syncTransports, { id: "webdav-sync:transport", value: webdavTransport })],
});
