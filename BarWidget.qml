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

  // ---- Manual install for the selection-lookup script. The hotkey path
  //      needs `omarchy-dictionary-lookup` on $PATH. The panel footer
  //      offers an explicit "Install" button that calls
  //      installHotkeyScript() — nothing is written to ~/.local/bin/
  //      without the user clicking it.
  //
  //      ~/.local/bin is the XDG user binary directory and Omarchy puts
  //      it on PATH for both shells and Hyprland bindings (see
  //      $OMARCHY_PATH/default/bash/env-bootstrap).
  //
  //      The install runs as three shell-free Process stages (mkdir, cmp,
  //      install) with paths passed as argv, never interpolated into an
  //      `sh -c` string — so spaces or unusual characters in $HOME or the
  //      plugin path can never break shell quoting. cmp exit 0 means the
  //      installed copy is already identical, so install(1) is skipped
  //      and the status becomes "up-to-date". Failures are reported via
  //      installStatus/installMessage and console.warn.
  //
  //      Qt.resolvedUrl returns a file:// URL which the filesystem can't read
  //      directly — strip the scheme so cmp/install see a plain path.
  function notify(title, body) {
    var omarchyPath = Quickshell.env("OMARCHY_PATH") || ""
    if (omarchyPath === "") {
      console.warn("omarchy-dictionary notify: OMARCHY_PATH is empty, skipping notification")
      return
    }
    var bin = omarchyPath + "/bin/omarchy-notification-send"
    Quickshell.execDetached([bin, title, body])
  }

  readonly property string homeDir: Quickshell.env("HOME") || ""
  readonly property string binDir: homeDir + "/.local/bin"
  readonly property string destPath: binDir + "/omarchy-dictionary-lookup"

  // Install status surfaced to the panel footer. idle = never attempted
  // this session, working = a stage is running, up-to-date = cmp matched,
  // installed = install(1) ran, error = mkdir/cmp/install failed.
  property string installStatus: "idle"
  property string installMessage: ""

  function installHotkeyScript() {
    if (root.homeDir === "") {
      root.installStatus = "error"
      root.installMessage = "HOME is empty, cannot install."
      console.warn("omarchy-dictionary install: HOME is empty, skipping script install")
      return
    }
    if (root.installStatus === "working") return
    root.installStatus = "working"
    root.installMessage = "Installing…"
    mkdirProc.running = true
  }

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
        root.installStatus = "error"
        root.installMessage = "Could not create ~/.local/bin."
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
      // 0 = identical, already installed. Anything else — differ (1) or
      // missing/unreadable (2) — means install.
      if (exitCode === 0) {
        root.installStatus = "up-to-date"
        root.installMessage = "Already installed and up to date."
      } else {
        installProc.running = true
      }
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
        root.installStatus = "installed"
        root.installMessage = "Installed to ~/.local/bin/omarchy-dictionary-lookup."
        root.notify("Dictionary", "Installed system script: ~/.local/bin/omarchy-dictionary-lookup")
      } else {
        root.installStatus = "error"
        root.installMessage = "Install failed."
        console.warn("omarchy-dictionary install: install failed for", root.destPath)
      }
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
