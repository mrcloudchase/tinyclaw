import chalk from "chalk";
import fs from "node:fs";

let verbose = false;
let jsonMode = false;
let logFile: string | undefined;

export function setVerbose(v: boolean): void { verbose = v; }
export function setJsonMode(v: boolean): void { jsonMode = v; }
export function setLogFile(path: string): void { logFile = path; }

function write(level: string, color: (s: string) => string, msg: string): void {
  if (jsonMode) {
    const line = JSON.stringify({ level, ts: Date.now(), msg });
    console.error(line);
    if (logFile) fs.appendFileSync(logFile, line + "\n");
  } else {
    console.error(color(level), msg);
    if (logFile) fs.appendFileSync(logFile, `${level} ${msg}\n`);
  }
}

export const log = {
  trace(msg: string): void { if (verbose) write("trace", chalk.dim, msg); },
  debug(msg: string): void { if (verbose) write("debug", chalk.gray, msg); },
  info(msg: string): void { write("info", chalk.blue, msg); },
  warn(msg: string): void { write("warn", chalk.yellow, msg); },
  error(msg: string): void { write("error", chalk.red, msg); },
};
