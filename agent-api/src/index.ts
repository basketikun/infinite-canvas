import { createApp } from "./app.js";
import { provisionBuiltinTestAccount } from "./builtin-test-account.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
await provisionBuiltinTestAccount(config.supabaseUrl, config.supabaseSecretKey);
createApp(config).listen(config.port, () => {
    console.log(`Research Canvas Agent API listening on ${config.port}`);
});
