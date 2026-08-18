#!/usr/bin/env node
"use strict";

// Tests for scripts/omarchy-dictionary-lookup. Exercises the pure word-
// extraction logic by sourcing the script and calling extract_word in
// isolation — no X server, no IPC, no running shell required.
//
// Run:  node tests/lookup.test.js

var assert = require("assert");
var path   = require("path");
var fs     = require("fs");
var { execSync } = require("child_process");

// ── Minimal test harness ────────────────────────────────────────────────────
var _group = "";
var _pass  = 0;
var _fail  = 0;

function group(name) { _group = name; console.log("\n" + name); }
function test(name, fn) {
  try { fn(); _pass++; console.log("  \u2713 " + name); }
  catch(e) { _fail++; console.log("  \u2717 " + name); console.log("    " + e.message); }
}

// ── Load extract_word from the script. We source the script with stub
//    `wl-paste` and `omarchy-shell` on PATH so the top-level execution
//    bails out (no selection) but `extract_word` becomes available as a
//    shell function we can call via `bash -c`. ──────────────────────────────
var SCRIPT = path.join(__dirname, "..", "scripts", "omarchy-dictionary-lookup");

// `extract_word` is a pure function. Call it via bash, return stdout.
function callExtractWord(input) {
  var src = fs.readFileSync(SCRIPT, "utf8");
  // Strip the `exec` at the bottom so the script can be sourced safely
  // (no process spawn, no PATH lookup of wl-paste).
  var sourced = src
    .replace(/^word=.*$/m, "")
    .replace(/^exec.*$/m, "")
    .replace(/^set -euo pipefail$/m, "");
  // Invoke extract_word with the literal argument, capture stdout.
  var escaped = input.replace(/'/g, "'\\''");
  var cmd = sourced + "\necho \"$(extract_word '" + escaped + "')\"\n";
  return execSync("bash", { input: cmd, encoding: "utf8" }).trim();
}

// ── Tests ───────────────────────────────────────────────────────────────────

group("extract_word — happy path");

test("single word passes through unchanged", () => {
  assert.strictEqual(callExtractWord("cat"), "cat");
});

test("takes the first word of a multi-word selection", () => {
  assert.strictEqual(callExtractWord("hello world"), "hello");
});

test("preserves uppercase letters", () => {
  assert.strictEqual(callExtractWord("Hello"), "Hello");
});

test("preserves mixed case", () => {
  assert.strictEqual(callExtractWord("iPhone Review"), "iPhone");
});

group("extract_word — punctuation stripping");

test("strips trailing punctuation", () => {
  assert.strictEqual(callExtractWord("hello!"), "hello");
});

test("strips leading punctuation", () => {
  assert.strictEqual(callExtractWord("\"hello\""), "hello");
});

test("strips both ends and keeps the word", () => {
  assert.strictEqual(callExtractWord("...serendipity..."), "serendipity");
});

test("skips leading digits and grabs the word after", () => {
  assert.strictEqual(callExtractWord("404 not found"), "not");
});

test("handles dashes by taking the first alphabetic run", () => {
  assert.strictEqual(callExtractWord("well-known"), "well");
});

test("handles apostrophes by splitting", () => {
  assert.strictEqual(callExtractWord("don't stop"), "don");
});

group("extract_word — edge cases");

test("empty string returns empty", () => {
  assert.strictEqual(callExtractWord(""), "");
});

test("pure punctuation returns empty", () => {
  assert.strictEqual(callExtractWord("!@#$%"), "");
});

test("pure digits returns empty", () => {
  assert.strictEqual(callExtractWord("12345"), "");
});

test("whitespace-only returns empty", () => {
  assert.strictEqual(callExtractWord("   "), "");
});

test("unicode letters are excluded (script targets ASCII)", () => {
  // café's "fé" has accented chars — grep -oP '[a-zA-Z]+' will stop at é
  // because é is not in [a-zA-Z]. Verify the contract: ASCII letters only.
  assert.strictEqual(callExtractWord("café"), "caf");
});

// ── wayland_display helper tests ─────────────────────────────────────────────
// Same trick: source the script's functions, then call wayland_display
// with controlled environment. Write to a temp file so bash -c escaping
// doesn't break on single quotes in the comments.
var _sourcedTmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "lookup-src-"));
function writeSourced(extra) {
  var src = fs.readFileSync(SCRIPT, "utf8")
    .replace(/^word=.*$/m, "")
    .replace(/^exec.*$/m, "")
    .replace(/^set -euo pipefail$/m, "");
  var tmp = path.join(_sourcedTmp, "src-" + Math.random().toString(36).slice(2) + ".sh");
  fs.writeFileSync(tmp, src + "\n" + extra);
  return tmp;
}
function callWaylandDisplay(envOverrides) {
  var tmp = writeSourced('echo "$(wayland_display)"');
  var env = Object.assign({}, process.env, envOverrides);
  if (!("WAYLAND_DISPLAY" in envOverrides)) delete env.WAYLAND_DISPLAY;
  return execSync("bash " + tmp, { encoding: "utf8", env: env }).trim();
}

