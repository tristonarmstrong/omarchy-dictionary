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
  //      The install is idempotent: a quick cmp -s skips it when the script
  //      already matches the bundled copy. The trailing echo only fires when
  //      install(1) actually ran — we use that as the trigger for the
  //      notification below, so subsequent restarts are silent.
  //
  //      Qt.resolvedUrl returns a file:// URL which the shell can't read
  //      directly — strip the scheme so install(1) sees a plain path.
  function notify(title, body) {
    var bin = Quickshell.env("OMARCHY_PATH") + "/bin/omarchy-notification-send"
    Quickshell.execDetached([bin, title, body])
  }

  Process {
    id: installProc
    property string scriptPath: String(Qt.resolvedUrl("scripts/omarchy-dictionary-lookup")).replace(/^file:\/\//, "/")
    command: ["sh", "-c",
      "home=\"${HOME:-" + (Quickshell.env.HOME || "/root") + "}\"; " +
      "dst=\"$home/.local/bin/omarchy-dictionary-lookup\"; " +
      "mkdir -p \"$home/.local/bin\" && " +
      "if [ ! -f \"$dst\" ] || ! cmp -s '" + scriptPath + "' \"$dst\"; then " +
      "  install -m755 '" + scriptPath + "' \"$dst\" && echo installed; " +
      "fi"
    ]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (text.indexOf("installed") !== -1) {
          root.notify("Dictionary", "Installed system script: ~/.local/bin/omarchy-dictionary-lookup")
        }
      }
    }
  }

  Component.onCompleted: installProc.running = true

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
