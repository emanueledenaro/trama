import Foundation

/// Extracts the readable `message` field from a partial JSON reply while Codex is still streaming.
/// The planning reply is a JSON object; streaming deltas arrive as raw JSON fragments, so the UI
/// needs a best-effort preview that never shows braces or escaped quotes to the person.
public enum StreamingReplyPreview {
    /// Returns the decoded prefix of the `message` string found in `partialJSON`, or nil when the
    /// key has not arrived yet. Incomplete escape sequences at the end are dropped.
    public static func message(fromPartialJSON partialJSON: String) -> String? {
        guard let keyRange = partialJSON.range(of: "\"message\"") else { return nil }
        var index = keyRange.upperBound
        let chars = partialJSON
        func skipWhitespace() { while index < chars.endIndex, chars[index].isWhitespace { index = chars.index(after: index) } }
        skipWhitespace()
        guard index < chars.endIndex, chars[index] == ":" else { return nil }
        index = chars.index(after: index)
        skipWhitespace()
        guard index < chars.endIndex, chars[index] == "\"" else { return nil }
        index = chars.index(after: index)
        var output = ""
        while index < chars.endIndex {
            let character = chars[index]
            if character == "\"" { break }
            if character == "\\" {
                let next = chars.index(after: index)
                guard next < chars.endIndex else { break }
                let escaped = chars[next]
                switch escaped {
                case "n": output.append("\n")
                case "t": output.append("\t")
                case "r": output.append("\r")
                case "\"", "\\", "/": output.append(escaped)
                case "u":
                    let hexStart = chars.index(after: next)
                    guard let hexEnd = chars.index(hexStart, offsetBy: 4, limitedBy: chars.endIndex),
                          let scalarValue = UInt32(chars[hexStart..<hexEnd], radix: 16),
                          let scalar = Unicode.Scalar(scalarValue) else { return output }
                    output.unicodeScalars.append(scalar)
                    index = hexEnd
                    continue
                default: output.append(escaped)
                }
                index = chars.index(after: next)
                continue
            }
            output.append(character)
            index = chars.index(after: index)
        }
        return output
    }
}
