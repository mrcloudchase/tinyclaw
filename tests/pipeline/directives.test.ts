import { describe, it, expect } from "vitest";

// Test directive regex parsing directly
const DIRECTIVE_RE = /^(?:\+\+|\/)(\w+)\s+(\S+)/gm;

function parseDirectives(body: string) {
  const directives: Record<string, string> = {};
  const matches = [...body.matchAll(DIRECTIVE_RE)];
  for (const m of matches) {
    const [, key, value] = m;
    directives[key] = value;
  }
  const stripped = body.replace(DIRECTIVE_RE, "").trim();
  return { directives, stripped };
}

describe("directive parsing", () => {
  describe("++ prefix syntax", () => {
    it("parses ++think directive", () => {
      const result = parseDirectives("++think high\nHello");
      expect(result.directives.think).toBe("high");
      expect(result.stripped).toBe("Hello");
    });

    it("parses ++model directive", () => {
      const result = parseDirectives("++model anthropic/claude-opus-4-6\nDo something");
      expect(result.directives.model).toBe("anthropic/claude-opus-4-6");
      expect(result.stripped).toBe("Do something");
    });

    it("parses ++exec directive", () => {
      const result = parseDirectives("++exec deny\nRun command");
      expect(result.directives.exec).toBe("deny");
      expect(result.stripped).toBe("Run command");
    });

    it("parses multiple ++ directives", () => {
      const result = parseDirectives("++think high\n++model gpt-4o\nMessage");
      expect(result.directives.think).toBe("high");
      expect(result.directives.model).toBe("gpt-4o");
      expect(result.stripped).toBe("Message");
    });
  });

  describe("/ prefix syntax", () => {
    it("parses /think directive", () => {
      const result = parseDirectives("/think medium\nHello");
      expect(result.directives.think).toBe("medium");
      expect(result.stripped).toBe("Hello");
    });

    it("parses /model directive", () => {
      const result = parseDirectives("/model claude-opus-4-6\nTest");
      expect(result.directives.model).toBe("claude-opus-4-6");
      expect(result.stripped).toBe("Test");
    });

    it("parses /exec directive", () => {
      const result = parseDirectives("/exec interactive\nDo thing");
      expect(result.directives.exec).toBe("interactive");
      expect(result.stripped).toBe("Do thing");
    });

    it("parses /verbose directive", () => {
      const result = parseDirectives("/verbose on\nDebug this");
      expect(result.directives.verbose).toBe("on");
      expect(result.stripped).toBe("Debug this");
    });
  });

  describe("mixed syntax", () => {
    it("accepts both ++ and / in same message", () => {
      const result = parseDirectives("++think high\n/model gpt-4o\nMessage");
      expect(result.directives.think).toBe("high");
      expect(result.directives.model).toBe("gpt-4o");
      expect(result.stripped).toBe("Message");
    });
  });

  describe("body stripping", () => {
    it("strips single directive from body", () => {
      const result = parseDirectives("++think low\nHello world");
      expect(result.stripped).toBe("Hello world");
    });

    it("strips multiple directives from body", () => {
      const result = parseDirectives("++think high\n++model test\nWhat's up?");
      expect(result.stripped).toBe("What's up?");
    });

    it("preserves non-directive content", () => {
      const result = parseDirectives("Hello world, no directives here");
      expect(result.directives).toEqual({});
      expect(result.stripped).toBe("Hello world, no directives here");
    });

    it("handles empty body after stripping", () => {
      const result = parseDirectives("++think high");
      expect(result.directives.think).toBe("high");
      expect(result.stripped).toBe("");
    });

    it("does not match mid-line ++ or /", () => {
      const result = parseDirectives("Say ++think high in the middle");
      expect(result.directives).toEqual({});
      expect(result.stripped).toBe("Say ++think high in the middle");
    });
  });

  describe("directive values", () => {
    it("accepts all think levels", () => {
      for (const level of ["off", "low", "medium", "high"]) {
        const result = parseDirectives(`/think ${level}`);
        expect(result.directives.think).toBe(level);
      }
    });

    it("accepts all exec modes", () => {
      for (const mode of ["auto", "interactive", "deny"]) {
        const result = parseDirectives(`/exec ${mode}`);
        expect(result.directives.exec).toBe(mode);
      }
    });

    it("accepts verbose on/off", () => {
      expect(parseDirectives("/verbose on").directives.verbose).toBe("on");
      expect(parseDirectives("/verbose off").directives.verbose).toBe("off");
    });
  });
});
