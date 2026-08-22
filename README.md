# Omarchy Dictionary

A Quickshell bar widget for Omarchy that looks up word definitions from
Wiktionary, with support for 23 language editions, fuzzy "did you mean?"
suggestions, and a global hotkey for looking up highlighted text anywhere
on your system.

Click the bar icon to open a search field. Type a word and press Enter to
look it up. The Wiktionary edition is picked automatically from the word's
script — Thai, Japanese, Korean, Russian, Hindi, Arabic, Persian and more
are detected from the characters themselves; Latin-script words look up on
the English edition (see [supported languages](#supported-languages)).
When no match exists, up to three similar words are suggested as clickable
chips.

![Dictionary preview](preview.png)

## Requirements

- Omarchy (uses the Quickshell bar plugin system)
- Network access to `*.wiktionary.org` — no API key or signup required
- `wl-clipboard` for the global selection hotkey — preinstalled on Omarchy

## Install

```sh
omarchy plugin add https://github.com/tristonarmstrong/omarchy-dictionary.git --enable
```

Optionally place it in the center section after the clock:

```sh
omarchy bar move tristonarmstrong.dictionary --section center --after omarchy.clock
```

## Usage

### Bar search

- Click the bar icon to open the search panel
- Type a word and press Enter to look it up
- The language edition is auto-detected from the word's script — no
  selector to fiddle with
- When no match exists, up to three similar words appear as chips you can
  click to retry
- Press Esc to close the panel

### Global selection hotkey

Bind `SUPER + D` in `~/.config/hypr/bindings.lua` to look up the highlighted
word in any application:

```lua
o.bind("SUPER + D", "Look up selection in dictionary", "omarchy-dictionary-lookup")
```

The plugin auto-installs the bundled `scripts/omarchy-dictionary-lookup` to
`~/.local/bin/` on first load (idempotent — re-runs only when the bundled
copy changes), so no manual install step is needed. The script reads the
Wayland primary selection (highlighted text), falls back to the clipboard
if empty, extracts the first alphabetic word, and opens the dictionary
panel with that word pre-filled. With nothing selected it just opens the
empty panel.

> **Note:** A desktop notification confirms when the script is first
> installed. You may want to inspect it before use — review
> `scripts/omarchy-dictionary-lookup` in the plugin repo, or run
> `cat ~/.local/bin/omarchy-dictionary-lookup` to see what was installed.

### IPC

External callers can drive the plugin via `omarchy-shell`:

```sh
omarchy-shell tristonarmstrong.dictionary search <word>   # search and open
omarchy-shell tristonarmstrong.dictionary open           # open empty panel
omarchy-shell tristonarmstrong.dictionary toggle         # toggle panel
omarchy-shell tristonarmstrong.dictionary close          # close panel
```

## Validate

```sh
omarchy plugin validate ~/.config/omarchy/plugins/tristonarmstrong.dictionary
qmllint -I "$OMARCHY_PATH/shell" \
  ~/.config/omarchy/plugins/tristonarmstrong.dictionary/BarWidget.qml \
  ~/.config/omarchy/plugins/tristonarmstrong.dictionary/Panel.qml
```

## Tests

```sh
bash tests/run.sh
```

Runs three suites — QML lint checks (2), Model.js unit tests (240), and
the lookup-script tests (22) — 264 tests total. Model.js is parsed
in-process; the lookup script's pure functions are exercised in a
subprocess with stubbed `wl-paste` and `omarchy-shell` so the suite
needs no Wayland session or running shell.

## Remove

```sh
omarchy plugin remove tristonarmstrong.dictionary --yes
rm ~/.local/bin/omarchy-dictionary-lookup
```

`omarchy plugin remove` drops the plugin files; the lookup script at
`~/.local/bin/omarchy-dictionary-lookup` stays (the plugin doesn't know
when it's being removed). Remove it manually with the second command.

## Supported languages

23 Wiktionary editions, alphabetically by English label:

| Language | Script detected |
|---|---|
| Arabic | Arabic script (without Persian-only letters) |
| Bengali | Bengali |
| Chinese | Han ideographs, no kana present |
| Dutch | falls back to English edition |
| English | default for all Latin-script words |
| French | falls back to English edition |
| German | falls back to English edition |
| Hindi | Devanagari |
| Indonesian | falls back to English edition |
| Italian | falls back to English edition |
| Japanese | Kana (hiragana/katakana), or Han with kana |
| Korean | Hangul |
| Malay | falls back to English edition |
| Persian | Arabic script with Persian-only letters (پ چ ژ گ) |
| Polish | falls back to English edition |
| Portuguese | falls back to English edition |
| Russian | Cyrillic |
| Spanish | falls back to English edition |
| Swahili | falls back to English edition |
| Swedish | falls back to English edition |
| Thai | Thai |
| Turkish | falls back to English edition |
| Vietnamese | falls back to English edition |

Detection scans the query's Unicode blocks (`Model.detectLanguage`).
Latin-script languages share one alphabet and can't be told apart
reliably from a single word, so they run on the English edition — which
also hosts headwords for most of them.

To add another edition, append it to the `LANGUAGES` array in `Model.js`
and, if it uses its own script, a block check inside `detectLanguage`.

## License

MIT.