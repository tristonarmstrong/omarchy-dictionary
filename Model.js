// Dictionary API helpers. Pure data + URL building — no Qt, no Quickshell — so
// the same parse/build logic could be unit tested under node. The QML side
// owns the network call (curl via Process), text-field state, and rendering.

// ---- Languages ----
//
// Data-driven list of supported target languages. Each entry carries a
// BC-47-ish `value` (the dropdown's stored value), an English `label`
// for the menu, and the native `wikiName` — the heading Wiktionary uses
// for its own language section in that edition (e.g. "English" on
// en.wikt, "ภาษาไทย" on th.wikt, "日本語" on ja.wikt). The native name is
// what the parser matches against, so getting it right is the
// difference between a clean parse and an empty meaning[] on the
// first lookup.
//
// Languages are listed roughly by coverage depth; the dropdown sorts
// them alphabetically by English label. The Free Dictionary per-language
// API isn't currently exercised — see apiBase below.
var LANGUAGES = [
  { value: "ar", label: "Arabic",        wikiName: "Arabic" },
  { value: "bn", label: "Bengali",       wikiName: "Bengali" },
  { value: "zh", label: "Chinese",       wikiName: "Chinese" },
  { value: "nl", label: "Dutch",         wikiName: "Dutch" },
  { value: "en", label: "English",       wikiName: "English" },
  { value: "fr", label: "French",        wikiName: "French" },
  { value: "de", label: "German",        wikiName: "German" },
  { value: "hi", label: "Hindi",         wikiName: "Hindi" },
  { value: "id", label: "Indonesian",    wikiName: "Indonesian" },
  { value: "it", label: "Italian",       wikiName: "Italian" },
  { value: "ja", label: "Japanese",      wikiName: "日本語" },
  { value: "ko", label: "Korean",        wikiName: "한국어" },
  { value: "ms", label: "Malay",         wikiName: "Malay" },
  { value: "fa", label: "Persian",       wikiName: "Persian" },
  { value: "pl", label: "Polish",        wikiName: "Polish" },
  { value: "pt", label: "Portuguese",    wikiName: "Portuguese" },
  { value: "ru", label: "Russian",       wikiName: "Russian" },
  { value: "es", label: "Spanish",       wikiName: "Spanish" },
  { value: "sw", label: "Swahili",       wikiName: "Swahili" },
  { value: "sv", label: "Swedish",       wikiName: "Swedish" },
  { value: "th", label: "Thai",          wikiName: "ภาษาไทย" },
  { value: "tr", label: "Turkish",       wikiName: "Turkish" },
  { value: "vi", label: "Vietnamese",    wikiName: "Vietnamese" }
].sort(function (a, b) { return a.label.localeCompare(b.label) })

var LANG_BY_VALUE = {}
for (var i = 0; i < LANGUAGES.length; i++) LANG_BY_VALUE[LANGUAGES[i].value] = LANGUAGES[i]

function langLabel(value) {
  var l = LANG_BY_VALUE[String(value || "en").toLowerCase()]
  return l ? l.label : String(value || "en")
}
function langWikiName(value) {
  var l = LANG_BY_VALUE[String(value || "en").toLowerCase()]
  return l ? l.wikiName : "English"
}

function defaultLanguage() { return "en" }

function languages() { return LANGUAGES }

// ---- API layer ----
//
// URL construction for the Wiktionary MediaWiki extracts endpoint and
// the curl argv array that the QML Process element runs.
function apiBase(langCode) {
  var code = String(langCode || defaultLanguage()).trim().toLowerCase() || defaultLanguage()
  return "https://" + code + ".wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles="
}

// Build the curl argv for a single word lookup. encodeURIComponent is run by
// curl itself via the URL we hand it, but pre-encoding here keeps the visible
// fetch URL stable for logging / debugging. The User-Agent is required by
// the Wikimedia API ToS.
function lookupArgs(word, langCode) {
  var w = String(word || "").trim()
  if (w === "") return []
  return [
    "curl", "-fsS", "--max-time", "5",
    "-H", "User-Agent: omarchy-dictionary/1.0 (Wiktionary prototype)",
    apiBase(langCode) + encodeURIComponent(w)
  ]
}