group("wayland_display — Hyprland environment quirk");

test("passes through WAYLAND_DISPLAY when already set", () => {
  assert.strictEqual(callWaylandDisplay({ WAYLAND_DISPLAY: "wayland-9" }), "wayland-9");
});

test("discovers socket from XDG_RUNTIME_DIR when WAYLAND_DISPLAY unset", () => {
  // The test machine has at least one wayland-N socket (we're running on
  // Wayland). Verify the discovery path returns a matching name.
  var found = callWaylandDisplay({ XDG_RUNTIME_DIR: "/run/user/" + process.getuid() });
  assert.ok(/^wayland-\d+$/.test(found),
    "expected wayland-N, got: '" + found + "'");
});

test("returns empty string when no socket exists", () => {
  // Point XDG_RUNTIME_DIR at an empty tmpdir with no wayland sockets.
  var tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "wl-test-"));
  try {
    var found = callWaylandDisplay({ XDG_RUNTIME_DIR: tmp });
    assert.strictEqual(found, "");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Main-flow tests ──────────────────────────────────────────────────────────
// Verify which IPC command the script invokes based on whether a word was
// extracted. We stub `wl-paste` (to inject a selection) and `omarchy-shell`
// (to capture the call) before sourcing the script.
function callMainFlow(selectionValue) {
  var stubDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "lookup-stubs-"));
  var capture = path.join(stubDir, "capture.txt");
  // wl-paste stub: just echoes the configured selection value.
  var wlPaste = path.join(stubDir, "wl-paste");
  fs.writeFileSync(wlPaste, "#!/bin/bash\necho " + JSON.stringify(selectionValue) + "\n");
  fs.chmodSync(wlPaste, 0o755);
  // omarchy-shell stub: records the args, exits 0.
  var omarchyShell = path.join(stubDir, "omarchy-shell");
  fs.writeFileSync(omarchyShell,
    "#!/bin/bash\n" +
    "echo \"$@\" > " + capture + "\n" +
    "exit 0\n");
  fs.chmodSync(omarchyShell, 0o755);

  var src = fs.readFileSync(SCRIPT, "utf8")
    .replace(/^set -euo pipefail$/m, ""); // don't strict-fail on the stub
  var tmp = path.join(stubDir, "script.sh");
  fs.writeFileSync(tmp, src);

  var env = Object.assign({}, process.env, {
    PATH: stubDir + ":" + (process.env.PATH || ""),
    WAYLAND_DISPLAY: "wayland-1"
  });

  try {
    execSync("bash " + tmp, { encoding: "utf8", env: env });
    return fs.existsSync(capture) ? fs.readFileSync(capture, "utf8").trim() : "";
  } finally {
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
}

group("main flow — IPC dispatch");

test("with a selection: calls 'search' with the extracted word", () => {
  var result = callMainFlow("hello world");
  assert.strictEqual(result, "-q tristonarmstrong.dictionary search hello");
});

test("with punctuation-only selection: calls 'toggle' to open empty popup", () => {
  var result = callMainFlow("!@#$%");
  assert.strictEqual(result, "-q tristonarmstrong.dictionary toggle");
});

test("with empty selection: calls 'toggle' to open empty popup", () => {
  var result = callMainFlow("");
  assert.strictEqual(result, "-q tristonarmstrong.dictionary toggle");
});

test("with whitespace-only selection: calls 'toggle'", () => {
  var result = callMainFlow("   ");
  assert.strictEqual(result, "-q tristonarmstrong.dictionary toggle");
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n" + (_pass + _fail) + " total, " + _pass + " passed, " + _fail + " failed");
if (_fail > 0) process.exit(1);