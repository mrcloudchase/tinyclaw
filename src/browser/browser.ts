// Browser System — Chrome + CDP + operations + element refs
// All in ONE file

import type { TinyClawConfig } from "../config/schema.js";
import { log } from "../utils/logger.js";

// ══════════════════════════════════════════════
// ── Types ──
// ══════════════════════════════════════════════

export interface BrowserInstance {
  navigate(url: string): Promise<{ title: string; url: string }>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  snapshot(): Promise<string>;
  evaluate(code: string): Promise<unknown>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
}

interface ElementRef {
  selector: string;
  tag: string;
  text?: string;
  role?: string;
  ref: number;
}

let browserInstance: BrowserInstance | null = null;
let elementRefs: ElementRef[] = [];
let refCounter = 0;

// ══════════════════════════════════════════════
// ── Browser Launch ──
// ══════════════════════════════════════════════

export async function launchBrowser(config: TinyClawConfig): Promise<BrowserInstance> {
  if (browserInstance?.isOpen()) return browserInstance;

  const browserConfig = config.browser;

  // Try remote CDP first
  if (browserConfig?.cdpUrl) {
    return connectCdp(browserConfig.cdpUrl, config);
  }

  // Launch via playwright-core
  try {
    const pw = require("playwright-core");
    const opts: any = {
      headless: browserConfig?.headless ?? true,
      args: browserConfig?.noSandbox ? ["--no-sandbox"] : [],
    };
    if (browserConfig?.executablePath) opts.executablePath = browserConfig.executablePath;

    const browser = await pw.chromium.launch(opts);
    const context = await browser.newContext();
    const page = await context.newPage();

    browserInstance = createPlaywrightBrowser(page, browser, config);
    log.info("Browser launched via playwright-core");
    return browserInstance;
  } catch (err) {
    log.warn(`playwright-core not available: ${err}`);
    throw new Error("Browser requires playwright-core. Install with: npm install playwright-core");
  }
}

async function connectCdp(url: string, config: TinyClawConfig): Promise<BrowserInstance> {
  const pw = require("playwright-core");
  const browser = await pw.chromium.connectOverCDP(url);
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  browserInstance = createPlaywrightBrowser(page, browser, config);
  log.info(`Connected to browser via CDP: ${url}`);
  return browserInstance;
}

function createPlaywrightBrowser(page: any, browser: any, config: TinyClawConfig): BrowserInstance {
  let open = true;

  return {
    async navigate(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return { title: await page.title(), url: page.url() };
    },
    async click(selector) { await page.click(selector, { timeout: 5000 }); },
    async type(selector, text) { await page.fill(selector, text, { timeout: 5000 }); },
    async screenshot(opts) { return page.screenshot({ fullPage: opts?.fullPage ?? false }); },
    async snapshot() {
      // Build simplified accessibility tree
      const tree = await page.accessibility.snapshot();
      elementRefs = [];
      refCounter = 0;
      const result = formatAccessibilityTree(tree);
      return result;
    },
    async evaluate(code) {
      if (config.browser?.evaluateEnabled === false) throw new Error("JS evaluation is disabled");
      return page.evaluate(code);
    },
    async goBack() { await page.goBack(); },
    async goForward() { await page.goForward(); },
    async reload() { await page.reload(); },
    async close() { open = false; await browser.close(); browserInstance = null; },
    isOpen() { return open; },
  };
}

function formatAccessibilityTree(node: any, depth = 0): string {
  if (!node) return "[empty page]";
  const indent = "  ".repeat(depth);
  const ref = ++refCounter;
  let line = `${indent}[${ref}] ${node.role || "element"}`;
  if (node.name) line += `: "${node.name}"`;
  if (node.value) line += ` value="${node.value}"`;

  elementRefs.push({
    selector: `[data-ref="${ref}"]`,
    tag: node.role || "element",
    text: node.name,
    role: node.role,
    ref,
  });

  const lines = [line];
  if (node.children) {
    for (const child of node.children) {
      lines.push(formatAccessibilityTree(child, depth + 1));
    }
  }
  return lines.join("\n");
}

export function getBrowserInstance(): BrowserInstance | null { return browserInstance; }
export function getElementRefs(): ElementRef[] { return elementRefs; }

export async function closeBrowser(): Promise<void> {
  if (browserInstance) { await browserInstance.close(); browserInstance = null; }
}
