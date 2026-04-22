import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractExeContent } from "../extractors/exe.js";

const URLS = {
  exe: "https://failai.viespirkiai.org/558049",
};

// ---------------------------------------------------------------------------
// Shared shape assertions
// ---------------------------------------------------------------------------

function assertShape(result) {
  assert.ok(Array.isArray(result.pages));
  const m = result.metadata;
  assert.ok(m);
  assert.equal(typeof m.arch, "string");
  assert.equal(typeof m.type, "string");
  assert.ok(Array.isArray(m.sections));
  assert.ok(Array.isArray(m.imports));
  assert.equal(typeof m.signed, "boolean");
  assert.ok(m.security);
  // parsed fields always present
  assert.ok(Array.isArray(m.companyIds));
  assert.ok(Array.isArray(m.ibans));
  assert.ok(Array.isArray(m.phones));
  assert.ok(Array.isArray(m.links));
  assert.ok(Array.isArray(m.emails));
  assert.ok(Array.isArray(m.ipAddresses));
  assert.ok(Array.isArray(m.macAddresses));
}

// ---------------------------------------------------------------------------
// IEXPLORE.EXE (x86, Windows GUI, signed)
// ---------------------------------------------------------------------------

describe("extractExeContent — iexplore.exe", () => {
  it("returns the expected result shape", async () => {
    assertShape(await extractExeContent(URLS.exe));
  });

  it("has correct PE header fields", async () => {
    const { metadata: m } = await extractExeContent(URLS.exe);
    assert.equal(m.arch,      "x86");
    assert.equal(m.type,      "exe");
    assert.equal(m.subsystem, "Windows GUI");
    assert.equal(m.compiledAt, "2024-05-07T00:22:37.000Z");
  });

  it("has correct section names", async () => {
    const { metadata: m } = await extractExeContent(URLS.exe);
    assert.deepEqual(m.sections, [".text", ".data", ".idata", ".didat", ".rsrc", ".reloc"]);
  });

  it("has correct imports", async () => {
    const { metadata: m } = await extractExeContent(URLS.exe);
    assert.ok(m.imports.includes("KERNEL32.dll"));
    assert.ok(m.imports.includes("USER32.dll"));
    assert.ok(m.imports.includes("ADVAPI32.dll"));
    assert.equal(m.imports.length, 8);
  });

  it("is signed", async () => {
    const { metadata: m } = await extractExeContent(URLS.exe);
    assert.equal(m.signed, true);
  });

  it("has correct security flags", async () => {
    const { metadata: m } = await extractExeContent(URLS.exe);
    assert.equal(m.security.aslr,                true);
    assert.equal(m.security.highEntropyAslr,     false);
    assert.equal(m.security.dep,                 false);
    assert.equal(m.security.noSeh,               false);
    assert.equal(m.security.cfg,                 true);
    assert.equal(m.security.terminalServerAware, true);
  });

  it("has correct version info", async () => {
    const { metadata: m } = await extractExeContent(URLS.exe);
    assert.ok(m.version !== null);
    assert.equal(m.version.fileVersion,     "11.0.17134.1");
    assert.equal(m.version.productVersion,  "11.0.17134.1");
    assert.equal(m.version.companyName,     "Microsoft Corporation");
    assert.equal(m.version.productName,     "Internet Explorer");
    assert.equal(m.version.fileDescription, "Internet Explorer");
    assert.equal(m.version.originalFilename, "IEXPLORE.EXE");
    assert.equal(m.version.internalName,    "iexplore");
    assert.ok(m.version.legalCopyright.includes("Microsoft Corporation"));
  });
});