// ---- Response parsing & normalisation ----
//
// Turns raw API response text (or legacy Free Dictionary JSON) into the
// canonical { word, phonetic, audioUrl, source, language, meanings } shape.
// The Wiktionary branch delegates the heavy lifting to the extract parser
// below; the Free Dictionary branch normalises in place.
function parseResponse(raw, langCode) {
  var text = String(raw || "").trim()
  if (text === "") {
    return { ok: false, kind: "empty", error: "empty response" }
  }
  var data = null
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, kind: "invalid", error: "could not parse response" }
  }
  if (!data || typeof data !== "object") {
    return { ok: false, kind: "invalid", error: "could not parse response" }
  }

  // Wiktionary envelope: { query: { pages: { "<id>": { ... } } } }
  if (data.query && data.query.pages && typeof data.query.pages === "object") {
    var pages = data.query.pages
    var pageIds = Object.keys(pages)
    if (pageIds.length === 0) {
      return { ok: false, kind: "empty", error: "no entry returned" }
    }
    var page = pages[pageIds[0]]
    if (!page || page.missing !== undefined) {
      return {
        ok: false,
        kind: "notfound",
        error: "no entry for \"" + (page && page.title ? page.title : "word") + "\""
      }
    }
    var extract = page.extract != null ? String(page.extract).trim() : ""
    if (extract === "") {
      return { ok: false, kind: "empty", error: "no extract returned" }
    }
    var entry = normalizeEntry(page, langCode)
    if (!entry) return { ok: false, kind: "empty", error: "no entry returned" }
    return { ok: true, entry: entry, variants: pageIds.length }
  }

  // Free Dictionary legacy shapes — preserved so rollback is a one-line
  // change. The legacy Free Dictionary used a top-level JSON array of
  // entries with `title`/`message` for not-found responses.
  if (!Array.isArray(data) && data.title && data.message) {
    return {
      ok: false,
      kind: "notfound",
      error: String(data.message),
      hint: data.resolution ? String(data.resolution) : ""
    }
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, kind: "empty", error: "no entry returned" }
  }

  var legacyEntry = normalizeEntry(data[0], langCode)
  if (!legacyEntry) return { ok: false, kind: "empty", error: "no entry returned" }
  return { ok: true, entry: legacyEntry, variants: data.length }
}

// Normalize one entry into the shape the panel renders. Drops anything that
// isn't a primitive string/array; the API occasionally returns nulls.
//
// Two shapes accepted:
//   - Wiktionary page: { title, extract, ... }
//     The extract is plain text with the MediaWiki `=`/`==`/`===` section
//     markers preserved. parseWiktionaryWikitext walks it tree-wise
//     (language → parts-of-speech → defs) and emits a clean structured
//     entry — see that function below for the section parser.
//   - Free Dictionary entry: { word, phonetic, phonetics, meanings, ... }
//     Existing logic.
function normalizeEntry(raw, langCode) {
  if (!raw || typeof raw !== "object") return null

  // Wiktionary branch.
  if (raw.extract != null) {
    var word = String(raw.title || "").trim()
    if (word === "") return null
    return parseWiktionaryWikitext(word, raw.extract, langCode)
  }

  // Free Dictionary branch.
  var word = String(raw.word || "").trim()
  if (word === "") return null

  var phonetic = String(raw.phonetic || "").trim()
  if (phonetic === "" && Array.isArray(raw.phonetics)) {
    for (var i = 0; i < raw.phonetics.length; i++) {
      var p = raw.phonetics[i]
      if (p && typeof p === "object" && p.text) {
        phonetic = String(p.text).trim()
        if (phonetic !== "") break
      }
    }
  }

  var audioUrl = ""
  if (Array.isArray(raw.phonetics)) {
    for (var j = 0; j < raw.phonetics.length; j++) {
      var ph = raw.phonetics[j]
      if (ph && typeof ph === "object" && ph.audio && String(ph.audio).trim() !== "") {
        audioUrl = String(ph.audio).trim()
        break
      }
    }
  }

  var meanings = []
  if (Array.isArray(raw.meanings)) {
    for (var k = 0; k < raw.meanings.length; k++) {
      var m = normalizeMeaning(raw.meanings[k])
      if (m) meanings.push(m)
    }
  }

  if (meanings.length === 0) return null

  return {
    word: word,
    phonetic: phonetic,
    audioUrl: audioUrl,
    source: "dictionaryapi",
    meanings: meanings
  }
}

