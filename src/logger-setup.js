
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const transport = isDev
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    })
  : undefined;

const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    base: { service: "facturaitor-mail" },
  },
  transport
);

// Sobrescribe los console
console.log = (...args) => logger.info(...args);
console.info = (...args) => logger.info(...args);
console.warn = (...args) => logger.warn(...args);
console.error = (...args) => logger.error(...args);
console.debug = (...args) => logger.debug(...args);

export default logger;
