import { spawn } from "child_process";
import pLimit from "p-limit";
import treeKill from "tree-kill";
import { log } from "./log.js";

const UNO_PORT     = parseInt(process.env.UNOSERVER_PORT ?? "2004", 10);
const CONV_TIMEOUT = parseInt(process.env.LIBREOFFICE_TIMEOUT ?? "15", 10) * 1000;
const UNO_URL      = `http://127.0.0.1:${UNO_PORT}/`;

// Serialize LibreOffice conversions — unoserver spawns one LO process per
// concurrent request, so running more than one at a time pegs the CPU.
const MAX_CONCURRENT_LO = parseInt(process.env.MAX_CONCURRENT_LIBREOFFICE ?? "1", 10);
const loLimit = pLimit(MAX_CONCURRENT_LO);

let proc         = null;
let restartPromise  = null;
let startupPromise  = null;
let binaryMissing   = false;

function spawnUnoserver(onSpawnError) {
  const p = spawn("unoserver", ["--interface", "127.0.0.1", "--port", String(UNO_PORT)], {
    stdio: "ignore",
  });

  p.on("error", (err) => {
    proc = null;
    if (err.code === "ENOENT") binaryMissing = true;
    onSpawnError?.(err);
  });

  p.on("spawn", () => {
    log(`unoserver paleistas (pid ${p.pid})`);
    p.unref();
    onSpawnError = null;
  });

  p.on("exit", (code, signal) => {
    proc = null;
    if (binaryMissing) return;
    if (!restartPromise) {
      log(`unoserver baigėsi (${signal ?? code}), paleidžiama iš naujo...`);
      restartPromise = doRestart().finally(() => { restartPromise = null; });
    }
  });

  proc = p;
}

async function doRestart() {
  if (proc) {
    const pid = proc.pid;
    proc = null;
    await new Promise(r => treeKill(pid, "SIGKILL", r));
  }
  await new Promise(r => setTimeout(r, 2000));
  await new Promise((resolve, reject) => {
    spawnUnoserver(reject);
    waitReady().then(resolve).catch(reject);
  });
}

async function waitReady(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if (binaryMissing) throw new Error("unoserver binary not found");
    await new Promise(r => setTimeout(r, 1000));
    try {
      await fetch(UNO_URL, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {}
  }
  throw new Error("unoserver nepasiekiamas po paleidimo");
}

function ensureStarted() {
  if (!startupPromise) {
    startupPromise = new Promise((resolve, reject) => {
      spawnUnoserver(reject);
      waitReady().then(() => { log("unoserver paruoštas"); resolve(); }).catch(reject);
    });
  }
  return startupPromise;
}

export function convertToPdf(inputPath, outputPath) {
  return loLimit(() => _convertToPdf(inputPath, outputPath));
}

async function _convertToPdf(inputPath, outputPath) {
  await ensureStarted();

  if (restartPromise) {
    log("unoserver startuoja, laukiama...");
    await restartPromise;
  }

  // API: convert(inpath, indata, outpath, convert_to, filtername, filter_options, update_index, infiltername)
  const xmlBody = `<?xml version="1.0"?><methodCall><methodName>convert</methodName><params>`
    + `<param><value><string>${inputPath}</string></value></param>`
    + `<param><value><nil/></value></param>`
    + `<param><value><string>${outputPath}</string></value></param>`
    + `<param><value><nil/></value></param>`
    + `<param><value><nil/></value></param>`
    + `<param><value><array><data></data></array></value></param>`
    + `<param><value><boolean>1</boolean></value></param>`
    + `<param><value><nil/></value></param>`
    + `</params></methodCall>`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    log(`unoserver timeout po ${CONV_TIMEOUT / 1000}s, paleidžiama iš naujo...`);
    if (!restartPromise) {
      restartPromise = doRestart().finally(() => { restartPromise = null; });
    }
  }, CONV_TIMEOUT);

  try {
    const response = await fetch(UNO_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xmlBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`unoserver klaida: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    if (xml.includes("<fault>")) {
      const fault = xml.match(/<string>([\s\S]*?)<\/string>/)?.[1] ?? xml;
      log("unoserver grąžino klaidą, paleidžiama iš naujo...");
      if (!restartPromise) {
        restartPromise = doRestart().finally(() => { restartPromise = null; });
      }
      throw new Error(`unoserver klaida: ${fault.trim()}`);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`unoserver timeout po ${CONV_TIMEOUT / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
