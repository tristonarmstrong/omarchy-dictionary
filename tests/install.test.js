#!/usr/bin/env node
"use strict";

// Tests for the manual-install mechanism in BarWidget.qml (triggered by the
// panel footer's Install button via installHotkeyScript()).
//
// The QML widget copies the lookup script from the plugin's scripts/
// directory to ~/.local/bin/ in three shell-free Process stages with paths
// passed as argv (never interpolated into an `sh -c` string, so quoting can
// never break):
//
//   1. mkdir -p ~/.local/bin        (the dir is not assumed to exist on a
//                                     fresh install)
//   2. cmp -s <src> <dst>           (exit 0 = identical, stay silent)
//   3. install -m755 <src> <dst>    (only when cmp reported differ/missing)
//
// This suite exercises the two key pieces:
//
//   1. decodeURIComponent on the Qt.resolvedUrl path — Util.fileUrl
//      encodes every path segment, so the resolved URL can contain %20
//      or other percent-encoding that breaks cmp/install if not decoded.
//
//   2. The staged install itself — it must correctly detect when
//      the destination is missing or stale, copy the source, and stay
//      silent when the destination already matches.
//
// Run:  node tests/install.test.js

var assert = require("assert");
var path   = require("path");
var fs     = require("fs");
var os     = require("os");
var { execFileSync } = require("child_process");

// ── Minimal test harness ───────────────────────────────────────────────────
var _group = "";
var _pass  = 0;
var _fail  = 0;

function group(name) { _group = name; console.log("\n" + name); }
function test(name, fn) {
  try { fn(); _pass++; console.log("  \u2713 " + name); }
  catch(e) { _fail++; console.log("  \u2717 " + name); console.log("    " + e.message); }
}

// ── Path decode logic ──────────────────────────────────────────────────────
// Mirrors the QML fix:
//   var url = String(Qt.resolvedUrl("scripts/omarchy-dictionary-lookup"))
//   var raw = url.replace(/^file:\/\//, "/")
//   try { return decodeURIComponent(raw) } catch (e) { return raw }

