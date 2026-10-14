import { describe, expect, it } from "vitest";
import { createNonceNormalizer } from "../../src/services/nonce-normalizer";

const FRESH = "qehTtRVM+D6/jTou/bD+Jg==";
const STALE = "4L4T2PyVctOLDNONCE==";

async function normalize(chunks: Array<string | Uint8Array>): Promise<string> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  const response = new Response(stream.pipeThrough(createNonceNormalizer(FRESH)));
  return await response.text();
}

describe("createNonceNormalizer", () => {
  it("rewrites stale script nonces, the baked bootstrap nonce, and the meta", async () => {
    const html =
      `<meta property="csp-nonce" content="${STALE}"/>` +
      `<script nonce="${STALE}" src="/remoteEntry.js" integrity="sha384-x"></script>` +
      `<script nonce="${STALE}">window.__CSP_NONCE__="${STALE}";window.__RUNTIME_CONFIG__={};</script>`;
    const out = await normalize([html]);
    expect(out).not.toContain(STALE);
    expect(out.split(FRESH).length - 1).toBe(4);
  });

  it("rewrites a nonce value split across chunk boundaries", async () => {
    const first = `<script nonce="${STALE.slice(0, 6)}`;
    const second = `${STALE.slice(6)}" src="/remoteEntry.js"></script>`;
    const out = await normalize([first, second]);
    expect(out).toBe(`<script nonce="${FRESH}" src="/remoteEntry.js"></script>`);
  });

  it("holds back an unterminated script tag until its nonce completes", async () => {
    const out = await normalize([
      `<html><body><script async defer nonce="`,
      `${STALE}"`,
      `></script></body></html>`,
    ]);
    expect(out).toBe(`<html><body><script async defer nonce="${FRESH}"></script></body></html>`);
  });

  it("is idempotent on already-fresh output", async () => {
    const html =
      `<meta property="csp-nonce" content="${FRESH}"/>` +
      `<script nonce="${FRESH}">window.__CSP_NONCE__="${FRESH}";</script>`;
    expect(await normalize([html])).toBe(html);
  });

  it("does not rewrite escaped prose or attribute names", async () => {
    const html = '<p>use &lt;script nonce="abc"&gt; and the nonce="abc" docs text</p>';
    expect(await normalize([html])).toBe(html);
  });

  it("survives multi-byte characters split across chunks", async () => {
    const html = `<p>ok</p><script nonce="${STALE}">window.__CSP_NONCE__="${STALE}";</script>`;
    const bytes = new TextEncoder().encode(html);
    const split = 8;
    const out = await normalize([bytes.slice(0, split), bytes.slice(split)]);
    expect(out).toBe(`<p>ok</p><script nonce="${FRESH}">window.__CSP_NONCE__="${FRESH}";</script>`);
  });

  it("flushes a document with no trailing newline", async () => {
    const html = `<script nonce="${STALE}">window.__CSP_NONCE__="${STALE}";</script>`;
    expect(await normalize([html])).toBe(
      `<script nonce="${FRESH}">window.__CSP_NONCE__="${FRESH}";</script>`,
    );
  });
});
