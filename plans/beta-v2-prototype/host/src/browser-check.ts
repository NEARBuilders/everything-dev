import { spawn } from "node:child_process";

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

async function main() {
  const port = 9222 + Math.floor(Math.random() * 1000);
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--disable-gpu",
    "--user-data-dir=/tmp/mf-chrome-profile-" + Date.now(),
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const versionUrl = `http://localhost:${port}/json/version`;
    let version;
    for (let i = 0; i < 40; i++) {
      try {
        version = await (await fetch(versionUrl)).json();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!version) throw new Error("chrome debug port not ready");
    const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
    const page = targets.find((t: any) => t.type === "page");
    if (!page) throw new Error("no page target");
    const cdp = await connect(page.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    // capture console output across all page loads
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__LOG__ = [];
        for (const [k, orig] of Object.entries({info: console.info, warn: console.warn, error: console.error, log: console.log})) {
          console[k] = (...a) => { window.__LOG__.push(k + ": " + a.map(String).join(" ")); orig(...a); };
        }
      `,
    });

    const url = process.argv[2] ?? "http://localhost:3000/";
    await cdp.send("Page.navigate", { url });
    // wait for load
    for (let i = 0; i < 60; i++) {
      const state = await cdp.send("Page.getNavigationHistory");
      const entry = (state.entries ?? [])[(state.currentIndex as number) ?? 0];
      if (entry && (entry.transitionType === "reload" || entry.transitionType === "typed")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 4000));

    const evalBody = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
      awaitPromise: true,
    });
    const composeResult = await cdp.send("Runtime.evaluate", {
      expression: "JSON.stringify(window.__COMPOSE_RESULT__ ?? null)",
      returnByValue: true,
      awaitPromise: true,
    });
    const consoleLogs = await cdp.send("Runtime.evaluate", {
      expression: "window.__LOG__ ?? 'no __LOG__'",
      returnByValue: true,
    });

    // probe shared scope identity: exactly ONE host federation instance is
    // required (a second one created via createInstance() silently drops the
    // shared singletons and breaks remote hook calls). This is the regression
    // guard for the React-deduplication fix.
    const probe = await cdp.send("Runtime.evaluate", {
      expression: `
        (() => {
          const out = { hostInstances: 0, instances: [] };
          try {
            const fed = window.__FEDERATION__;
            for (const inst of fed.__INSTANCES__ ?? []) {
              out.instances.push(inst.options.id);
              if (String(inst.options.id).startsWith('host')) out.hostInstances += 1;
            }
          } catch (e) { out.err = String(e); }
          return JSON.stringify(out);
        })()
      `,
      returnByValue: true,
    });
    console.log("\n=== federation instance probe ===");
    console.log(probe.result?.value ?? "<none>");

    console.log("=== page text ===");
    console.log(evalBody.result?.value ?? "<empty>");
    console.log("\n=== __COMPOSE_RESULT__ ===");
    console.log(composeResult.result?.value ?? "<none>");
    console.log("\n=== console tail ===");
    console.log(consoleLogs.result?.value ?? "<none>");

    console.log("\n=== BROWSER TEST DONE ===");

    // Navigate through every route across remotes and confirm rendered chrome
    const routes = [
      ["/", "Landing index"],
      ["/about", "About (/about)"],
      ["/dashboard", "Dashboard (/dashboard)"],
      ["/dashboard/analytics", "Analytics (/dashboard/analytics)"],
      ["/settings", "Settings (/settings)"],
      ["/settings/profile", "Profile (/settings/profile)"],
      ["/admin/users", "Admin Users (/admin/users)"],
      ["/blog", "File-based blog index (/blog)"],
      ["/blog/hello-world", "Blog post: hello-world"],
      ["/account", "Account (/account)"],
    ] as const;
    let failures = 0;
    console.log("\n=== cross-remote route navigation ===");
    for (const [url, expected] of routes) {
      // plain anchor navigation; host server serves SPA fallback
      await cdp.send("Page.navigate", { url: "http://localhost:3000" + url });
      await new Promise((r) => setTimeout(r, 1200));
      const body = await cdp.send("Runtime.evaluate", {
        expression: "document.body.innerText",
        returnByValue: true,
      });
      const text = String(body.result?.value ?? "");
      const ok = text.includes(expected) && text.includes("HOST · MOUNT POINT:");
      if (!ok) failures += 1;
      const mount = text.match(/HOST · MOUNT POINT: (\w+)/)?.[1] ?? "?";
      console.log(
        `  ${ok ? "ok" : "FAIL"}  ${url.padEnd(22)} [${mount}] contains "${expected}"`,
      );
    }
    console.log(`\n=== NAVIGATION: ${failures === 0 ? `PASS — ${routes.length}/${routes.length} cross-remote routes render` : `${failures} FAILURES`} ===`);

    // SPA navigation: click an <a> and confirm the router handles it without reload
    console.log("\n=== SPA client-side navigation (no reload) ===");
    try {
      await cdp.send("Page.navigate", { url: "http://localhost:3000/" });
      await new Promise((r) => setTimeout(r, 1200));
      await cdp.send("Runtime.evaluate", {
        expression: `
          window.__NAV_COUNT__ = 0;
          window.addEventListener('beforeunload', () => { window.__NAV_COUNT__++; });
        `,
      });
      // click the Settings link in host nav
      await cdp.send("Runtime.evaluate", {
        expression: `
          (() => {
            const links = Array.from(document.querySelectorAll('a'));
            const settings = links.find(a => a.textContent === 'Settings');
            if (!settings) return 'no settings link';
            settings.click();
            return 'clicked settings';
          })()
        `,
        returnByValue: true,
      });
      await new Promise((r) => setTimeout(r, 800));
      const spa = await cdp.send("Runtime.evaluate", {
        expression: "({ text: document.body.innerText.includes('Settings (/settings)'), navCount: window.__NAV_COUNT__ })",
        returnByValue: true,
      });
      const ok = spa.result?.value?.text === true && spa.result?.value?.navCount === 0;
      console.log(`  ${ok ? "ok" : "FAIL"}  SPA nav to /settings, reloads=${spa.result?.value?.navCount ?? "?"}`);
      if (!ok) failures += 1;
    } catch (err) {
      failures += 1;
      console.log("  FAIL SPA nav:", (err as Error).message);
    }

    console.log(`\n=== FINAL: ${failures === 0 ? "PASS" : `${failures} FAILURES`} ===`);
    cdp.close();
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error("TEST FAIL:", err);
  process.exit(1);
});