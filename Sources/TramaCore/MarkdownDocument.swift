import Foundation

public struct MarkdownDocument: Equatable, Sendable {
    public let blocks: [MarkdownBlock]

    public init(blocks: [MarkdownBlock]) {
        self.blocks = blocks
    }

    public static func parse(_ source: String) -> MarkdownDocument {
        let normalized = source
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var index = 0

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(.paragraph(paragraph.joined(separator: " ")))
            paragraph.removeAll(keepingCapacity: true)
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let level = indentationLevel(of: line)

            if trimmed.isEmpty {
                flushParagraph()
                index += 1
                continue
            }

            if let fence = openingFence(from: trimmed) {
                flushParagraph()
                index += 1
                var code: [String] = []
                while index < lines.count, !isClosingFence(lines[index], matching: fence) {
                    code.append(lines[index])
                    index += 1
                }
                if index < lines.count { index += 1 }
                blocks.append(.code(language: fence.info, text: code.joined(separator: "\n")))
                continue
            }

            if let heading = heading(from: trimmed) {
                flushParagraph()
                blocks.append(heading)
                index += 1
                continue
            }

            if ["---", "***", "___"].contains(trimmed) {
                flushParagraph()
                blocks.append(.divider)
                index += 1
                continue
            }

            if let task = task(from: trimmed) {
                flushParagraph()
                blocks.append(.task(text: task.text, checked: task.checked, level: level))
                index += 1
                continue
            }

            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                flushParagraph()
                blocks.append(.bullet(text: String(trimmed.dropFirst(2)), level: level))
                index += 1
                continue
            }

            if let ordered = orderedItem(from: trimmed) {
                flushParagraph()
                blocks.append(.ordered(number: ordered.number, text: ordered.text, level: level))
                index += 1
                continue
            }

            if trimmed.hasPrefix("> ") {
                flushParagraph()
                blocks.append(.quote(String(trimmed.dropFirst(2))))
                index += 1
                continue
            }

            if index + 1 < lines.count,
               let headers = tableCells(from: trimmed),
               isTableSeparator(lines[index + 1], columns: headers.count) {
                flushParagraph()
                index += 2
                var rows: [[String]] = []
                while index < lines.count,
                      let cells = tableCells(from: lines[index]),
                      cells.count == headers.count,
                      !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows.append(cells)
                    index += 1
                }
                blocks.append(.table(headers: headers, rows: rows))
                continue
            }

            paragraph.append(trimmed)
            index += 1
        }

        flushParagraph()
        return MarkdownDocument(blocks: blocks)
    }

    private static func heading(from line: String) -> MarkdownBlock? {
        for level in 1...3 {
            let prefix = String(repeating: "#", count: level) + " "
            if line.hasPrefix(prefix) {
                return .heading(level: level, text: String(line.dropFirst(prefix.count)))
            }
        }
        return nil
    }

    private struct Fence {
        let marker: Character
        let length: Int
        let info: String
    }

    private static func openingFence(from line: String) -> Fence? {
        guard let marker = line.first, marker == "`" || marker == "~" else { return nil }
        let length = line.prefix { $0 == marker }.count
        guard length >= 3 else { return nil }
        let info = String(line.dropFirst(length)).trimmingCharacters(in: .whitespaces)
        if marker == "`", info.contains("`") { return nil }
        return Fence(marker: marker, length: length, info: info)
    }

    private static func isClosingFence(_ line: String, matching fence: Fence) -> Bool {
        let value = line.trimmingCharacters(in: .whitespaces)
        let length = value.prefix { $0 == fence.marker }.count
        guard length >= fence.length else { return false }
        return value.dropFirst(length).trimmingCharacters(in: .whitespaces).isEmpty
    }

    private static func task(from line: String) -> (text: String, checked: Bool)? {
        guard line.count >= 6, line.hasPrefix("- ["), line[line.index(line.startIndex, offsetBy: 4)] == "]" else { return nil }
        let marker = line[line.index(line.startIndex, offsetBy: 3)]
        guard marker == " " || marker == "x" || marker == "X" else { return nil }
        let textStart = line.index(line.startIndex, offsetBy: 5)
        let text = line[textStart...].trimmingCharacters(in: .whitespaces)
        return (text, marker != " ")
    }

    private static func orderedItem(from line: String) -> (number: Int, text: String)? {
        guard let dot = line.firstIndex(of: "."), dot != line.startIndex else { return nil }
        let numberText = line[..<dot]
        guard let number = Int(numberText) else { return nil }
        let afterDot = line.index(after: dot)
        guard afterDot < line.endIndex, line[afterDot] == " " else { return nil }
        let text = line[line.index(after: afterDot)...].trimmingCharacters(in: .whitespaces)
        return (number, text)
    }

    private static func indentationLevel(of line: String) -> Int {
        let width = line.prefix { $0 == " " || $0 == "\t" }.reduce(0) { partial, character in
            partial + (character == "\t" ? 2 : 1)
        }
        return min(width / 2, 6)
    }

    private static func tableCells(from line: String) -> [String]? {
        guard line.contains("|") else { return nil }
        var value = line.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("|") { value.removeFirst() }
        if value.hasSuffix("|") { value.removeLast() }
        var cells: [String] = []
        var cell = ""
        var index = value.startIndex
        while index < value.endIndex {
            let character = value[index]
            let next = value.index(after: index)
            if character == "\\", next < value.endIndex, value[next] == "|" {
                cell.append("|")
                index = value.index(after: next)
            } else if character == "|" {
                cells.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
                index = next
            } else {
                cell.append(character)
                index = next
            }
        }
        cells.append(cell.trimmingCharacters(in: .whitespaces))
        return cells.count > 1 ? cells : nil
    }

    private static func isTableSeparator(_ line: String, columns: Int) -> Bool {
        guard let cells = tableCells(from: line), cells.count == columns else { return false }
        return cells.allSatisfy { cell in
            let markers = cell.filter { $0 != ":" }
            return markers.count >= 3 && markers.allSatisfy { $0 == "-" }
        }
    }
}

public enum MarkdownBlock: Equatable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bullet(text: String, level: Int)
    case ordered(number: Int, text: String, level: Int)
    case task(text: String, checked: Bool, level: Int)
    case quote(String)
    case code(language: String, text: String)
    case table(headers: [String], rows: [[String]])
    case divider
}
