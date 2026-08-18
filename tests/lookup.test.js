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

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n" + (_pass + _fail) + " total, " + _pass + " passed, " + _fail + " failed");
if (_fail > 0) process.exit(1);