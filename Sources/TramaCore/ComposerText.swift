import Foundation

/// What the composer opens at the cursor: the mention menu, the command menu or the skill menu.
public enum ComposerTriggerKind: Equatable, Sendable {
    case mention
    case slashCommand
    case skill
}

/// A trigger and the text it would replace. Offsets are UTF-16, as in `NSTextView`.
public struct ComposerTrigger: Equatable, Sendable {
    public var kind: ComposerTriggerKind
    public var query: String
    public var rangeStart: Int
    public var rangeEnd: Int

    public init(kind: ComposerTriggerKind, query: String, rangeStart: Int, rangeEnd: Int) {
        self.kind = kind
        self.query = query
        self.rangeStart = rangeStart
        self.rangeEnd = rangeEnd
    }
}

/// Plain-text rules of the composer, ported from Synara's `composer-logic.ts`.
public enum ComposerText {
    /// Finds the trigger that ends at `cursor`.
    ///
    /// A command is a `/` at line start or after whitespace; a query containing `/` is a typed path
    /// and opens nothing. A `$` token opens the skills. A mention is a word that starts with `@`, or
    /// an unclosed `@"` that may contain spaces; `user@host` opens nothing.
    public static func detectTrigger(in text: String, cursor: Int) -> ComposerTrigger? {
        let string = text as NSString
        let end = min(max(cursor, 0), string.length)
        let newline = string.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: end))
        let lineStart = newline.location == NSNotFound ? 0 : newline.location + 1
        let line = string.substring(with: NSRange(location: lineStart, length: end - lineStart)) as NSString

        if let slash = commandStart(in: line) {
            let candidate: String = line.substring(from: slash)
            if matches(candidate, #"^/\S*$"#) {
                let query = String(candidate.dropFirst())
                if query.contains("/") { return nil }
                return ComposerTrigger(kind: .slashCommand, query: query, rangeStart: lineStart + slash, rangeEnd: end)
            }
        }

        let space = line.rangeOfCharacter(from: CharacterSet.whitespaces, options: NSString.CompareOptions.backwards)
        let tokenStart = space.location == NSNotFound ? 0 : space.location + 1
        let token: String = line.substring(from: tokenStart)
        if token.hasPrefix("$") {
            return ComposerTrigger(kind: .skill, query: String(token.dropFirst()), rangeStart: lineStart + tokenStart, rangeEnd: end)
        }

        if let quoted = openQuotedMention(in: line) {
            return ComposerTrigger(kind: .mention, query: quoted.query, rangeStart: lineStart + quoted.start, rangeEnd: end)
        }

        guard token.hasPrefix("@") else { return nil }
        let tokenString = token as NSString
        let lastAt = tokenString.range(of: "@", options: NSString.CompareOptions.backwards).location
        let piece: String = tokenString.substring(from: lastAt)
        guard matches(piece, #"^@[^()\s@]*$"#) else { return nil }
        return ComposerTrigger(kind: .mention, query: String(piece.dropFirst()), rangeStart: lineStart + tokenStart + lastAt, rangeEnd: end)
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: String.CompareOptions.regularExpression) != nil
    }

    /// Replaces the UTF-16 range `start..<end` and returns the text with the cursor after the replacement.
    public static func replaceRange(in text: String, start: Int, end: Int, with replacement: String) -> (text: String, cursor: Int) {
        let string = text as NSString
        let lower = min(max(start, 0), string.length)
        let upper = min(max(end, lower), string.length)
        let result = string.replacingCharacters(in: NSRange(location: lower, length: upper - lower), with: replacement)
        return (result, lower + (replacement as NSString).length)
    }

    /// The last `/` of the line that sits at line start or after whitespace.
    private static func commandStart(in line: NSString) -> Int? {
        var index = line.length - 1
        while index >= 0 {
            if line.character(at: index) == 0x2F {
                if index == 0 { return 0 }
                if let scalar = Unicode.Scalar(line.character(at: index - 1)), CharacterSet.whitespaces.contains(scalar) { return index }
            }
            index -= 1
        }
        return nil
    }

    /// An `@"` at word start whose quote is still open, with its decoded query.
    private static func openQuotedMention(in line: NSString) -> (start: Int, query: String)? {
        var search = NSRange(location: 0, length: line.length)
        var start: Int?
        while true {
            let found = line.range(of: "@\"", options: NSString.CompareOptions.backwards, range: search)
            guard found.location != NSNotFound else { break }
            let before = found.location == 0 ? nil : Unicode.Scalar(line.character(at: found.location - 1))
            if before.map({ CharacterSet.whitespaces.contains($0) }) ?? true {
                start = found.location
                break
            }
            search = NSRange(location: 0, length: found.location)
        }
        guard let start else { return nil }
        var query = ""
        var escaped = false
        for character in line.substring(from: start + 2) {
            if escaped {
                query.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "\"" {
                return nil
            } else {
                query.append(character)
            }
        }
        return (start, query)
    }
}