function normalizeMeaning(raw) {
  if (!raw || typeof raw !== "object") return null
  var pos = String(raw.partOfSpeech || "").trim()
  if (pos === "") return null

  var defs = []
  if (Array.isArray(raw.definitions)) {
    for (var i = 0; i < raw.definitions.length; i++) {
      var d = normalizeDefinition(raw.definitions[i])
      if (d) defs.push(d)
    }
  }

  if (defs.length === 0) return null

  return {
    partOfSpeech: pos,
    definitions: defs,
    synonyms: stringList(raw.synonyms),
    antonyms: stringList(raw.antonyms)
  }
}

function normalizeDefinition(raw) {
  if (!raw || typeof raw !== "object") return null
  var text = String(raw.definition || "").trim()
  if (text === "") return null
  return {
    definition: text,
    example: raw.example ? String(raw.example).trim() : "",
    synonyms: stringList(raw.synonyms),
    antonyms: stringList(raw.antonyms)
  }
}

function stringList(value) {
  if (!Array.isArray(value)) return []
  var out = []
  for (var i = 0; i < value.length; i++) {
    var s = String(value[i] || "").trim()
    if (s !== "") out.push(s)
  }
  return out
}

// ---- Wiktionary extract parser ----
//
// The extracts endpoint returns plain text with the MediaWiki section
// markers left in: `==` for language, `===` for major subsections
// inside a language (Pronunciation, Etymology, parts of speech), and
// `====` for sub-subsections — often useful, since for words with
// multiple etymologies the parts-of-speech sit at level 4
// (`set`'s `Verb` under `Etymology 1`, for example). explaintext=1
// already strips templates and formatting; what we have to do is
// structural: turn this:
//
//   == English ==
//   === Etymology 1 ===
//   ==== Noun ====
//   apple (plural apples)
//   A common, round fruit...
//
// into:
//
//   { partOfSpeech: "noun", definitions: [{ definition: "A common, round fruit..." }] }

function parseSections(text) {
  text = String(text || "").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "")
  var root = { level: 1, title: "", body: "", children: [] }
  var stack = [root]
  var lines = text.split("\n")
  for (var i = 0; i < lines.length; i++) {
    var m = /^(={2,5})\s*([^{}=\n][^{}=\n]*?)\s*\1\s*$/.exec(lines[i])
    if (m) {
      var lvl = m[1].length
      while (stack.length > 1 && stack[stack.length - 1].level >= lvl) stack.pop()
      var sec = { level: lvl, title: String(m[2]).trim(), body: "", children: [] }
      stack[stack.length - 1].children.push(sec)
      stack.push(sec)
    } else if (stack.length > 1) {
      var top = stack[stack.length - 1]
      top.body += (top.body ? "\n" : "") + lines[i]
    }
  }
  return root.children
}

function stripInlineHeaders(text) {
  return String(text || "").replace(/^={2,}[^\n=].{0,80}?={2,}\s*$/gm, "").trim()
}

