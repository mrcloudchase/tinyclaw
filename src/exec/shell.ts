import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function resolvePowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    const candidate = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
}

function resolveShellFromPath(name: string): string | undefined {
  const envPath = process.env.PATH ?? "";
  if (!envPath) return undefined;
  for (const entry of envPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not found or not executable
    }
  }
  return undefined;
}

export function getShellConfig(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      shell: resolvePowerShellPath(),
      args: ["-NoProfile", "-NonInteractive", "-Command"],
    };
  }

  const envShell = process.env.SHELL?.trim();
  const shellName = envShell ? path.basename(envShell) : "";

  // Fish rejects common bashisms, prefer bash when detected
  if (shellName === "fish") {
    const bash = resolveShellFromPath("bash");
    if (bash) return { shell: bash, args: ["-c"] };
    const sh = resolveShellFromPath("sh");
    if (sh) return { shell: sh, args: ["-c"] };
  }

  const shell = envShell && envShell.length > 0 ? envShell : "sh";
  return { shell, args: ["-c"] };
}

export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
      });
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}
