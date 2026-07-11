import winston from 'winston'
import fs from "node:fs";
import path from "node:path";
import "winston-daily-rotate-file";

const isProduction = process.env.NODE_ENV === "prod";
const logDir = path.resolve(process.cwd(), process.env.LOG_DIR || "logs");

console.log(`--------------server -------------- node_env: ${process.env.NODE_ENV} isProd: ${isProduction}, logDir: ${logDir}, process.env.LOG_DIR: ${process.env.LOG_DIR}`)
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
            new winston.transports.DailyRotateFile({
                filename: path.join(logDir, "error-%DATE%.log"),
                datePattern: "YYYY-MM-DD",
                level: "error",
                maxFiles: "30d",
                maxSize: "20m",
            }),
            new winston.transports.DailyRotateFile({
                filename: path.join(logDir, "combined-%DATE%.log"),
                datePattern: "YYYY-MM-DD",
                maxFiles: "30d",
                maxSize: "50m",
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