var WIKT_POS_KEYS = {
  noun: 1, verb: 1, adjective: 1, adj: 1, adverb: 1, adv: 1,
  pronoun: 1, preposition: 1, postposition: 1, particle: 1,
  interjection: 1, conjunction: 1, determiner: 1, article: 1,
  numeral: 1, contraction: 1, letter: 1, symbol: 1, initialism: 1,
  prefix: 1, suffix: 1, infix: 1, circumfix: 1, "combining form": 1,
  phrase: 1, idiom: 1, proverb: 1, clause: 1, predicative: 1,
  "auxiliary verb": 1, "modal verb": 1, "proper noun": 1, name: 1,
  ordinal: 1, cardinal: 1, gerund: 1, participle: 1, infinitive: 1
}
var WIKT_SKIP_DROP = {
  translations: 1, "derived terms": 1, "related terms": 1,
  descendants: 1, references: 1, "further reading": 1,
  anagrams: 1, conjugation: 1, declension: 1, inflection: 1,
  "see also": 1, "external links": 1, quotations: 1,
  homophones: 1, hyponyms: 1, hypernyms: 1,
  meronyms: 1, holonyms: 1, troponyms: 1,
  "coordinate terms": 1, "alternative forms": 1,
  synonyms: 1, antonyms: 1, "usage notes": 1
}

function wiktCanonicalPos(t) {
  if (t === "adj") return "adjective"
  if (t === "adv") return "adverb"
  if (t === "auxiliary verb" || t === "modal verb" || t === "gerund" ||
      t === "participle" || t === "infinitive") return "verb"
  if (t === "proper noun" || t === "name") return "noun"
  return t
}

function wiktExtractIpa(body) {
  var m = /IPA[^:\n]*:\s*\/([^\n/]+)\//.exec(body)
  if (m) return "/" + m[1] + "/"
  var m2 = /IPA[^:\n]*:\s*\[([^\n\]]+)\]/.exec(body)
  if (m2) return "[" + m2[1] + "]"
  return ""
}

function wiktIsInflectionLine(line, headword) {
  if (!line || line.indexOf("(") < 0) return false
  var openIdx = line.indexOf("(")
  var closeIdx = line.lastIndexOf(")")
  if (openIdx < 0 || closeIdx < 0 || closeIdx !== line.length - 1) return false
  var head = line.substring(0, openIdx).trim().toLowerCase()
  var annot = line.substring(openIdx + 1, closeIdx)
  if (!head || !annot) return false
  var heads = head.split(/[,\s]+/).filter(Boolean)
  if (!heads.length) return null
  var hw = String(headword || "").trim().toLowerCase()
  var headOK = true
  for (var i = 0; i < heads.length; i++) {
    var p = heads[i]
    if (p === hw || p === hw + "s" || p === hw + "es") continue
    if (/^[a-z]+'$/.test(p)) continue
    if (/^[a-z]+$/.test(p)) continue
    headOK = false
    break
  }
  if (!headOK) return false
  return /third-person|present participle|simple past|past participle|plural|comparative|superlative|diminutive|feminine|masculine|neuter|genitive|nominative|accusative|dative|ablative|not comparable|UK|US|dialectal|imperative|auxiliary|conjugation|^by$|predicative/i.test(annot)
}

function wiktExtractDefs(headword, body) {
  var t = stripInlineHeaders(String(body || "").replace(/\s+$/, "").trim())
  if (!t) return []
  var blocks = t.split(/\n\s*\n/)

  if (blocks.length) {
    var first = blocks[0]
    var fLines = first.split("\n")
    if (fLines.length === 1) {
      var stripped = fLines[0].replace(/[^a-zA-Z\s,]/g, "").trim().toLowerCase()
      var hw = String(headword || "").trim().toLowerCase()
      var parts = stripped.split(/[,\s]+/).filter(Boolean)
      var headMatch = parts.length > 0
      for (var i = 0; i < parts.length && headMatch; i++) {
        var p = parts[i]
        if (p === hw || p === hw + "s" || p === hw + "es") continue
        if (/^[a-z]+'$/.test(p)) continue
        if (/^[a-z]+$/.test(p)) continue
        headMatch = false
      }
      if (headMatch || wiktIsInflectionLine(first, headword)) blocks.shift()
    }
  }

  var skipRE = /^\s*(Synonyms?|Antonyms?|Coordinate terms?|Related terms?|Derived terms?|For more quotations using this term|Usage notes|See also|External links|Trivia|Footnotes|Source|Notes|History|Compare|Quotations|Anagram)/i
  var attrStartRE = /^(?:[12]\d{3}|January|February|March|April|May|June|July|August|September|October|November|December|c\.|circa|ca\.)\b/
  var onlyLabelRE = /^\([A-Za-z][A-Za-z ,]*\)\s*$/
  var numberRangeRE = /^\d+\s*-\s*\d+,\s*\d/

  var defs = []
  function emit(text) {
    var s = String(text || "").replace(/\s+$/, "").trim()
    if (!s) return
    if (/^\[[^\]]+\]\s*$/.test(s)) return
    if (attrStartRE.test(s)) return
    if (onlyLabelRE.test(s)) return
    if (numberRangeRE.test(s)) return
    if (s.length < 8) return
    defs.push({ definition: s, example: "", synonyms: [], antonyms: [] })
  }

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim()
    if (!block) continue
    if (/^Alternative forms\s+of\s+/i.test(block)) continue
    var bLines = block.split("\n")
    for (var j = 0; j < bLines.length; j++) {
      var line = bLines[j].replace(/\s+$/, "").trim()
      if (!line) continue
      if (skipRE.test(line)) continue
      if (line.charAt(0) === "*") line = line.substring(1).trim()
      if (attrStartRE.test(line)) {
        if (j + 1 < bLines.length) {
          var next = bLines[j + 1].replace(/\s+$/, "").trim()
          if (next && !skipRE.test(next) && !attrStartRE.test(next) &&
              !onlyLabelRE.test(next) && next.length >= 12) {
            emit(line + " — " + next)
            j++
          }
        }
        continue
      }
      emit(line)
    }
  }
  return defs
}

