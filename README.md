# Omarchy Dictionary

A Quickshell bar widget for Omarchy that looks up word definitions from
Wiktionary, with support for 23 language editions and a global hotkey for
looking up highlighted text anywhere on your system.

Click the bar icon to open a search field. Type a word and press Enter to
look it up. Use the language dropdown in the panel header to switch editions
(English, Spanish, Japanese, French, German, Arabic, Hindi, and more). When
no match exists, up to three similar words are suggested as clickable chips.

![Dictionary preview](preview.png)

## Requirements

- Omarchy (uses the Quickshell bar plugin system)
- Network access to `*.wiktionary.org` (no API key required)
- `wl-clipboard` (for the global selection hotkey — preinstalled on Omarchy)

## Install

```sh
omarchy plugin add https://github.com/tristonarmstrong/omarchy-dictionary.git --enable
```

If needed, place it in the center section after the clock:

```sh
omarchy bar move tristonarmstrong.dictionary --section center --after omarchy.clock
```

## Usage

### Bar search

- Click the bar icon to open the search panel
- Type a word and press Enter to look it up
- Use the dropdown in the panel header to switch language editions
- When no match exists, up to three similar words appear as chips you can click to retry
- Press Esc to close the panel

### Global selection hotkey

Bind `SUPER + D` in `~/.config/hypr/bindings.lua` to look up the highlighted
word in any application:

```lua
o.bind("SUPER + D", "Look up selection in dictionary", "omarchy-dictionary-lookup")
```

The bundled `scripts/omarchy-dictionary-lookup` reads the Wayland primary
selection (highlighted text), extracts the first alphabetic word, and sends
it to the plugin via IPC. Falls back to the clipboard if the primary
selection is empty. Install the script to `~/.local/bin` (or any directory
on your `$PATH`) and `chmod +x` it.

The plugin auto-installs the bundled script to `~/.local/bin/` on first
load (idempotent — re-runs only when the bundled copy changes), so no
manual install step is needed. Add the keybinding line to your Hypr
config and you're done.

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
the lookup-script word extraction tests (22).

## Remove

```sh
omarchy plugin remove tristonarmstrong.dictionary --yes
```

## License

MIT.