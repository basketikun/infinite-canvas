import fs from "node:fs";
import path from "node:path";
import winston from "winston";

import { LOGS_DIR } from "./config.js";

export function createLogger(module: string) {
    fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });
    const fileTransport = new winston.transports.File({
        filename: path.join(LOGS_DIR, `${module}.log`),
        maxsize: 5 * 1024 * 1024,
        maxFiles: 3,
    });
    const consoleTransport = new winston.transports.Console({
        level: "info",
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message }) =>
                `${timestamp} ${level} [${module}] ${typeof message === "string" ? message : JSON.stringify(message)}`
            ),
        ),
    });
    return winston.createLogger({
        level: process.env.LOG_LEVEL || "info",
        transports: [fileTransport, consoleTransport],
    });
}
