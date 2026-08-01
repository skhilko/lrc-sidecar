import type { LogEvent, Logger } from "../domain/types.js";

export interface LoggerOptions { json: boolean; verbose: boolean; quiet: boolean }

export function createLogger(options: LoggerOptions): Logger {
  return {
    event(input): void {
      if (input.level === "debug" && !options.verbose) return;
      if (options.quiet && input.level !== "error") return;
      const event: LogEvent = { ...input, at: new Date().toISOString() };
      const stream = input.level === "error" ? process.stderr : process.stdout;
      if (options.json) {
        stream.write(`${JSON.stringify(event)}\n`);
        return;
      }
      const path = typeof input.path === "string" ? ` ${input.path}` : "";
      const prefix = input.level === "error" ? "ERROR" : input.level === "warn" ? "WARN" : input.level === "debug" ? "DEBUG" : "";
      stream.write(`${prefix ? `${prefix} ` : ""}${input.message}${path}\n`);
    },
  };
}
