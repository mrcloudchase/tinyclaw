import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { getShellConfig, killProcessTree } from "./shell.js";
import { log } from "../util/logger.js";

interface ExecToolOptions {
  cwd?: string;
  timeoutSec?: number;
  backgroundMs?: number;
  maxOutput?: number;
  sandboxContainer?: string;
}

interface ExecSession {
  id: string;
  proc: ChildProcess;
  output: string;
  exitCode: number | null;
  finished: boolean;
  startedAt: number;
}

const sessions = new Map<string, ExecSession>();
let sessionCounter = 0;

function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const half = Math.floor(maxChars / 2);
  return (
    output.slice(0, half) +
    `\n\n... [truncated ${output.length - maxChars} chars] ...\n\n` +
    output.slice(-half)
  );
}

async function executeCommand(
  command: string,
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutSec: number;
    backgroundMs: number;
    maxOutput: number;
    background?: boolean;
    sandboxContainer?: string;
  },
): Promise<{ output: string; exitCode: number | null; sessionId?: string }> {
  // Sandbox routing: execute inside Docker container if specified
  if (opts.sandboxContainer) {
    const { execInSandbox } = await import("../sandbox.js");
    const result = await execInSandbox(opts.sandboxContainer, command, {
      timeoutSec: opts.timeoutSec,
      workdir: opts.cwd,
      env: opts.env,
    });
    return {
      output: truncateOutput(result.output, opts.maxOutput),
      exitCode: result.exitCode,
    };
  }

  const { shell, args } = getShellConfig();
  const cwd = opts.cwd || process.cwd();

  const proc = spawn(shell, [...args, command], {
    cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let output = "";
  const appendOutput = (chunk: Buffer) => {
    output += chunk.toString("utf-8");
    if (output.length > opts.maxOutput * 2) {
      output = output.slice(-opts.maxOutput);
    }
  };

  proc.stdout?.on("data", appendOutput);
  proc.stderr?.on("data", appendOutput);

  const sessionId = `exec-${++sessionCounter}`;
  const session: ExecSession = {
    id: sessionId,
    proc,
    output: "",
    exitCode: null,
    finished: false,
    startedAt: Date.now(),
  };

  // If background mode, register session and return immediately
  if (opts.background) {
    sessions.set(sessionId, session);
    proc.on("close", (code) => {
      session.output = output;
      session.exitCode = code;
      session.finished = true;
    });
    return { output: `Background session started: ${sessionId}`, exitCode: null, sessionId };
  }

  // Wait for completion or yield timeout
  return new Promise((resolve) => {
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let yieldTimer: ReturnType<typeof setTimeout> | undefined;
    let resolved = false;

    const finish = (code: number | null) => {
      if (resolved) return;
      resolved = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (yieldTimer) clearTimeout(yieldTimer);
      resolve({
        output: truncateOutput(output, opts.maxOutput),
        exitCode: code,
      });
    };

    proc.on("close", (code) => {
      session.output = output;
      session.exitCode = code;
      session.finished = true;
      finish(code);
    });

    proc.on("error", (err) => {
      output += `\nProcess error: ${err.message}`;
      finish(1);
    });

    // Hard timeout
    timeoutTimer = setTimeout(() => {
      if (!resolved) {
        output += `\n\nCommand timed out after ${opts.timeoutSec}s`;
        if (proc.pid) killProcessTree(proc.pid);
        finish(124);
      }
    }, opts.timeoutSec * 1000);

    // Yield timeout — if process is still running after backgroundMs,
    // move it to background and return what we have
    if (!opts.background && opts.backgroundMs > 0) {
      yieldTimer = setTimeout(() => {
        if (!resolved && !session.finished) {
          sessions.set(sessionId, session);
          proc.on("close", (code) => {
            session.output = output;
            session.exitCode = code;
            session.finished = true;
          });
          resolved = true;
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve({
            output:
              truncateOutput(output, opts.maxOutput) +
              `\n\nCommand still running in background (session: ${sessionId}). ` +
              `Use the process tool to check status.`,
            exitCode: null,
            sessionId,
          });
        }
      }, opts.backgroundMs);
    }
  });
}

/**
 * Creates a simplified exec tool for shell command execution.
 * Stripped down from OpenClaw's 1,630-line version.
 */
export function createExecTool(options?: ExecToolOptions) {
  const defaultCwd = options?.cwd ?? process.cwd();
  const defaultTimeoutSec = options?.timeoutSec ?? 1800;
  const defaultBackgroundMs = options?.backgroundMs ?? 10000;
  const defaultMaxOutput = options?.maxOutput ?? 200_000;
  const sandboxContainer = options?.sandboxContainer;

  return {
    name: "bash" as const,
    description:
      "Execute a shell command. Commands run in the user's shell. " +
      "Use for running scripts, installing packages, git operations, " +
      "and other terminal tasks.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string" as const,
          description: "The shell command to execute",
        },
        workdir: {
          type: "string" as const,
          description: "Working directory (default: project root)",
        },
        timeout: {
          type: "number" as const,
          description: "Timeout in seconds (default: 1800)",
        },
        background: {
          type: "boolean" as const,
          description: "Run immediately in background",
        },
      },
      required: ["command"] as const,
    },
    async execute(
      _toolCallId: string,
      params: {
        command: string;
        workdir?: string;
        timeout?: number;
        background?: boolean;
      },
    ) {
      const { command, workdir, timeout, background } = params;
      log.debug(`exec: ${command}`);

      const result = await executeCommand(command, {
        cwd: workdir ? path.resolve(defaultCwd, workdir) : defaultCwd,
        timeoutSec: timeout ?? defaultTimeoutSec,
        backgroundMs: defaultBackgroundMs,
        maxOutput: defaultMaxOutput,
        background,
        sandboxContainer,
      });

      const parts: string[] = [];
      if (result.output.trim()) {
        parts.push(result.output.trim());
      }
      if (result.exitCode !== null && result.exitCode !== 0) {
        parts.push(`\nExit code: ${result.exitCode}`);
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") || "(no output)" }],
      };
    },
  };
}

/**
 * List background exec sessions.
 */
export function listExecSessions(): ExecSession[] {
  return Array.from(sessions.values());
}

/**
 * Get output from a background session.
 */
export function getExecSessionOutput(sessionId: string): string | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  return session.output;
}
