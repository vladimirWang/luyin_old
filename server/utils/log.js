import winston from 'winston'
import fs from "node:fs";
import path from "node:path";

const isProduction = process.env.NODE_ENV === "prod";
const logDir = path.resolve(process.cwd(), process.env.LOG_DIR || "logs");

console.log(`--------------server -------------- isProd: ${isProduction}, logDir: ${logDir}, process.env.LOG_DIR: ${process.env.LOG_DIR}`)
if (true) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
    ),
    defaultMeta: { service: 'wecom-recorder-server' },
    transports: isProduction
        ? [
            new winston.transports.File({
                filename: path.join(logDir, "error.log"),
                level: "error",
                maxsize: 10 * 1024 * 1024,
                maxFiles: 10,
            }),
            new winston.transports.File({
                filename: path.join(logDir, "combined.log"),
                maxsize: 20 * 1024 * 1024,
                maxFiles: 10,
            }),
        ]
        : [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.simple(),
                ),
            }),
        ],
});

export default logger