/// A long paste kept as a card and sent after the prompt, as in Synara's `composerPastedText.ts`.
public struct PastedText: Codable, Equatable, Identifiable, Sendable {
    public static let minimumCharacters = 4_000
    public static let minimumLines = 25
    static let titleLimit = 140

    public var id: UUID
    public var createdAt: Date
    public var text: String

    public init(text: String, id: UUID = UUID(), createdAt: Date = Date()) {
        self.id = id
        self.createdAt = createdAt
        self.text = Self.normalize(text)
    }

    public var lineCount: Int { text.components(separatedBy: "\n").count }

    /// The first non-empty line, trimmed and cut at 140 characters.
    public var title: String {
        let line = text.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty } ?? ""
        return String(line.prefix(Self.titleLimit))
    }

    public var sizeLabel: String {
        lineCount > 1 ? "\(lineCount) righe" : "\(text.count) caratteri"
    }

    /// Line endings become `\n`; spaces are kept.
    public static func normalize(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    }

    public static func shouldCollapse(_ text: String) -> Bool {
        let normalized = normalize(text)
        return normalized.count >= minimumCharacters || normalized.components(separatedBy: "\n").count >= minimumLines
    }

    /// `prompt`, a blank line and the pastes as a JSON array inside `<pasted_text>`.
    public static func serialize(prompt: String, pastes: [PastedText]) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !pastes.isEmpty,
              let data = try? JSONEncoder().encode(pastes.map { ["text": $0.text] }),
              let json = String(data: data, encoding: .utf8) else { return trimmed }
        return "\(trimmed)\n\n<pasted_text>\n\(json)\n</pasted_text>"
    }

    /// Splits a serialized message into the prompt and the pasted texts.
    public static func extractTrailing(from text: String) -> (prompt: String, texts: [String]) {
        let string = text as NSString
        guard let expression = try? NSRegularExpression(pattern: #"\n*<pasted_text>\n([\s\S]*?)\n</pasted_text>\s*$"#),
              let match = expression.firstMatch(in: text, range: NSRange(location: 0, length: string.length)),
              let data = string.substring(with: match.range(at: 1)).data(using: .utf8),
              let items = try? JSONDecoder().decode([[String: String]].self, from: data) else {
            return (text, [])
        }
        let prompt = string.substring(to: match.range.location).trimmingCharacters(in: .whitespacesAndNewlines)
        return (prompt, items.compactMap { $0["text"] })
    }
}

/// Size and count limits for images attached to a Coordinator message, as in Synara.
public enum ComposerAttachmentPolicy {
    public static let maximumAttachments = 8
    public static let directImageBytes = 10 * 1_024 * 1_024
    public static let importableImageBytes = 32 * 1_024 * 1_024

    public enum Decision: Equatable, Sendable {
        case accept
        /// Too large to send as is: re-encode it under `directImageBytes`.
        case reencode
        case reject(Reason)
    }

    public enum Reason: Equatable, Sendable {
        case tooMany, tooLarge, empty
    }

    public static func decide(byteCount: Int, attachedCount: Int) -> Decision {
        if attachedCount >= maximumAttachments { return .reject(.tooMany) }
        if byteCount <= 0 { return .reject(.empty) }
        if byteCount > importableImageBytes { return .reject(.tooLarge) }
        return byteCount > directImageBytes ? .reencode : .accept
    }
}
