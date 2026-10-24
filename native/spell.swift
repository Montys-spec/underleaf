// underleaf-spell: macOS spell checking for Underleaf over stdin/stdout.
// Each request and response is one line of JSON, matched by "id".
import AppKit
import NaturalLanguage

struct Request: Decodable {
  let id: Int
  let cmd: String
  let lang: String?
  let words: [String]?
  let word: String?
  let text: String?
}

let checker = NSSpellChecker.shared

/// Maps a language code to one the spell checker has a dictionary for ("en" may be "en_US").
func resolve(_ lang: String?) -> String? {
  guard let lang = lang, !lang.isEmpty else { return nil }
  let available = checker.availableLanguages
  if available.contains(lang) { return lang }
  let base = String(lang.prefix(2))
  return available.first { $0 == base } ?? available.first { $0.hasPrefix(base) }
}

func isMisspelled(_ word: String, _ lang: String?) -> Bool {
  let range = checker.checkSpelling(of: word, startingAt: 0, language: lang, wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
  return range.location != NSNotFound
}

func reply(_ obj: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) {
    print(line)
    fflush(stdout)
  }
}

while let line = readLine() {
  guard let data = line.data(using: .utf8), let req = try? JSONDecoder().decode(Request.self, from: data) else { continue }
  let lang = resolve(req.lang)
  switch req.cmd {
  case "check":
    let words = req.words ?? []
    reply(["id": req.id, "misspelled": words.filter { isMisspelled($0, lang) }])
  case "suggest":
    let word = req.word ?? ""
    let range = NSRange(location: 0, length: (word as NSString).length)
    let guesses = checker.guesses(forWordRange: range, in: word, language: lang, inSpellDocumentWithTag: 0) ?? []
    reply(["id": req.id, "suggestions": Array(guesses.prefix(8))])
  case "learn":
    if let word = req.word { checker.learnWord(word) }
    reply(["id": req.id])
  case "detect":
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(req.text ?? "")
    let detected = recognizer.dominantLanguage?.rawValue
    reply(["id": req.id, "lang": resolve(detected) ?? NSNull()])
  case "languages":
    reply(["id": req.id, "languages": checker.availableLanguages])
  default:
    reply(["id": req.id, "error": "unknown command"])
  }
}