function parseWiktionaryWikitext(headword, rawText, langCode) {
  var top = parseSections(rawText)
  if (!top.length) return null

  // Prefer "== English ==". Fallback to the first level-2 (e.g. a word
  // Pick the language section for this lookup. Wiktionary renders the
  // section heading in the edition's native script — "ภาษาไทย" on
  // th.wiktionary, "日本語" on ja.wiktionary, "English" on en.wiktionary
  // — so we match against LANG_BY_VALUE's `wikiName` rather than the
  // English label. If that misses (e.g. wiktionary changed their naming
  // convention) we fall back to the first level-2 section.
  var target = String(langCode || defaultLanguage()).toLowerCase()
  var targetName = langWikiName(target).toLowerCase()
  var labelLower = langLabel(target).toLowerCase()
  var lang = null
  for (var i = 0; i < top.length; i++) {
    var t = top[i]
    if (t.level !== 2) continue
    var titleLower = t.title.toLowerCase()
    if (titleLower === targetName || titleLower === labelLower) {
      lang = t
      break
    }
  }
  if (!lang) {
    for (var i = 0; i < top.length; i++) {
      if (top[i].level === 2) { lang = top[i]; break }
    }
  }
  if (!lang) return null

  // Strict mode for English (where POS names map to known keys). Loose
  // mode elsewhere: any level-3 subsection whose body has real defs is
  // surfaced with its raw title as the part-of-speech — useful until
  // we accumulate per-language POS dictionaries (Thai/Japanese/etc.).
  var loose = target !== "en"

  var meanings = []
  var phonetic = ""

  function visit(node) {
    var key = node.title.toLowerCase().trim()
    var keyBase = key.replace(/\s+\d+$/, "")
    if (key === "pronunciation") {
      phonetic = wiktExtractIpa(node.body) || phonetic
      return
    }
    if (key === "etymology" || keyBase === "etymology") {
      for (var i = 0; i < node.children.length; i++) visit(node.children[i])
      return
    }
    if (WIKT_SKIP_DROP[key]) return
    if (WIKT_POS_KEYS[key]) {
      var defs = wiktExtractDefs(headword, node.body)
      if (defs.length) {
        meanings.push({
          partOfSpeech: wiktCanonicalPos(key),
          definitions: defs,
          synonyms: [],
          antonyms: []
        })
      }
      return
    }
    if (loose && node.level === 3) {
      var looseDefs = wiktExtractDefs(headword, node.body)
      if (looseDefs.length && node.title.trim().length > 0 && node.title.trim().length < 30) {
        meanings.push({
          partOfSpeech: node.title.trim(),
          definitions: looseDefs,
          synonyms: [],
          antonyms: []
        })
        return
      }
    }
    for (var i = 0; i < node.children.length; i++) visit(node.children[i])
  }

  for (var i = 0; i < lang.children.length; i++) visit(lang.children[i])

  if (!meanings.length) return null
  return {
    word: String(headword || "").trim(),
    phonetic: phonetic,
    audioUrl: "",
    source: "wiktionary",
    language: target,
    meanings: meanings
  }
}

