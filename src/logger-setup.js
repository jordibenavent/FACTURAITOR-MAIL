
import pino from "pino";
import fs from "fs";
import path from "path";
import { __dirname }   from './utilities.js';

//Esto es la config de pino, logger de la app, recoge los console.log y los almacena en la carpeta logs
const isDev = process.env.NODE_ENV !== "production";
const logsDir = path.join(__dirname, "logs");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const fileStream = pino.destination(path.join(logsDir, "app.log"));


const transport = isDev
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
        ignore: "pid,hostname",
      },
    })
  : undefined;

const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    base: { service: "facturaitor-mail" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  isDev
    ? pino.multistream([{ stream: transport }, { stream: fileStream }])
    : fileStream
);

// Sobrescribe los console
console.log = (...args) => logger.info(...args);
console.info = (...args) => logger.info(...args);
console.warn = (...args) => logger.warn(...args);
console.error = (...args) => logger.error(...args);
console.debug = (...args) => logger.debug(...args);

export default logger;
