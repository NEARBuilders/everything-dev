import { afterEach, describe, expect, it, vi } from "vitest";
import { type DockerAdapter, type DockerResult, runSmoke } from "../../src/services/deploy/smoke";

const ok = (stdout = "", stderr = ""): DockerResult => ({ status: 0, stdout, stderr });
const fail = (stderr = "", status = 1): DockerResult => ({ status, stdout: "", stderr });

/** Dispatches on the docker verb; tests override per verb. */
const fakeDocker =
  (perVerb: Partial<Record<string, DockerResult>> = {}): DockerAdapter =>
  (args) => {
    const verb = args[0] ?? "";
    return (
      perVerb[verb] ??
      {
        inspect: ok("true\n"),
        logs: ok(),
        exec: ok(),
        run: ok(),
        cp: fail("no staged logs"),
        stop: ok(),
        rm: ok(),
        image: ok("104857600\n"),
      }[verb] ??
      ok()
    );
  };

/** Refused-connection fetch: the smoke's HTTP pollers all fail fast. */
const refusedFetch = async (): Promise<Response> => {
  throw new TypeError("fetch failed");
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runSmoke — boot gate decisions through the docker seam", () => {
  it("a docker run failure returns the gate red without booting anything", async () => {
    const result = await runSmoke({
      image: "test-image",
      docker: fakeDocker({ run: fail("port already allocated") }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("docker run failed");
    expect(result.error).toContain("port already allocated");
  });

  it("an exited boot fails the gate in seconds and classifies an app-class diagnosis", async () => {
    vi.stubGlobal("fetch", refusedFetch);
    const probeLines = [
      "probe https://cdn.test/bundles/a/g/host/mf-manifest.json -> 200 3614B",
      "probe https://cdn.test/bundles/a/g/host/static/js/v.js -> 200 40475B",
    ].join("\n");
    const result = await runSmoke({
      image: "test-image",
      docker: fakeDocker({
        inspect: ok("false\n"),
        exec: ok(probeLines),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boot container exited");
    expect(result.diagnosis).toContain("CDN reachable from inside the container");
    expect(result.diagnosis).toContain("app-class");
  });

  it("an exited container fails the gate fast and classifies a network-class diagnosis", async () => {
    vi.stubGlobal("fetch", refusedFetch);
    const probeLines =
      "probe https://cdn.test/bundles/a/g/host/mf-manifest.json -> FETCH_FAILED TypeError: fetch failed";
    const result = await runSmoke({
      image: "test-image",
      docker: fakeDocker({
        inspect: ok("false\n"),
        exec: ok(probeLines),
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boot container exited");
    expect(result.diagnosis).toContain("CDN unreachable from inside the container");
  });

  it("a green boot passes every surface and self-describes the platform version", async () => {
    const html = "<html><body>rendered</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const href = typeof url === "string" ? url : url.href;
        if (href.endsWith("/health")) {
          return new Response(JSON.stringify({ snapshot: { booted: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (href.endsWith("/api/spec.json")) {
          return new Response(JSON.stringify({ openapi: "3.0.0", paths: { "/ping": {} } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }),
    );
    const result = await runSmoke({
      image: "test-image",
      docker: (args) => {
        if (args[0] === "exec" && args[4] === "mf") return ok("mf-compat: ✓ compatible\nlast line");
        if (args[0] === "exec" && args[4] === "verify")
          return ok("verify: ✓ pins resolve\nchain ok");
        if (args[0] === "exec" && args[3] === "-e") return ok("9.9.9\n");
        return fakeDocker()(args);
      },
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("platform: 9.9.9");
    expect(result.summary).toContain("mf compat:");
    expect(result.summary).toContain("chain:");
  });
});