function decodeFilePath(url) {
  var raw = url.replace(/^file:\/\//, "/");
  try { return decodeURIComponent(raw); } catch (e) { return raw; }
}

group("decodeFilePath — normal paths (no encoding)");

test("plain ASCII path passes through unchanged", () => {
  var url = "file:///home/user/.config/omarchy/plugins/tristonarmstrong.dictionary/scripts/omarchy-dictionary-lookup";
  var result = decodeFilePath(url);
  // file:/// becomes // after stripping file:// — double leading slash is
  // harmless on Linux (POSIX says implementation-defined, glibc treats it
  // the same as /).
  assert.ok(result.indexOf("%") === -1, "should not contain percent signs");
  assert.ok(result.indexOf("/home/user") !== -1, "should preserve path");
});

test("path with dots and hyphens is unaffected", () => {
  var url = "file:///home/user/.config/omarchy/plugins/tristonarmstrong.dictionary/scripts/omarchy-dictionary-lookup";
  var result = decodeFilePath(url);
  assert.ok(result.indexOf("tristonarmstrong.dictionary") !== -1);
  assert.ok(result.indexOf("omarchy-dictionary-lookup") !== -1);
});

group("decodeFilePath — percent-encoded paths");

test("decodes space in username", () => {
  var url = "file:///home/my%20user/.config/omarchy/plugins/test/scripts/lookup";
  var result = decodeFilePath(url);
  assert.ok(result.indexOf("%") === -1, "should not contain percent signs");
  assert.ok(result.indexOf("my user") !== -1, "should decode %20 to space");
});

test("decodes space in directory name", () => {
  var url = "file:///home/user/.config/my%20plugins/test/scripts/lookup";
  var result = decodeFilePath(url);
  assert.ok(result.indexOf("%") === -1);
  assert.ok(result.indexOf("my plugins") !== -1);
});

test("decodes multiple encoded segments", () => {
  var url = "file:///home/my%20user/.config/my%20plugins/test/scripts/lookup";
  var result = decodeFilePath(url);
  assert.ok(result.indexOf("%") === -1);
  assert.ok(result.indexOf("my user") !== -1);
  assert.ok(result.indexOf("my plugins") !== -1);
});

test("decodes unicode percent sequences (café)", () => {
  var url = "file:///home/user/caf%C3%A9/.config/omarchy/plugins/test/scripts/lookup";
  var result = decodeFilePath(url);
  assert.ok(result.indexOf("caf\u00e9") !== -1, "should decode to café");
});

test("leaves plus signs as-is (not spaces)", () => {
  var url = "file:///home/user/name+age/.config/omarchy/plugins/test/scripts/lookup";
  var result = decodeFilePath(url);
  assert.ok(result.indexOf("name+age") !== -1, "plus signs preserved");
});

group("decodeFilePath — fallback on malformed input");

test("returns raw path if decodeURIComponent throws", () => {
  var url = "file:///home/user/%ZZbad/.config/omarchy/plugins/test/scripts/lookup";
  var result = decodeFilePath(url);
  // Should return the raw path (with %ZZ intact) rather than crashing
  assert.ok(result.indexOf("%ZZbad") !== -1, "should keep the malformed percent sequence");
});

// ── Staged install logic ───────────────────────────────────────────────────
// Mirrors the QML stages in BarWidget.qml (mkdirProc → cmpProc → installProc),
// with paths passed as argv just like the QML `command` lists — no shell, no
// quoting. Returns "installed" when install(1) ran, "" when the destination
// already matched (silent) or the install failed.

var SRC = path.join(__dirname, "..", "scripts", "omarchy-dictionary-lookup");

function runInstall(src, dst) {
  try {
    execFileSync("mkdir", ["-p", path.dirname(dst)]);
  } catch (e) {
    return "";
  }
  var same = false;
  try {
    execFileSync("cmp", ["-s", src, dst]);
    same = true;
  } catch (e) {
    same = false;
  }
  if (same) return "";
  try {
    execFileSync("install", ["-m755", src, dst]);
    return "installed";
  } catch (e) {
    return "";
  }
}

group("install command — fresh install");

test("installs script when destination does not exist", () => {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dict-install-"));
  var dst = path.join(tmpDir, "omarchy-dictionary-lookup");
  try {
    var result = runInstall(SRC, dst);
    assert.strictEqual(result, "installed");
    assert.ok(fs.existsSync(dst), "destination should exist");
    var mode = fs.statSync(dst).mode;
    assert.ok((mode & 0o111) !== 0, "should be executable");
    assert.strictEqual(
      fs.readFileSync(dst, "utf8"),
      fs.readFileSync(SRC, "utf8"),
      "contents should match source"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

group("install command — idempotent (skip when identical)");

test("skips install when destination already matches source", () => {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dict-install-"));
  var dst = path.join(tmpDir, "omarchy-dictionary-lookup");
  try {
    runInstall(SRC, dst);
    var result = runInstall(SRC, dst);
    assert.strictEqual(result, "", "should not echo 'installed' when files match");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

group("install command — re-install when stale");

test("re-installs when destination differs from source", () => {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dict-install-"));
  var dst = path.join(tmpDir, "omarchy-dictionary-lookup");
  try {
    runInstall(SRC, dst);
    fs.writeFileSync(dst, "# stale\n");
    var result = runInstall(SRC, dst);
    assert.strictEqual(result, "installed");
    assert.strictEqual(
      fs.readFileSync(dst, "utf8"),
      fs.readFileSync(SRC, "utf8"),
      "contents should match source after re-install"
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

group("install command — source does not exist");

test("does not install when source file is missing", () => {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dict-install-"));
  var dst = path.join(tmpDir, "omarchy-dictionary-lookup");
  try {
    var result = runInstall("/nonexistent/path/omarchy-dictionary-lookup", dst);
    assert.ok(result.indexOf("installed") === -1, "should not echo 'installed'");
    assert.ok(!fs.existsSync(dst), "destination should not exist");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

group("install command — destination directory creation");

test("creates nested directory if it does not exist", () => {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dict-install-"));
  var dst = path.join(tmpDir, "sub", "dir", "omarchy-dictionary-lookup");
  try {
    var result = runInstall(SRC, dst);
    assert.strictEqual(result, "installed");
    assert.ok(fs.existsSync(dst), "destination should exist in created directory");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

group("install command — permissions");

test("installed script has 755 permissions", () => {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dict-install-"));
  var dst = path.join(tmpDir, "omarchy-dictionary-lookup");
  try {
    runInstall(SRC, dst);
    var stat = fs.statSync(dst);
    // Check owner execute bit (0o100)
    assert.ok((stat.mode & 0o100) !== 0, "owner should have execute");
    assert.ok((stat.mode & 0o200) !== 0, "owner should have write");
    assert.ok((stat.mode & 0o400) !== 0, "owner should have read");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n" + (_pass + _fail) + " total, " + _pass + " passed, " + _fail + " failed");
if (_fail > 0) process.exit(1);
