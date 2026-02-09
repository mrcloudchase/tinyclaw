// Docker Sandbox — container management for isolated code execution
// Uses child_process.spawn("docker", ...) — no new dependencies

import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export interface SandboxConfig {
  enabled: boolean;
  image: string;
  scope: "session" | "shared";
  memoryLimit: string;
  cpuLimit: string;
  networkMode: "none" | "bridge";
  mountWorkspace: boolean;
  timeoutSec: number;
}

export interface SandboxExecResult {
  output: string;
  exitCode: number;
}

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: false,
  image: "tinyclaw-sandbox",
  scope: "session",
  memoryLimit: "512m",
  cpuLimit: "1",
  networkMode: "none",
  mountWorkspace: false,
  timeoutSec: 300,
};

// ══════════════════════════════════════════════
// ── Container Name Helper ──
// ══════════════════════════════════════════════

export function containerName(sessionKey: string): string {
  // Sanitize session key for Docker container naming
  const slug = sessionKey
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return `tinyclaw-sandbox-${slug}`;
}

// ══════════════════════════════════════════════
// ── Docker Command Runner ──
// ══════════════════════════════════════════════

function runDocker(args: string[], timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let resolved = false;

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill("SIGKILL");
        resolve({ stdout, stderr: stderr + "\nDocker command timed out", exitCode: 124 });
      }
    }, timeoutMs);

    proc.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    proc.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      }
    });
  });
}

// ══════════════════════════════════════════════
// ── Image Management ──
// ══════════════════════════════════════════════

export async function ensureSandboxImage(imageName: string): Promise<boolean> {
  // Check if image exists
  const check = await runDocker(["image", "inspect", imageName]);
  if (check.exitCode === 0) return true;

  // Try to build from Dockerfile.sandbox in cwd
  log.info(`Building sandbox image: ${imageName}`);
  const build = await runDocker(
    ["build", "-f", "Dockerfile.sandbox", "-t", imageName, "."],
    120_000,
  );

  if (build.exitCode !== 0) {
    log.error(`Failed to build sandbox image: ${build.stderr}`);
    return false;
  }

  log.info(`Sandbox image built: ${imageName}`);
  return true;
}

// ══════════════════════════════════════════════
// ── Container Lifecycle ──
// ══════════════════════════════════════════════

export async function ensureSandboxContainer(
  sessionKey: string,
  config: Partial<SandboxConfig> = {},
): Promise<string | null> {
  const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
  const name = containerName(sessionKey);

  // Check if container already exists and is running
  const inspect = await runDocker(["inspect", "-f", "{{.State.Running}}", name]);
  if (inspect.exitCode === 0 && inspect.stdout.trim() === "true") {
    return name;
  }

  // Check if container exists but stopped
  if (inspect.exitCode === 0) {
    const start = await runDocker(["start", name]);
    if (start.exitCode === 0) return name;
  }

  // Ensure image exists
  const imageReady = await ensureSandboxImage(cfg.image);
  if (!imageReady) return null;

  // Create new container
  const createArgs = [
    "run", "-d",
    "--name", name,
    "--memory", cfg.memoryLimit,
    "--cpus", cfg.cpuLimit,
    "--network", cfg.networkMode,
    "--restart", "no",
    "--label", "tinyclaw=sandbox",
  ];

  if (cfg.mountWorkspace) {
    createArgs.push("-v", `${process.cwd()}:/workspace:rw`);
  }

  createArgs.push(cfg.image);

  const create = await runDocker(createArgs, 30_000);
  if (create.exitCode !== 0) {
    log.error(`Failed to create sandbox container ${name}: ${create.stderr}`);
    return null;
  }

  log.info(`Sandbox container created: ${name}`);
  return name;
}

// ══════════════════════════════════════════════
// ── Execute in Sandbox ──
// ══════════════════════════════════════════════

export async function execInSandbox(
  containerNameOrId: string,
  command: string,
  opts: { timeoutSec?: number; workdir?: string; env?: Record<string, string> } = {},
): Promise<SandboxExecResult> {
  const timeoutSec = opts.timeoutSec ?? 300;
  const execArgs = ["exec"];

  if (opts.workdir) {
    execArgs.push("-w", opts.workdir);
  }

  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      execArgs.push("-e", `${k}=${v}`);
    }
  }

  execArgs.push(containerNameOrId, "bash", "-c", command);

  const result = await runDocker(execArgs, timeoutSec * 1000);

  const output = (result.stdout + (result.stderr ? `\n${result.stderr}` : "")).trim();
  return { output, exitCode: result.exitCode };
}

// ══════════════════════════════════════════════
// ── Container Cleanup ──
// ══════════════════════════════════════════════

export async function removeSandboxContainer(name: string): Promise<void> {
  await runDocker(["rm", "-f", name]);
  log.info(`Sandbox container removed: ${name}`);
}

export async function listSandboxContainers(): Promise<string[]> {
  const result = await runDocker([
    "ps", "-a",
    "--filter", "label=tinyclaw=sandbox",
    "--format", "{{.Names}}",
  ]);

  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

export async function cleanupAllSandboxes(): Promise<void> {
  const containers = await listSandboxContainers();
  for (const name of containers) {
    await removeSandboxContainer(name);
  }
  log.info(`Cleaned up ${containers.length} sandbox containers`);
}

// ══════════════════════════════════════════════
// ── Resolve Sandbox for Session ──
// ══════════════════════════════════════════════

export function resolveSandboxConfig(config: { sandbox?: Partial<SandboxConfig> }): SandboxConfig {
  return { ...DEFAULT_SANDBOX_CONFIG, ...config.sandbox };
}
