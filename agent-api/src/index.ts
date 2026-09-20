import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
createApp(config).listen(config.port, () => {
    console.log(`Research Canvas Agent API listening on ${config.port}`);
});