// ---- Display helpers ----
//
// Pure formatting functions that turn parsed entry data into short
// UI labels. No I/O, no side effects.

// Short status line for the hero label under the search box.
function summaryLabel(entry) {
  if (!entry || !entry.meanings) return ""
  var pos = []
  for (var i = 0; i < entry.meanings.length; i++) {
    if (entry.meanings[i] && entry.meanings[i].partOfSpeech) {
      pos.push(entry.meanings[i].partOfSpeech)
    }
  }
  return pos.join(" · ")
}

// Display label for the data source, surfaced as a small muted tag in the
// panel header. Empty when the entry doesn't carry a source field.
function sourceLabel(entry) {
  if (!entry || !entry.source) return ""
  if (entry.source === "wiktionary") return "Wiktionary"
  if (entry.source === "dictionaryapi") return "Free Dictionary"
  return String(entry.source)
}

// ---- Fuzzy match ----
//
// The Free Dictionary API returns 404 for anything not exactly in its index,
// so a misspelled query gets nothing. We compile a local wordlist (Google
// 10K, lowercase, deduped) and compute Levenshtein distance against the
// input to surface "did you mean?" candidates.
//
// Sizing notes:
//   - 10K words × ~5 letters each → ~50ms for an exhaustive scan on first
//     run in the QML engine. Subsequent runs hit the same hot path. If this
//     shows up in a profile the obvious prefilter is the first-letter and
//     length-difference checks below.
//   - We only emit candidates within edit distance 2 of the input; the
//     normalized score (distance / max length) is what decides confidence.
//
// Return shape:
//   { autoMatch: "hello", alternatives: [] }           — single clear winner
//   { autoMatch: null,   alternatives: [..., ] }      — reviewable alternatives
//   { autoMatch: null,   alternatives: [] }            — nothing within threshold

// Levenshtein edit distance. Two rolling rows, no allocations past the
// initial buffer; the smaller string drives the inner loop so the cost
// is O(|a| · |b|) with |b| ≤ |a|.
function levenshtein(a, b) {
  if (a === b) return 0
  var al = a.length, bl = b.length
  if (al === 0) return bl
  if (bl === 0) return al
  // Make sure v1 is the shorter side to keep work bounded.
  if (al < bl) {
    var tmp = a; a = b; b = tmp
    var tlen = al; al = bl; bl = tlen
  }
  var v0 = []; var v1 = []
  for (var i = 0; i <= bl; i++) v0[i] = i
  for (var i = 0; i < al; i++) {
    v1[0] = i + 1
    var ai = a.charCodeAt(i)
    for (var j = 0; j < bl; j++) {
      var cost = ai === b.charCodeAt(j) ? 0 : 1
      // min of: insert (v1[j]+1), delete (v0[j+1]+1), substitute (v0[j]+cost)
      var ins = v1[j] + 1
      var del = v0[j + 1] + 1
      var sub = v0[j] + cost
      var m = ins < del ? ins : del
      if (sub < m) m = sub
      v1[j + 1] = m
    }
    var swap = v0; v0 = v1; v1 = swap
  }
  return v0[bl]
}


