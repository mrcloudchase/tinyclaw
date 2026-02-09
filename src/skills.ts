// Skills System — Loader + registry
// All in ONE file

import fs from "node:fs";
import path from "node:path";
import { resolveSkillsDir, resolveConfigDir, ensureDir } from "./config/paths.js";
import type { TinyClawConfig } from "./config/schema.js";
import { log } from "./utils/logger.js";

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
  tags?: string[];
}

const skillRegistry = new Map<string, Skill>();

function parseSkillFile(filePath: string): Skill | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const name = path.basename(filePath, path.extname(filePath));

    // Parse YAML frontmatter
    let description = name;
    let tags: string[] = [];
    let content = raw;

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      const frontmatter = fmMatch[1];
      content = fmMatch[2].trim();
      const descMatch = frontmatter.match(/description:\s*(.+)/);
      if (descMatch) description = descMatch[1].trim();
      const tagsMatch = frontmatter.match(/tags:\s*\[([^\]]*)\]/);
      if (tagsMatch) tags = tagsMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, ""));
    }

    return { name, description, content, filePath, tags };
  } catch {
    return undefined;
  }
}

export function loadSkillsFromDir(dir: string): Skill[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir, { recursive: true }) as string[];
  const skills: Skill[] = [];
  for (const file of files) {
    if (typeof file !== "string") continue;
    if (!file.endsWith(".md")) continue;
    const skill = parseSkillFile(path.join(dir, file));
    if (skill) skills.push(skill);
  }
  return skills;
}

export function discoverSkills(config: TinyClawConfig): Skill[] {
  const skills: Skill[] = [];

  // 1. Bundled skills
  const bundledDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "skills", "bundled");
  if (fs.existsSync(bundledDir)) {
    const bundled = loadSkillsFromDir(bundledDir);
    const allowed = config.skills?.allowBundled;
    for (const s of bundled) {
      if (!allowed || allowed.includes(s.name)) {
        skillRegistry.set(s.name, s);
        skills.push(s);
      }
    }
  }

  // 2. User skills directory
  const userDir = resolveSkillsDir();
  if (fs.existsSync(userDir)) {
    for (const s of loadSkillsFromDir(userDir)) {
      skillRegistry.set(s.name, s);
      skills.push(s);
    }
  }

  // 3. Extra dirs from config
  const extraDirs = config.skills?.load?.extraDirs ?? [];
  for (const dir of extraDirs) {
    if (fs.existsSync(dir)) {
      for (const s of loadSkillsFromDir(dir)) {
        skillRegistry.set(s.name, s);
        skills.push(s);
      }
    }
  }

  // Check per-skill enabled
  const entries = config.skills?.entries;
  if (entries) {
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.enabled === false) skillRegistry.delete(name);
    }
  }

  log.debug(`Discovered ${skills.length} skills`);
  return skills;
}

export function getSkill(name: string): Skill | undefined {
  return skillRegistry.get(name);
}

export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- **${s.name}**: ${s.description}`);
  return lines.join("\n");
}

export function getAllSkills(): Skill[] {
  return [...skillRegistry.values()];
}

// ── Skill Command Execution ──

export interface SkillExecutionResult {
  type: "prompt" | "not_found";
  rewrittenBody?: string;
}

export function executeSkillCommand(name: string, args: string): SkillExecutionResult {
  const skill = skillRegistry.get(name);
  if (!skill) return { type: "not_found" };

  // Check frontmatter for command-dispatch mode
  const raw = fs.readFileSync(skill.filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  let dispatch: "prompt" | "tool" = "prompt";
  if (fmMatch) {
    const cdMatch = fmMatch[1].match(/command-dispatch:\s*(\w+)/);
    if (cdMatch && cdMatch[1] === "tool") dispatch = "tool";
  }

  // Prompt-based: rewrite body with skill content as context
  const context = `[Skill: ${skill.name}]\n\n${skill.content}\n\n---\n\nUser request: ${args || "(no arguments)"}`;
  return { type: "prompt", rewrittenBody: context };
}
