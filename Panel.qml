import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Dictionary search panel. The bar widget owns a magnify glyph that toggles
// this popup; everything user-facing lives here — the search field, the
// fetch lifecycle, and the rendered entry.
//
// Layout: a search field pinned to the top, a meaning stack beneath that
// grows from the entry's parts of speech. The entry is treated as a
// read-out rather than a picker, so there's no per-row cursor — arrows move
// the field caret instead, Enter fires search, Esc closes the panel.
Panel {
  id: root
  moduleName: "tristonarmstrong.dictionary"
  ipcTarget: "tristonarmstrong.dictionary"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // ---- Panel lifecycle. Stays in the bar's popout coordinator so adjacent
  //      panels can swap with TAB without leaving the bar that owns this
  //      slot. Setting opened = false (or close()) is the canonical way out.
  function open() {
    root.controller.show()
    root.refreshFocus()
  }

  function openFromHotkey() {
    root.controller.show()
    Qt.callLater(function() {
      if (root.opened) refreshFocus()
    })
  }

  function close() {
    if (root.status === "loading") lookupProc.running = false
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  // ---- Look up a word. Called both by Enter / clicking Search and from
  //      the IPC bridge so external tools can preload an entry before the
  //      panel is even opened.
  function search(word) {
    var q = String(word || "").trim()
    root.query = q
    if (searchField.text !== q) searchField.text = q
    if (q === "") {
      lookupProc.running = false
      root.status = "idle"
      root.statusMessage = ""
      root.entry = null
      root.suggestions = []
      root.originalQuery = ""
      root.isAutoMatched = false
      return
    }
    runLookup()
  }

  // ---- Search state. status drives which body section (hero + list) the
  //      panel shows; entry holds the parsed response on success.
  property string query: ""
  property var entry: null
  property string status: "idle"        // "idle" | "loading" | "ok" | "notfound" | "error" | "suggestions"
  property string statusMessage: ""
  property int variants: 0               // > 1 when the API returned more than one entry object

  // Target language for lookups. Driven by the dropdown in the popup
  // header; default comes from Model.defaultLanguage so the panel and
  // data layer stay in sync.
  property string language: Model.defaultLanguage ? Model.defaultLanguage() : "en"

  // ---- Fuzzy state. Populated only when the user's exact query was a 404
  //      and the local wordlist surfaced closer candidates. suggestions is
  //      the chip list shown for the user to choose from; originalQuery is
  //      what the user typed before auto-match rewrote query to a better
  //      word (kept so we can render a "showing 'X' for 'Y'" hint).
  property var suggestions: []
  property string originalQuery: ""
  property bool isAutoMatched: false

  // Suppress the user-edit reset in applyEdited when the *plugin itself*
  // rewrites the search field (auto-match path: we set searchField.text to
  // the chosen candidate, and the resulting onTextChanged would otherwise
  // clobber isAutoMatched and originalQuery mid-fetch).
  property bool programmaticEdit: false

  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property string heroSummary: entry ? Model.summaryLabel(entry) : ""
  readonly property int panelWidth: Style.space(420)
  readonly property int panelMaxHeight: Style.space(620)
  readonly property int searchDelayMs: 250

  // ---- Bindings need the source data checked before any property
  //      access; pulling the wording into functions lets the body
  //      short-circuit cleanly when entry is null mid-fetch (the
  //      auto-match recovery path blanks entry briefly between lookups).
  function autoMatchedNote() {
    if (!root.entry || !root.originalQuery) return ""
    return "Showing \"" + root.entry.word + "\" (closest match for \"" + root.originalQuery + "\")."
  }
  function entryWord() {
    return root.entry ? String(root.entry.word || "") : ""
  }
  function entryPhonetic() {
    return root.entry ? String(root.entry.phonetic || "") : ""
  }

  // ---- Focus handling. The field owns initial focus; Esc redirects to close.
  function refreshFocus() {
    if (!root.opened) return
    Qt.callLater(function() {
      if (searchField) {
        searchField.forceActiveFocus()
        if (String(searchField.text || "").length > 0) searchField.selectAll()
      }
    })
  }

  // ---- Lookup. The active query is the one in the field; if it changes
  //      while a request is in flight we kill the running process so a
  //      stale response can't overwrite the newer one. Curl writes JSON to
  //      stdout; we parse it once on completion.
  function runLookup() {
    var q = String(searchField.text || "").trim()
    root.query = q
    if (q === "") {
      lookupProc.running = false
      root.status = "idle"
      root.statusMessage = ""
      root.entry = null
      root.suggestions = []
      root.originalQuery = ""
      root.isAutoMatched = false
      return
    }
    var args = Model.lookupArgs(q, root.language)
    if (args.length === 0) return

    root.status = "loading"
    root.statusMessage = ""
    root.entry = null
    root.variants = 0
    // Fresh lookup: drop fuzzy state. The auto-match recovery path below
    // repopulates originalQuery if it decides to silently rewrite q.
    root.suggestions = []
    root.isAutoMatched = false
    if (lookupProc.running) lookupProc.running = false
    lookupProc.command = args
    lookupProc.running = true
  }

  // The grammar of "search" — Enter fires immediately; typing clears any
  // pending debounce and resets state so a stale response can't surprise
  // the user. Esc routes to the panel close (the keyCatcher handles it).
  // When programmaticEdit is true (auto-match recovery just rewrote the
  // field to a candidate word) we skip the user-reset clauses so the
  // isAutoMatched flag survives into the second lookup.
  function applyEdited() {
    if (root.programmaticEdit) return
    var q = String(searchField.text || "").trim()
    root.query = q
    if (q === "") {
      lookupProc.running = false
      root.status = "idle"
      root.statusMessage = ""
      root.entry = null
      root.suggestions = []
      root.originalQuery = ""
      root.isAutoMatched = false
      return
    }
    if (searchDebounce.running) searchDebounce.stop()
    // Don't auto-fire on every keystroke — the API is rate-limited and
    // half-typed words make noise — but clear any in-flight result so the
    // panel doesn't show stale data next to fresh text.
    if (root.status === "ok" || root.status === "notfound" || root.status === "error" || root.status === "suggestions") {
      root.entry = null
      root.status = "idle"
      root.statusMessage = ""
      root.suggestions = []
      root.originalQuery = ""
      root.isAutoMatched = false
    }
  }

  // Curl process. Curl exits 22 on the not-found path (HTTP 404), which
  // is not a network error from the user's perspective; the response body
  // carries the API's own message, so we always try to parse it.
  Process {
    id: lookupProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (root.status !== "loading") return
        var result = Model.parseResponse(text, root.language)
        if (result && result.ok) {
          root.entry = result.entry
          root.variants = result.variants || 0
          root.status = "ok"
          root.statusMessage = ""
          // originalQuery stays put when isAutoMatched is true so the
          // result body can render "showing 'X' for 'Y'".
        } else if (result && (result.kind === "notfound" || result.kind === "invalid" || result.kind === "empty")) {
          // Fuzzy recovery covers more than the explicit notfound body —
          // the Free Dictionary API has been observed returning HTTP 502
          // (Cloudflare error page) for typos instead of 404, which the
          // parser surfaces as `invalid`/`empty`. Trying fuzzy in those
          // cases saves a user round-trip. Genuine network failures fall
          // through to the error branch below.
          root.entry = null
          if (root.isAutoMatched) {
            // Recovery round tripped without finding a working word —
            // don't loop, just show the notfound state.
            root.originalQuery = ""
            root.isAutoMatched = false
            root.status = "notfound"
            root.statusMessage = "no definition found"
            return
          }
          root.originalQuery = root.query
          var fuzzy = Model.fuzzyMatch(root.query)
          if (fuzzy && fuzzy.autoMatch) {
            // Rewrite the field to the candidate so the user can see what
            // we fetched, keep it marked "auto", and fetch it. The next
            // round will see isAutoMatched === true on any further 404.
            // programmaticEdit suppresses applyEdited's user-reset clauses
            // while the field is being updated by us, not the user.
            root.isAutoMatched = true
            root.programmaticEdit = true
            searchField.text = fuzzy.autoMatch
            root.query = fuzzy.autoMatch
            root.programmaticEdit = false
            root.runLookup()
            return
          }
          if (fuzzy && fuzzy.alternatives && fuzzy.alternatives.length > 0) {
            root.suggestions = fuzzy.alternatives
            root.status = "suggestions"
            root.statusMessage = "no definition found for \"" + root.originalQuery + "\""
          } else {
            root.status = "notfound"
            root.statusMessage = "no definition found for \"" + root.originalQuery + "\""
          }
        } else {
          root.entry = null
          root.status = "error"
          root.statusMessage = (result && result.error) || "could not look up the word"
        }
      }
    }
    stderr: StdioCollector {
      id: lookupStderr
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (root.status !== "loading") return
      // The not-found branch usually comes back via stdout (the API
      // returns a JSON error body on 404), and we already handled it.
      // This is the catch-all for the times we never get that body —
      // DNS, TLS, refused connection. Curl's HTTP 404 exit (22) lands
      // here with no parsed body, so surface it as a fetch error.
      root.entry = null
      root.status = "error"
      root.statusMessage = "could not reach the dictionary service"
    }
  }

  // Debounce kept as a Timer in case auto-search is enabled later — for now
  // it's only used to dedupe rapid Enter presses during a request.
  Timer {
    id: searchDebounce
    interval: root.searchDelayMs
    repeat: false
    onTriggered: runLookup()
  }

  onOpenedChanged: if (opened) refreshFocus()

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(root.panelWidth)
    contentHeight: panel.fittedContentHeight(panelColumn.implicitHeight, root.panelMaxHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: searchField.activeFocus
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      // Type to search shortcuts when the field isn't focused: "/" focuses
      // and selects the search field (fuzzy launcher convention); "Esc"
      // arrives here only when the field does not own focus.
      onTextKey: function(t) {
        if (t === "/") {
          root.refreshFocus()
        }
      }

Column {
      id: panelColumn
      width: parent.width
      spacing: Style.space(14)

        // ---------- Hero: title + entry summary (parts of speech) + lang dropdown
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, languageDropdown.implicitHeight)

          Text {
            id: heroIcon
            text: "󰗚"
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: languageDropdown.left
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "Dictionary"
              color: root.contentForeground
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            Text {
              text: {
                if (root.status === "ok" && root.entry) {
                  var parts = root.heroSummary
                  var suffix = root.variants > 1 ? " · " + root.variants + " entries" : ""
                  return (parts === "" ? "found" : parts) + suffix
                }
                if (root.status === "loading") return "looking up…"
                if (root.status === "notfound") return "no definition"
                if (root.status === "error") return "couldn't reach the API"
                return "look up a word"
              }
              color: Qt.darker(root.contentForeground, 1.4)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }

          // Language switcher in the top right of the popup. Data-driven
          // from Model.languages() (sorted alphabetically by English
          // label in JS) so adding a language is a one-entry edit.
          // Picking one kicks off a fresh lookup when there's already a
          // query, so changing language doesn't require retyping the
          // word.
          Dropdown {
            id: languageDropdown
            value: root.language
            options: Model.languages()
            showLabel: false
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            implicitWidth: Style.space(120)
            onChanged: function(newValue) {
              if (newValue === root.language) return
              root.language = newValue
              // The previously-shown entry (or in-flight lookup) was for
              // the prior language and is no longer meaningful under the
              // new one. Cancel any in-flight proc, clear the entry,
              // empty the search field, and reset to idle so the user
              // starts fresh with the new language.
              if (lookupProc.running) lookupProc.running = false
              var hadResult = root.status === "ok" || root.status === "notfound" ||
                              root.status === "error" || root.status === "suggestions" ||
                              root.status === "loading"
              if (hadResult) {
                root.entry = null
                root.variants = 0
                root.status = "idle"
                root.statusMessage = ""
                root.suggestions = []
                root.originalQuery = ""
                root.isAutoMatched = false
                root.programmaticEdit = true
                searchField.text = ""
                root.programmaticEdit = false
                root.query = ""
              }
            }
          }
        }

        // ---------- Search field ----------
        PanelSeparator {
          foreground: root.contentForeground
        }

        Item {
          width: parent.width
          implicitHeight: Style.space(46)

          Rectangle {
            anchors.fill: parent
            radius: Style.cornerRadius
            color: "transparent"
            border.width: Style.spacing.hairline
            border.color: searchField.activeFocus
              ? Color.accent
              : Qt.darker(root.contentForeground, 1.7)

            Row {
              anchors.fill: parent
              anchors.leftMargin: Style.space(12)
              anchors.rightMargin: Style.space(6)
              spacing: Style.space(10)

              Text {
                text: "󰗚"
                color: Qt.darker(root.contentForeground, 1.3)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.title
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(22)
                horizontalAlignment: Text.AlignHCenter
              }

              TextField {
                id: searchField
                width: parent.width - clearRow.width - iconText.width - Style.space(10) * 2
                height: parent.height
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                color: root.contentForeground
                placeholderText: "Search a word…"
                placeholderTextColor: Qt.darker(root.contentForeground, 2.0)
                background: null
                selectByMouse: true
                clip: true
                onTextChanged: root.applyEdited()
                Keys.onEscapePressed: function(event) {
                  // Esc with empty field → close; Esc with text → clear the text.
                  if (String(searchField.text || "").length > 0) {
                    searchField.text = ""
                  } else {
                    root.close()
                    event.accepted = true
                    return
                  }
                  event.accepted = true
                }
              }

              Row {
                id: clearRow
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(4)

                Button {
                  id: clearButton
                  visible: String(searchField.text || "") !== ""
                  text: "✕"
                  onClicked: {
                    searchField.text = ""
                    root.refreshFocus()
                  }
                  foreground: root.contentForeground
                }

                Button {
                  id: searchButton
                  text: "→"
                  enabled: String(searchField.text || "").trim() !== "" && root.status !== "loading"
                  onClicked: {
                    searchDebounce.stop()
                    root.runLookup()
                  }
                  foreground: root.contentForeground
                }
              }
            }

            // Tag the pressed-Enter inside the TextField to the lookup. The
            // field handles onAccepted, but Quickshell's TextField wraps its
            // keys, so onAccepted plus the explicit returnPressed below give
            // a single firing path regardless of focus holder quirks.
            Item {
              id: iconText
              width: Style.space(22)
              height: Style.space(22)
              visible: false
            }
          }
        }

        Keys.onReturnPressed: function(event) {
          if (String(searchField.text || "").trim() !== "") {
            searchDebounce.stop()
            root.runLookup()
            event.accepted = true
          }
        }
        Keys.onEnterPressed: function(event) {
          if (String(searchField.text || "").trim() !== "") {
            searchDebounce.stop()
            root.runLookup()
            event.accepted = true
          }
        }

        // ---------- Body ----------
        PanelSeparator {
          foreground: root.contentForeground
        }

        // Body container — one slot per response state, only the active one
        // is visible. Pinned at top-left, full column width. Each branch
        // carries its own spacing/typography so swapping them doesn't
        // shift adjacent layout.
        Item {
          id: body
          width: parent.width
          implicitHeight: bodyColumn.implicitHeight

          Column {
            id: bodyColumn
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            spacing: Style.space(8)

            // Idle — no query yet.
            Column {
              width: parent.width
              visible: root.status === "idle"
              spacing: Style.space(6)

              Text {
                width: parent.width
                text: "Type a word in the field above, then press Enter to look it up."
                color: Qt.darker(root.contentForeground, 1.3)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
              }

              Text {
                width: parent.width
                text: "Definitions come from api.dictionaryapi.dev — no account or key required."
                color: Qt.darker(root.contentForeground, 1.7)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
              }
            }

            // Loading. The Omarchy UI kit doesn't ship a spinner component,
            // so the magnify glyph is reused and rotated indefinitely while
            // a fetch is in flight.
            Row {
              visible: root.status === "loading"
              spacing: Style.space(10)
              width: parent.width

              Item {
                width: Style.space(18)
                height: Style.space(18)
                anchors.verticalCenter: parent.verticalCenter

                Text {
                  anchors.centerIn: parent
                  text: "󰗚"
                  color: Color.accent
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.title
                  transformOrigin: Item.Center

                  NumberAnimation on rotation {
                    from: 0
                    to: 360
                    duration: 900
                    loops: Animation.Infinite
                    running: root.status === "loading"
                  }
                }
              }

              Text {
                text: "Looking up \"" + root.query + "\"…"
                color: Qt.darker(root.contentForeground, 1.3)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                anchors.verticalCenter: parent.verticalCenter
              }
            }

            // Suggestions from the local fuzzy match.
            Column {
              width: parent.width
              visible: root.status === "suggestions"
              spacing: Style.space(8)

              Text {
                width: parent.width
                text: "No definition for \"" + (root.originalQuery || root.query) + "\"."
                color: Qt.darker(root.contentForeground, 1.0)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
              }

              Text {
                width: parent.width
                text: "Did you mean:"
                color: Qt.darker(root.contentForeground, 1.4)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
                font.letterSpacing: 1.0
              }

              // Chip row — one clickable Button per candidate.
              Flow {
                width: parent.width
                spacing: Style.space(6)

                Repeater {
                  model: root.suggestions

                  Button {
                    required property string modelData
                    text: modelData
                    foreground: root.contentForeground
                    onClicked: root.search(modelData)
                  }
                }
              }
            }

            // Not found (no fuzzy candidates).
            Column {
              width: parent.width
              visible: root.status === "notfound"
              spacing: Style.space(4)

              Text {
                width: parent.width
                text: "No definition for \"" + root.query + "\"."
                color: Qt.darker(root.contentForeground, 1.0)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
              }

              Text {
                width: parent.width
                visible: root.statusMessage !== ""
                text: root.statusMessage
                color: Qt.darker(root.contentForeground, 1.5)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
              }
            }

            // Error.
            Column {
              width: parent.width
              visible: root.status === "error"
              spacing: Style.space(4)

              Text {
                width: parent.width
                text: "Couldn't look up \"" + root.query + "\"."
                color: Qt.darker(root.contentForeground, 1.0)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
              }

              Text {
                width: parent.width
                text: root.statusMessage
                color: Qt.darker(root.contentForeground, 1.5)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
              }
            }
          }
        }

        // ---------- Results: word header + scrollable meaning list ----------
        Column {
          width: parent.width
          spacing: Style.space(10)
          visible: root.status === "ok" && root.entry !== null

          // Auto-match note. Only rendered when the user's original query
          // was misspelled and we silently fetched the closest match.
          // The text body is computed by a JS function so the ternary
          // doesn't evaluate the .word property on a null entry — that
          // pattern raises "Cannot read property 'word' of null" in QML
          // because it pre-evaluates both sides of `?:`.
          Text {
            width: parent.width
            visible: root.isAutoMatched && root.originalQuery !== "" && root.entry !== null
            text: root.autoMatchedNote()
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.italic: true
            wrapMode: Text.WordWrap
          }

          Row {
            width: parent.width
            spacing: Style.space(10)

            Text {
              id: wordText
              text: root.entryWord()
              color: root.contentForeground
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.display
              font.bold: true
              elide: Text.ElideRight
              width: parent.width - phoneticLabel.width - sourceTag.width - Style.space(20)
              anchors.verticalCenter: parent.verticalCenter
            }

            Text {
              id: phoneticLabel
              text: root.entryPhonetic()
              color: Qt.darker(root.contentForeground, 1.3)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.body
              font.italic: true
              anchors.verticalCenter: parent.verticalCenter
              visible: text !== ""
            }

            // Small muted source tag (e.g. "Wiktionary") to make it obvious
            // which data source filled the panel.
            Text {
              id: sourceTag
              text: root.entry ? Model.sourceLabel(entry) : ""
              color: Qt.darker(root.contentForeground, 1.55)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.caption
              font.italic: true
              anchors.verticalCenter: parent.verticalCenter
              visible: text !== ""
            }
          }

          Flickable {
            id: resultScroll
            width: parent.width
            height: Math.min(
              root.panelMaxHeight - Style.space(320),
              Math.max(Style.space(160), root.entry
                ? Math.min(Style.space(540), meaningStack.implicitHeight + Style.space(16))
                : Style.space(160))
            )
            contentWidth: width
            contentHeight: meaningStack.implicitHeight + Style.space(16)
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Column {
              id: meaningStack
              width: resultScroll.width
              spacing: Style.space(14)

              Repeater {
                model: root.entry ? root.entry.meanings : []

                Column {
                  required property var modelData
                  required property int index
                  width: parent.width
                  spacing: Style.space(6)

                  Row {
                    width: parent.width
                    spacing: Style.space(8)

                    Text {
                      text: modelData.partOfSpeech
                      color: Color.accent
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.caption
                      font.bold: true
                      font.letterSpacing: 1.4
                      font.italic: true
                      anchors.verticalCenter: parent.verticalCenter
                    }

                    Rectangle {
                      width: parent.width - implicitWidth - Style.space(8)
                      height: Style.spacing.hairline
                      color: Qt.darker(root.contentForeground, 1.9)
                      anchors.verticalCenter: parent.verticalCenter
                    }
                  }

                  Repeater {
                    model: modelData.definitions

                    Column {
                      required property var modelData
                      required property int index
                      width: parent.width
                      spacing: Style.space(2)

                      Row {
                        width: parent.width
                        spacing: Style.space(8)

                        Text {
                          text: (index + 1) + "."
                          color: Qt.darker(root.contentForeground, 1.5)
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.body
                          width: Style.space(20)
                          horizontalAlignment: Text.AlignRight
                          anchors.top: parent.top
                          anchors.topMargin: 2
                        }

                        Text {
                          width: parent.width - Style.space(20) - Style.space(8)
                          text: modelData.definition
                          color: root.contentForeground
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.body
                          wrapMode: Text.WordWrap
                        }
                      }

                      Text {
                        width: parent.width - Style.space(20) - Style.space(8)
                        x: Style.space(20) + Style.space(8)
                        visible: modelData.example !== ""
                        text: "\"" + modelData.example + "\""
                        color: Qt.darker(root.contentForeground, 1.3)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        font.italic: true
                        wrapMode: Text.WordWrap
                      }
                    }
                  }

                  Text {
                    visible: modelData.synonyms.length > 0
                    width: parent.width
                    text: "synonyms: " + modelData.synonyms.join(", ")
                    color: Qt.darker(root.contentForeground, 1.5)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    wrapMode: Text.WordWrap
                  }

                  Text {
                    visible: modelData.antonyms.length > 0
                    width: parent.width
                    text: "antonyms: " + modelData.antonyms.join(", ")
                    color: Qt.darker(root.contentForeground, 1.5)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    wrapMode: Text.WordWrap
                  }
                }
              }

              Item {
                width: parent.width
                height: Style.space(4)
              }
            }
          }
        }
      }
    }
  }
}
