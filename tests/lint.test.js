#!/usr/bin/env node
"use strict";

// QML lint checks — catches mistakes that break plugin loading.
// Run:  node tests/lint.test.js

var fs   = require("fs");
var path = require("path");
var assert = require("assert");

// ── Minimal test harness ────────────────────────────────────────────────────
var _group = "";
var _pass  = 0;
var _fail  = 0;

function group(name) { _group = name; console.log("\n" + name); }
function test(name, fn) {
  try { fn(); _pass++; console.log("  \u2713 " + name); }
  catch(e) { _fail++; console.log("  \u2717 " + name); console.log("    " + e.message); }
}

// ── Collect all .qml files in the project root ──────────────────────────────
var ROOT = path.join(__dirname, "..");
var qmlFiles = [];
function walk(dir) {
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dir, entries[i].name);
    if (entries[i].isDirectory()) {
      if (entries[i].name === "node_modules" || entries[i].name === ".git" || entries[i].name === "tests") continue;
      walk(full);
    } else if (entries[i].name.endsWith(".qml")) {
      qmlFiles.push(full);
    }
  }
}
walk(ROOT);

// ── Lint: bare JS imports must have a qualifier ─────────────────────────────
// QML requires: import "file.js" as Qualifier
// Bare:         import "file.js"          ← ERROR (panel won't load)
group("QML imports");

test("no bare JS imports (missing 'as' qualifier)", function() {
  var violations = [];
  for (var i = 0; i < qmlFiles.length; i++) {
    var rel = path.relative(ROOT, qmlFiles[i]);
    var lines = fs.readFileSync(qmlFiles[i], "utf8").split("\n");
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      // Match: import "something.js"  but NOT: import "something.js" as X
      if (/^import\s+"[^"]+\.js"\s*$/.test(line)) {
        violations.push(rel + ":" + (j + 1) + ": " + line);
      }
    }
  }
  assert.strictEqual(violations.length, 0,
    "Bare JS imports found (need 'as Qualifier'):\n  " + violations.join("\n  "));
});

test("no const/let in JS files (QML engine requires var)", function() {
  var jsFiles = [];
  function walkJs(dir) {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(dir, entries[i].name);
      if (entries[i].isDirectory()) {
        if (entries[i].name === "node_modules" || entries[i].name === ".git" || entries[i].name === "tests") continue;
        walkJs(full);
      } else if (entries[i].name.endsWith(".js")) {
        jsFiles.push(full);
      }
    }
  }
  walkJs(ROOT);

  var violations = [];
  for (var i = 0; i < jsFiles.length; i++) {
    var rel = path.relative(ROOT, jsFiles[i]);
    var lines = fs.readFileSync(jsFiles[i], "utf8").split("\n");
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      if (/^const\s+/.test(line) || /^let\s+/.test(line)) {
        violations.push(rel + ":" + (j + 1) + ": " + line.slice(0, 80));
      }
    }
  }
  assert.strictEqual(violations.length, 0,
    "const/let found (QML engine needs var):\n  " + violations.join("\n  "));
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n" + (_pass + _fail) + " total, " + _pass + " passed, " + _fail + " failed");
if (_fail > 0) process.exit(1);
