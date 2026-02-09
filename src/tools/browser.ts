import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TinyClawConfig } from "../config/schema.js";
import { launchBrowser, getBrowserInstance } from "../browser.js";
import { defineTools } from "./helper.js";

export function createBrowserTools(config: TinyClawConfig): AgentTool<any>[] {
  return defineTools([
    {
      name: "browser_navigate",
      description: "Navigate the browser to a URL. Returns page title and URL.",
      parameters: { type: "object", properties: { url: { type: "string", description: "URL to navigate to" } }, required: ["url"] },
      async execute(args: { url: string }) {
        const browser = await launchBrowser(config);
        return JSON.stringify(await browser.navigate(args.url));
      },
    },
    {
      name: "browser_click",
      description: "Click an element on the page by CSS selector.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
      async execute(args: { selector: string }) {
        const browser = getBrowserInstance();
        if (!browser) return "No browser open. Use browser_navigate first.";
        await browser.click(args.selector);
        return "Clicked.";
      },
    },
    {
      name: "browser_type",
      description: "Type text into an input element.",
      parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] },
      async execute(args: { selector: string; text: string }) {
        const browser = getBrowserInstance();
        if (!browser) return "No browser open.";
        await browser.type(args.selector, args.text);
        return "Typed.";
      },
    },
    {
      name: "browser_screenshot",
      description: "Take a screenshot of the current page. Returns base64 image.",
      parameters: { type: "object", properties: { fullPage: { type: "boolean" } } },
      async execute(args: { fullPage?: boolean }) {
        const browser = getBrowserInstance();
        if (!browser) return "No browser open.";
        const buf = await browser.screenshot({ fullPage: args.fullPage });
        return `data:image/png;base64,${buf.toString("base64")}`;
      },
    },
    {
      name: "browser_snapshot",
      description: "Get an accessibility tree snapshot of the current page.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const browser = getBrowserInstance();
        if (!browser) return "No browser open.";
        return browser.snapshot();
      },
    },
  ]);
}
