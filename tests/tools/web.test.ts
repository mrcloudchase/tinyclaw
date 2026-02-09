import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

import { createWebSearchTool, createWebFetchTool } from "../../src/tools/web.js";

describe("createWebSearchTool", () => {
  const tool = createWebSearchTool() as any;

  it("has correct name and metadata", () => {
    expect(tool.name).toBe("web_search");
    expect(tool.parameters.required).toContain("query");
  });

  it("returns error when BRAVE_API_KEY not set", async () => {
    vi.stubEnv("BRAVE_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    const result = await tool.execute("call1", { query: "test" });
    expect(result.content[0].text).toContain("BRAVE_API_KEY");
    vi.unstubAllEnvs();
  });

  it("calls Brave API with correct params", async () => {
    vi.stubEnv("BRAVE_API_KEY", "test-key");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Result 1", url: "https://example.com", description: "A result" },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await tool.execute("call2", { query: "test query", count: 3 });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Subscription-Token": "test-key" }),
      }),
    );
    expect(result.content[0].text).toContain("Result 1");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("handles API error", async () => {
    vi.stubEnv("BRAVE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" }));

    const result = await tool.execute("call3", { query: "test" });
    expect(result.content[0].text).toContain("500");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("caps count at 20", async () => {
    vi.stubEnv("BRAVE_API_KEY", "test-key");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await tool.execute("call4", { query: "test", count: 100 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("count=20");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("createWebFetchTool", () => {
  const tool = createWebFetchTool() as any;

  it("has correct name and metadata", () => {
    expect(tool.name).toBe("web_fetch");
    expect(tool.parameters.required).toContain("url");
  });

  it("fetches and returns plain text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => "Hello World",
    }));

    const result = await tool.execute("call1", { url: "https://example.com/text" });
    expect(result.content[0].text).toBe("Hello World");

    vi.unstubAllGlobals();
  });

  it("strips HTML content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html><body><script>evil()</script><p>Hello &amp; World</p></body></html>",
    }));

    const result = await tool.execute("call2", { url: "https://example.com" });
    expect(result.content[0].text).toContain("Hello & World");
    expect(result.content[0].text).not.toContain("<script>");
    expect(result.content[0].text).not.toContain("evil()");

    vi.unstubAllGlobals();
  });

  it("truncates to maxLength", async () => {
    const longText = "a".repeat(20000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      text: async () => longText,
    }));

    const result = await tool.execute("call3", { url: "https://example.com", maxLength: 100 });
    expect(result.content[0].text.length).toBeLessThanOrEqual(100);

    vi.unstubAllGlobals();
  });

  it("handles fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));

    const result = await tool.execute("call4", { url: "https://example.com/404" });
    expect(result.content[0].text).toContain("404");

    vi.unstubAllGlobals();
  });

  it("handles network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await tool.execute("call5", { url: "https://example.com" });
    expect(result.content[0].text).toContain("ECONNREFUSED");

    vi.unstubAllGlobals();
  });
});
