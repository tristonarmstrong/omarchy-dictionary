import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Bar widget for the dictionary plugin: a magnifying-glass glyph that toggles
// the search panel. The visible bar item is just an icon, so the WidgetButton
// is built icon-only — the panel owns the search field, results, and the
// aria of "look up a word" the moment it opens.
BarWidget {
  id: root
  moduleName: "tristonarmstrong.dictionary"

  // ---- Panel popup wiring. Bar.findPanelWidget keys on open/close/opened
  //      and Bar.requestPopout closes via closeForPopoutSwitch before
  //      swapping in a sibling panel, so the BarWidget host has to forward
  //      every state the bar contract expects.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function search(word) {
    if (panelLoader.item && typeof panelLoader.item.search === "function") {
      panelLoader.item.search(word || "")
    }
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  // ---- Auto-install the selection-lookup script. The hotkey path needs
  //      `omarchy-dictionary-lookup` on $PATH; rather than ask the user to
  //      copy it manually, we install it to ~/.local/bin/ on first load.
  //      Hyprland binding is the only remaining manual step (see README).
  //
  //      ~/.local/bin is the right home for it: it is the XDG user binary
  //      directory and Omarchy puts it on PATH for both shells and Hyprland
  //      bindings (see $OMARCHY_PATH/default/bash/env-bootstrap). Nothing
  //      creates it on a fresh install, so the first stage below is mkdir -p
  //      and the destination directory is never assumed to exist.
  //
  //      The install runs as three shell-free Process stages (mkdir, cmp,
  //      install) with paths passed as argv, never interpolated into an
  //      `sh -c` string — so spaces or unusual characters in $HOME or the
  //      plugin path can never break shell quoting. cmp exit 0 means the
  //      installed copy is already identical, so the notify only fires when
  //      install(1) actually ran and subsequent restarts are silent.
  //      Failures are reported via console.warn instead of failing silently.
  //
  //      Qt.resolvedUrl returns a file:// URL which the filesystem can't read
  //      directly — strip the scheme so cmp/install see a plain path.
  function notify(title, body) {
    var bin = Quickshell.env("OMARCHY_PATH") + "/bin/omarchy-notification-send"
    Quickshell.execDetached([bin, title, body])
  }

  readonly property string homeDir: Quickshell.env("HOME") || ""
  readonly property string binDir: homeDir + "/.local/bin"
  readonly property string destPath: binDir + "/omarchy-dictionary-lookup"

  // Util.fileUrl encodes every path segment, so Qt.resolvedUrl returns a
  // percent-encoded URL.  decodeURIComponent turns it back into a real
  // filesystem path that cmp/install can open.  The try/catch handles the
  // edge case where the URL is already plain ASCII (no-op decode).
  readonly property string scriptPath: {
    var url = String(Qt.resolvedUrl("scripts/omarchy-dictionary-lookup"))
    var raw = url.replace(/^file:\/\//, "/")
    try { return decodeURIComponent(raw) } catch (e) { return raw }
  }

  Process {
    id: mkdirProc
    command: ["mkdir", "-p", root.binDir]
    stderr: SplitParser {
      onRead: function(line) { console.warn("omarchy-dictionary install:", line) }
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        console.warn("omarchy-dictionary install: mkdir failed for", root.binDir)
        return
      }
      cmpProc.running = true
    }
  }

  Process {
    id: cmpProc
    command: ["cmp", "-s", root.scriptPath, root.destPath]
    stderr: SplitParser {
      onRead: function(line) { console.warn("omarchy-dictionary install:", line) }
    }
    onExited: function(exitCode) {
      // 0 = identical, stay silent. Anything else — differ (1) or
      // missing/unreadable (2) — means install.
      if (exitCode !== 0) installProc.running = true
    }
  }

  Process {
    id: installProc
    command: ["install", "-m755", root.scriptPath, root.destPath]
    stderr: SplitParser {
      onRead: function(line) { console.warn("omarchy-dictionary install:", line) }
    }
    onExited: function(exitCode) {
      if (exitCode === 0) {
        root.notify("Dictionary", "Installed system script: ~/.local/bin/omarchy-dictionary-lookup")
      } else {
        console.warn("omarchy-dictionary install: install failed for", root.destPath)
      }
    }
  }

  Component.onCompleted: {
    if (root.homeDir === "") {
      console.warn("omarchy-dictionary install: HOME is empty, skipping script install")
    } else {
      mkdirProc.running = true
    }
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "tristonarmstrong.dictionary"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function search(word: string): void { root.search(word) }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰗚"
    tooltipText: "Dictionary"

    onPressed: function(b) {
      if (b === Qt.RightButton) return
      root.togglePanel()
    }
  }
}
