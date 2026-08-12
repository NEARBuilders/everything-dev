import { spawn } from "node:child_process";
import { createServer } from "node:net";

const CHROME = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-133.0.6943.141/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

interface CDP {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  close(): void;
}

async function connect(wsUrl: string): Promise<CDP> {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", (e) => reject(e as unknown as Error));
  });
  let id = 0;
  const pending = new Map<number, { resolve: Function; reject: Function }>();
  socket.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return {
    send(method, params = {}) {
      const msgId = ++id;
      socket.send(JSON.stringify({ id: msgId, method, params }));
      return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 50; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(true));
      s.once("listening", () => s.close(() => resolve(false)));
      s.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  return start;
}

async function main() {
  const port = await findFreePort(9222);
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--disable-gpu",
    "--user-data-dir=/tmp/mf-override-chrome-" + Date.now(),
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const versionUrl = `http://localhost:${port}/json/version`;
    let version;
    for (let i = 0; i < 40; i++) {
      try { version = await (await fetch(versionUrl)).json(); break; }
      catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    if (!version) throw new Error("chrome debug port not ready");
    const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
    const page = targets.find((t: any) => t.type === "page");
    if (!page) throw new Error("no page target");
    const cdp = await connect(page.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    let failures = 0;
    const check = (cond: boolean, label: string) => {
      if (cond) console.log(`  ok    ${label}`);
      else { failures += 1; console.log(`  FAIL  ${label}`); }
    };

    const loadAndInspect = async (url: string) => {
      await cdp.send("Page.navigate", { url });
      for (let i = 0; i < 60; i++) {
        const res = await cdp.send("Runtime.evaluate", {
          expression: "window.__COMPOSE_RESULT__ ? 'ready' : 'waiting'",
          returnByValue: true,
        });
        if (res.result?.value === "ready") break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const text = await cdp.send("Runtime.evaluate", {
        expression: "document.body.innerText", returnByValue: true,
      });
      const compose = await cdp.send("Runtime.evaluate", {
        expression: "JSON.stringify(window.__COMPOSE_RESULT__ ?? null)", returnByValue: true,
      });
      return { text: String(text.result?.value ?? ""), compose: String(compose.result?.value ?? "") };
    };

    console.log("\n=== BASE CONFIG (?config=base) ===");
    const base = await loadAndInspect("http://localhost:3000/dashboard?config=base");
    check(base.text.includes("Dashboard (/dashboard) — BASE UI"), "dashboard renders BASE UI marker");
    check(!base.text.includes("TENANT UI"), "dashboard does NOT render tenant marker");
    check(base.text.includes("42 users"), "dashboard stats loaded via apiClient.dashboard.getStats()");
    check(base.compose.includes('"apiClientKeys":["dashboard"]'), "apiClient has dashboard namespace");
    console.log("compose result:", base.compose);

    console.log("\n=== TENANT CONFIG (?config=tenant) ===");
    const tenant = await loadAndInspect("http://localhost:3000/dashboard?config=tenant");
    check(tenant.text.includes("Custom Dashboard (/dashboard) — TENANT UI"), "dashboard renders TENANT UI marker");
    check(!tenant.text.includes("BASE UI"), "dashboard does NOT render base marker (override won)");
    check(tenant.text.includes("42 users"), "shared dashboard API stats still loaded");
    check(tenant.compose.includes('"apiClientKeys":["dashboard"]'), "apiClient has dashboard namespace");
    console.log("compose result:", tenant.compose);

    console.log("\n=== CROSS-PLUGIN ACCESS (UI-only landing reads dashboard API) ===");
    const home = await loadAndInspect("http://localhost:3000/?config=tenant");
    check(home.text.includes("Landing index (/)"), "landing renders (inherited unchanged in tenant)");
    check(home.text.includes("dashboard API reports 42 users"), "UI-only plugin calls apiClient.dashboard via injected context");

    console.log("\n=== TENANT-ONLY ROUTE (/dashboard/revenue) ===");
    await cdp.send("Page.navigate", { url: "http://localhost:3000/dashboard/revenue?config=tenant" });
    await new Promise((r) => setTimeout(r, 1200));
    const revenue = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText", returnByValue: true,
    });
    check(String(revenue.result?.value ?? "").includes("TENANT UI"), "tenant-only /dashboard/revenue renders");

    console.log("\n=== BASE UI on /dashboard/analytics (base-only route) ===");
    await cdp.send("Page.navigate", { url: "http://localhost:3000/dashboard/analytics?config=base" });
    await new Promise((r) => setTimeout(r, 1200));
    const analytics = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText", returnByValue: true,
    });
    check(String(analytics.result?.value ?? "").includes("Analytics (/dashboard/analytics) — BASE UI"), "base-only /dashboard/analytics renders");

    console.log(`\n=== FINAL: ${failures === 0 ? "PASS" : `${failures} FAILURES`} ===`);
    cdp.close();
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error("BROWSER TEST FAIL:", err);
  process.exit(1);
});
