import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar widget for the dictionary plugin: a magnifying-glass glyph that toggles
// the search panel. The visible bar item is just an icon, so the WidgetButton
// is built icon-only — the panel owns the search field, results, and the
// aria of "look up a word" the moment it opens.
BarWidget {
  id: root
  moduleName: "alarm.dictionary"

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
    target: "alarm.dictionary"

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
