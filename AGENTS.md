# AGENTS.md

Decisions locked for this plugin. Read this before changing anything; it
caps the traps agents keep hitting in this specific repo.

This directory is a `git` clone that **is** the live Omarchy shell plugin
at `~/.config/omarchy/plugins/tristonarmstrong.dictionary`. Switching
branches changes the running plugin. Files under `data/webster/` are
generated; do not hand-edit them.

## Run the tests before and after any change

```bash
bash tests/run.sh
```

Full taxonomy: `lint.test.js`, `model.test.js`, `lookup.test.js`,
`install.test.js`. Current baseline: lint 2/2, model 273/273, lookup 41/41,
install 25/25. All must be green before a push.

- `Model.js` is QML-loaded JavaScript. **No `const`/`let`** — the engine
  requires `var` (lint enforces this). Top-level declarations only.
- The tests load `Model.js` through a `new Function("module", "exports",
  src + exportLines)` harness driven by the `PUBLIC_SYMBOLS` list in
  `tests/model.test.js`. Any new public helper **must be added to
  `PUBLIC_SYMBOLS`** or it will be invisible to tests (and to `Panel.qml`).
- Tests run against a tiny synthetic wordlist; they never touch network or
  the real `data/webster` buckets. A real-data smoke check is manual:
  `gzip -dc data/webster/<bucket>.json.gz | <adapter parse>`.

## Dictionary adapters are the one real architecture here

Dictionary sources are pluggable **adapters**, not branches. An adapter is a
plain object:

```
{ id, label, languages: ["en"],            // "*" = every language
  argsFor: function(word, lang) -> argv,   // [] = skip this adapter
  parse:   function(stdout, word, lang) -> { ok:true, entry } | { ok:false, kind, error } }
```

- `ADAPTERS` registry **order IS the fallback chain order**. English resolves
  to `[webster1913, wiktionary]` (offline-first, network fallback); every
  other language to `[wiktionary]` via `adaptersFor(lang)`.
- The panel tries the chain in order: first `ok` wins; `notfound`/`empty`/
  `invalid`/process-failure advances; an exhausted chain falls back to the
  existing fuzzy-recovery / notfound UI.
- Adding a source = new adapter object + one line in `ADAPTERS`. Do not
  reorder the registry and do not add per-language ad-hoc branches in
  `Panel.qml`.

## Offline data layout

`scripts/build-webster.py` produces `data/webster/<first-letter>.json.gz`
(plus `other.json.gz` for keys not starting a-z) from GCIDE XML. Keys are
normalized lowercased/collapsed-whitespace. A bucket decompresses to up to
~1 MB, so the panel streams it through a `gzip -dc` Process and parses
stdout — never read a bucket whole into memory.

Known issue: ~12.6% of headwords carry literal U+FFFD in their phonetic
field (upstream GCIDE data loss, not a build-script bug — the build decodes
UTF-8 strictly). Tracked as issue #14; sanitization is a deliberate
future change, not something to bolt on ad hoc.

## Version tag

`Panel.qml` renders `buildVersion` in the popup's bottom-right corner so the
running build can be confirmed visually. Single source of truth: the
`buildVersion` property. Use `v0.2-dev` while iterating, `v0.2` when
pushing/rolling out. The `manifest.json` `version` is the release version and
is tracked separately.

## Script install / selection lookup

- `BarWidget.qml` installs `scripts/omarchy-dictionary-lookup` to
  `~/.local/bin/` only on explicit user click, as shell-free Process stages
  (`mkdir`, `cmp`, `install`) with paths passed as argv. **Never reintroduce
  `sh -c` string interpolation** — that's a shell-quoting/injection trap the
  refactor removed deliberately.
- `scripts/omarchy-dictionary-lookup` sets `LC_ALL=C.UTF-8` on purpose so
  `grep -P '\p{L}'` extracts Unicode letters reliably. It does not set
  `LC_ALL`; do not "clean it up".