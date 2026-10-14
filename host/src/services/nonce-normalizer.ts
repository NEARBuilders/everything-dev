/**
 * Per-request nonce liveness for the served SSR stream: the react-dom
 * server renderer can carry a previous render's head across module
 * generations (shared-singleton react-dom survives a composition swap), so
 * the streamed HTML can embed stale script nonces and a stale baked
 * `window.__CSP_NONCE__` while the response's CSP header carries the fresh
 * per-request nonce. The browser then blocks every script (header nonce and
 * body nonce disagree) — hydration never runs, `window.__RUNTIME_CONFIG__`
 * never lands. This stream transform rewrites every nonce the response body
 * carries to the request's own nonce, making the served document
 * self-consistent regardless of what the renderer reused.
 *
 * Idempotent on healthy renders (fresh nonce in, same nonce out). Patterns
 * are tight: script-tag `nonce` attributes, the baked
 * `window.__CSP_NONCE__` assignment, and the `csp-nonce` meta — never
 * prose. Streaming-safe: nothing is emitted while a tag or a pattern
 * prefix is still unterminated, so a value split across chunks is
 * rewritten once complete.
 */

const BOOTSTRAP_PREFIX = 'window.__CSP_NONCE__="';

function buildRewrite(freshNonce: string): (text: string) => string {
  const safe = freshNonce.replaceAll("$", "$$$$");
  const patterns = [
    /(<script\b[^>]*\snonce=")[^"]*(")/g,
    /(window\.__CSP_NONCE__=")[^"]*(")/g,
    /(<meta\b[^>]*property="csp-nonce"[^>]*content=")[^"]*(")/g,
  ];
  return (text) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, `$1${safe}$2`);
    }
    return text;
  };
}

/** Last position whose suffix could still complete a pattern — everything
 * from there stays buffered until the next chunk (or flush). An unterminated
 * tag holds back from its `<`; an unterminated bootstrap assignment holds
 * back from its (partial) prefix. */
function holdBackFrom(text: string): number {
  let cut = text.length;
  const lastOpen = text.lastIndexOf("<");
  if (lastOpen !== -1 && !text.slice(lastOpen).includes(">")) cut = Math.min(cut, lastOpen);
  for (let len = Math.min(BOOTSTRAP_PREFIX.length - 1, text.length); len > 0; len -= 1) {
    if (text.endsWith(BOOTSTRAP_PREFIX.slice(0, len))) {
      cut = Math.min(cut, text.length - len);
      break;
    }
  }
  const complete = text.lastIndexOf(BOOTSTRAP_PREFIX);
  if (complete !== -1) cut = Math.min(cut, complete);
  return cut;
}

export function createNonceNormalizer(freshNonce: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const rewrite = buildRewrite(freshNonce);
  let pending = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const cut = holdBackFrom(pending);
      if (cut <= 0) return;
      controller.enqueue(encoder.encode(rewrite(pending.slice(0, cut))));
      pending = pending.slice(cut);
    },
    flush(controller) {
      const rest = decoder.decode() + pending;
      pending = "";
      if (rest.length > 0) controller.enqueue(encoder.encode(rewrite(rest)));
    },
  });
}
