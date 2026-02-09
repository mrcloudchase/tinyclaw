import chalk from "chalk";

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

export const log = {
  info(msg: string): void {
    console.error(chalk.blue("info"), msg);
  },
  warn(msg: string): void {
    console.error(chalk.yellow("warn"), msg);
  },
  error(msg: string): void {
    console.error(chalk.red("error"), msg);
  },
  debug(msg: string): void {
    if (verbose) {
      console.error(chalk.gray("debug"), msg);
    }
  },
};
