const MAX_BYTES = 1_000_000_000; // 1 GB
const TIMEOUT_MS = 30_000;       // 30 s

async function fetchWithGuard(url, { maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const len = Number(res.headers.get("content-length"));
    if (len > 0 && len > maxBytes) throw new Error(`File too large: ${len} bytes (limit ${maxBytes})`);
    return res;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Fetch timed out after ${timeoutMs}ms: ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSafe(url, opts) {
  const maxBytes = opts?.maxBytes ?? MAX_BYTES;
  const res = await fetchWithGuard(url, opts);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error(`File too large: ${buf.byteLength} bytes (limit ${maxBytes})`);
  return buf;
}

export async function fetchSafeText(url, opts) {
  const maxBytes = opts?.maxBytes ?? MAX_BYTES;
  const res = await fetchWithGuard(url, opts);
  const text = await res.text();
  const byteLen = Buffer.byteLength(text, "utf8");
  if (byteLen > maxBytes) throw new Error(`Response too large: ${byteLen} bytes (limit ${maxBytes})`);
  return text;
}