// English wordlist for fuzzy matching. Loaded from the standalone wordlist.js
// file and injected via setWordlist() at panel init time. The list is not
// inlined here to keep this file focused on logic.
var _WORDLIST = []

function setWordlist(list) {
  if (Array.isArray(list)) _WORDLIST = list
}

const AUTO_MATCH_MAX_NORMALIZED = 0.22    // ("helllo" -> "hello" = 0.14, well under)
const ALTERNATIVES_MAX_NORMALIZED = 0.40   // distance / max length
const ALTERNATIVES_DISTANCE_LIMIT = 3     // hard cap on raw edits
const AUTO_MATCH_GAP = 0.08                // next candidate must trail by at least this much in score
const ALTERNATIVES_TO_SHOW = 3

function fuzzyMatch(rawQuery) {
  var query = String(rawQuery || "").toLowerCase().trim()
  // Drop anything that isn't a letter — the API path encodes the same query
  // verbatim, but for suggestions we only want word-shaped strings.
  var q = ""
  for (var i = 0; i < query.length; i++) {
    var ch = query.charCodeAt(i)
    if ((ch >= 97 && ch <= 122) ||
        ch === 0xe9 || ch === 0xe8 || ch === 0xea || ch === 0xeb ||
        ch === 0xe0 || ch === 0xe2 || ch === 0xee || ch === 0xef ||
        ch === 0xf1) {
      q += query[i]
    }
  }
  if (q.length < 2) return { autoMatch: null, alternatives: [] }

  var qlen = q.length
  var results = []
  for (var k = 0; k < _WORDLIST.length; k++) {
    var w = _WORDLIST[k]
    var wlen = w.length
    // First-letter and length prefilters. Length diff is loose here;
    // the score below penalizes large gaps all the same.
    if (w.charAt(0) !== q.charAt(0)) continue
    if (Math.abs(wlen - qlen) > ALTERNATIVES_DISTANCE_LIMIT) continue
    var d = levenshtein(q, w)
    if (d > ALTERNATIVES_DISTANCE_LIMIT) continue
    // Normalized score: 0 = identical, larger = worse. The longest-side
    // length is the denom so a 1-edit typo on a 12-letter word scores
    // better than the same typo on a 3-letter word.
    var score = d / Math.max(qlen, wlen)
    results.push({ word: w, distance: d, score: score })
  }

  // Sort by score (best = smallest), then by absolute distance, then by
  // closer-length match, then alphabetical as a stable final tiebreak.
  results.sort(function (a, b) {
    if (a.score !== b.score) return a.score - b.score
    if (a.distance !== b.distance) return a.distance - b.distance
    var ad = Math.abs(a.word.length - qlen)
    var bd = Math.abs(b.word.length - qlen)
    if (ad !== bd) return ad - bd
    if (a.word < b.word) return -1
    if (a.word > b.word) return 1
    return 0
  })

  // Tally inside the candidate-quality threshold. Outside it the words
  // are too distant to be a useful typo correction.
  var inBand = []
  for (var r = 0; r < results.length; r++) {
    if (results[r].score > ALTERNATIVES_MAX_NORMALIZED) break
    inBand.push(results[r])
  }

  if (inBand.length === 0) return { autoMatch: null, alternatives: [] }

  var top = inBand[0]
  var autoOk = top.score <= AUTO_MATCH_MAX_NORMALIZED &&
               (inBand.length === 1 ||
                (inBand[1].score - top.score) >= AUTO_MATCH_GAP)
  if (autoOk) return { autoMatch: top.word, alternatives: [] }

  // Ambiguous — surface the top alternatives so the user can pick one.
  var alts = []
  for (var n = 0; n < inBand.length && n < ALTERNATIVES_TO_SHOW; n++) {
    alts.push(inBand[n].word)
  }
  return { autoMatch: null, alternatives: alts }
}
