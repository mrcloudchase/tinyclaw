import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("../../src/config/paths.js", () => ({
  resolveConfigDir: () => "/mock/.config/tinyclaw",
  resolveSkillsDir: () => "/mock/.config/tinyclaw/skills",
  ensureDir: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import fs from "node:fs";
import { loadSkillsFromDir, formatSkillsForPrompt, executeSkillCommand, type Skill } from "../../src/skills/skills.js";

describe("loadSkillsFromDir", () => {
  it("returns empty array for non-existent directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const skills = loadSkillsFromDir("/nonexistent");
    expect(skills).toEqual([]);
  });

  it("loads .md files from directory", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(["weather.md", "github.md", "readme.txt"] as any);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (String(filePath).includes("weather")) {
        return "---\ndescription: Check weather\ntags: [weather, api]\n---\n\nFetch weather from wttr.in";
      }
      if (String(filePath).includes("github")) {
        return "---\ndescription: GitHub operations\n---\n\nRun gh commands";
      }
      return "";
    });

    const skills = loadSkillsFromDir("/skills");
    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe("weather");
    expect(skills[0].description).toBe("Check weather");
    expect(skills[0].tags).toEqual(["weather", "api"]);
    expect(skills[0].content).toBe("Fetch weather from wttr.in");
    expect(skills[1].name).toBe("github");
  });

  it("handles files without frontmatter", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(["simple.md"] as any);
    vi.mocked(fs.readFileSync).mockReturnValue("Just plain content\nNo frontmatter here");

    const skills = loadSkillsFromDir("/skills");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("simple");
    expect(skills[0].description).toBe("simple");
    expect(skills[0].content).toBe("Just plain content\nNo frontmatter here");
  });
});

describe("formatSkillsForPrompt", () => {
  it("formats skills as markdown list", () => {
    const skills: Skill[] = [
      { name: "weather", description: "Check weather", content: "", filePath: "", tags: [] },
      { name: "github", description: "GitHub ops", content: "", filePath: "", tags: [] },
    ];
    const result = formatSkillsForPrompt(skills);
    expect(result).toContain("**weather**");
    expect(result).toContain("**github**");
    expect(result).toContain("Check weather");
  });

  it("returns empty string for no skills", () => {
    expect(formatSkillsForPrompt([])).toBe("");
  });
});

describe("executeSkillCommand", () => {
  it("returns not_found for unknown skill", () => {
    const result = executeSkillCommand("nonexistent-skill", "args");
    expect(result.type).toBe("not_found");
  });
});
