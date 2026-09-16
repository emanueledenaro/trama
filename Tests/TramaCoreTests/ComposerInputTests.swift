import Foundation
import Testing
@testable import TramaCore

@Suite("Composer triggers")
struct ComposerTriggerTests {
    private func trigger(_ text: String, cursor: Int? = nil) -> ComposerTrigger? {
        ComposerText.detectTrigger(in: text, cursor: cursor ?? text.utf16.count)
    }

    @Test("An @ at the start of a word opens a mention with its query and range")
    func mentionAtWordStart() {
        #expect(trigger("Guarda @Pag") == ComposerTrigger(kind: .mention, query: "Pag", rangeStart: 7, rangeEnd: 11))
        #expect(trigger("@") == ComposerTrigger(kind: .mention, query: "", rangeStart: 0, rangeEnd: 1))
        #expect(trigger("riga uno\n@issue:7") == ComposerTrigger(kind: .mention, query: "issue:7", rangeStart: 9, rangeEnd: 17))
    }

    @Test("An e-mail address opens nothing, and a second @ in the word anchors the mention")
    func emailAndDoubleAt() {
        #expect(trigger("scrivi a anna@example.com") == nil)
        #expect(trigger("@foo@bar") == ComposerTrigger(kind: .mention, query: "bar", rangeStart: 4, rangeEnd: 8))
        #expect(trigger("@foo(bar") == nil)
    }

    @Test("A quoted mention may contain spaces and escaped quotes until it is closed")
    func quotedMention() {
        #expect(trigger(#"vedi @"Docs/Il mio"#) == ComposerTrigger(kind: .mention, query: "Docs/Il mio", rangeStart: 5, rangeEnd: 18))
        #expect(trigger(#"vedi @"a \"b"#)?.query == #"a "b"#)
        #expect(trigger(#"vedi @"chiuso" e poi"#) == nil)
    }

    @Test("A slash at line start opens the command menu; typed paths and mid-word slashes do not")
    func slashCommands() {
        #expect(trigger("/tdd") == ComposerTrigger(kind: .slashCommand, query: "tdd", rangeStart: 0, rangeEnd: 4))
        #expect(trigger("usa /code") == ComposerTrigger(kind: .slashCommand, query: "code", rangeStart: 4, rangeEnd: 9))
        #expect(trigger("/usr/bin") == nil)
        #expect(trigger("e/o") == nil)
        #expect(trigger("/tdd adesso") == nil)
    }

    @Test("A dollar token opens the skill menu")
    func dollarSkill() {
        #expect(trigger("usa $imp") == ComposerTrigger(kind: .skill, query: "imp", rangeStart: 4, rangeEnd: 8))
    }

    @Test("The trigger follows the cursor, not the end of the text")
    func cursorInsideText() {
        let text = "@Pag e poi altro"
        #expect(ComposerText.detectTrigger(in: text, cursor: 4) == ComposerTrigger(kind: .mention, query: "Pag", rangeStart: 0, rangeEnd: 4))
        #expect(ComposerText.detectTrigger(in: text, cursor: 99) == nil)
    }

    @Test("Offsets are UTF-16, as in the text view")
    func utf16Offsets() {
        let text = "👋 @Pa"
        #expect(trigger(text) == ComposerTrigger(kind: .mention, query: "Pa", rangeStart: 3, rangeEnd: 6))
    }

    @Test("Replacing a range returns the new text and a cursor after the replacement")
    func replaceRange() {
        let result = ComposerText.replaceRange(in: "Guarda @Pag ora", start: 7, end: 11, with: "@module:Payments ")
        #expect(result.text == "Guarda @module:Payments  ora")
        #expect(result.cursor == 24)
        let clamped = ComposerText.replaceRange(in: "ab", start: 5, end: 1, with: "x")
        #expect(clamped.text == "abx")
        #expect(clamped.cursor == 3)
    }
}

@Suite("Composer mentions")
struct ComposerMentionTests {
    static let sources = MentionSources(
        modules: [
            RepositoryModule(id: "Payments", name: "Pagamenti", summary: "Pagamenti degli ordini", relativePath: "Sources/Payments",
                             files: [
                                RepositoryFile(id: "p1", relativePath: "Sources/Payments/Payment.swift", lineCount: 40, contentHash: "a"),
                                RepositoryFile(id: "p2", relativePath: "Sources/Payments/Refund Policy.swift", lineCount: 12, contentHash: "b")
                             ],
                             dependencies: [], symbol: "creditcard"),
            RepositoryModule(id: "Orders", name: "Ordini", summary: "Gestione ordini", relativePath: "Sources/Orders",
                             files: [RepositoryFile(id: "o1", relativePath: "Sources/Orders/Order.swift", lineCount: 90, contentHash: "c")],
                             dependencies: ["Payments"], symbol: "cart")
        ],
        issues: [
            GitHubIssue(number: 70, title: "V07: Composer con menzioni", body: String(repeating: "corpo ", count: 1_000), state: "open", author: "emanuele", labels: ["enhancement"], url: URL(string: "https://github.com/o/r/issues/70")!),
            GitHubIssue(number: 7, title: "Revisione", body: "", state: "closed", author: "anna", labels: [], url: URL(string: "https://github.com/o/r/issues/7")!)
        ],
        decisions: [
            PactDecision(id: "D-1", version: 2, value: "Rimborso entro 14 giorni", acceptedExample: "Ordine del 1 marzo rimborsato il 10", rationale: "Politica")
        ]
    )

    @Test("Paths with spaces or special characters are quoted and escaped")
    func tokenFormatting() {
        #expect(ComposerMentions.token(for: "Sources/Orders/Order.swift") == "@Sources/Orders/Order.swift")
        #expect(ComposerMentions.token(for: "@module:Payments") == "@module:Payments")
        #expect(ComposerMentions.token(for: "Docs/Il mio file.md") == #"@"Docs/Il mio file.md""#)
        #expect(ComposerMentions.token(for: #"a"b\c"#) == #"@"a\"b\\c""#)
        #expect(ComposerMentions.token(for: "costo$") == #"@"costo$""#)
    }

    @Test("Tokens are parsed back; while typing a token counts only once a space follows it")
    func tokenParsing() {
        let text = #"Vedi @module:Payments e @"Docs/Il mio file.md" poi @issue:70"#
        #expect(ComposerMentions.paths(in: text) == ["module:Payments", "Docs/Il mio file.md", "issue:70"])
        #expect(ComposerMentions.paths(in: text, whileTyping: true) == ["module:Payments", "Docs/Il mio file.md"])
        #expect(ComposerMentions.paths(in: "anna@example.com") == [])
        #expect(ComposerMentions.paths(in: #"@"a\"b" fine"#) == [#"a"b"#])
    }

    @Test("Mentions resolve only to real modules, files, issues and decisions, once each, in text order")
    func resolution() {
        let text = "Su @issue:70 e @module:Payments, poi @Sources/Orders/Order.swift @decision:D-1 @module:Payments @issue:999 @module:Nope @Nope.swift"
        let resolved = ComposerMentions.resolve(in: text, sources: Self.sources)
        // Trailing punctuation after a token does not hide the reference.
        #expect(resolved.map(\.mention) == [
            ComposerMention(kind: .issue, key: "70"),
            ComposerMention(kind: .module, key: "Payments"),
            ComposerMention(kind: .file, key: "Sources/Orders/Order.swift"),
            ComposerMention(kind: .decision, key: "D-1")
        ])
        let withSpace = ComposerMentions.resolve(in: "Su @issue:70 e @module:Payments poi", sources: Self.sources)
        #expect(withSpace.map(\.mention) == [ComposerMention(kind: .issue, key: "70"), ComposerMention(kind: .module, key: "Payments")])
        #expect(withSpace.map(\.label) == ["issue #70", "modulo Pagamenti"])
        let quoted = ComposerMentions.resolve(in: #"@"Sources/Payments/Refund Policy.swift""#, sources: Self.sources)
        #expect(quoted.map(\.mention) == [ComposerMention(kind: .file, key: "Sources/Payments/Refund Policy.swift")])
    }

    @Test("The context block describes each reference within fixed limits")
    func contextBlock() throws {
        let resolved = ComposerMentions.resolve(in: "@module:Payments @issue:70 @decision:D-1 @Sources/Orders/Order.swift fine", sources: Self.sources)
        let block = try #require(ComposerMentions.contextBlock(for: resolved, sources: Self.sources))
        #expect(block.hasPrefix("<mentioned_context>\n"))
        #expect(block.hasSuffix("\n</mentioned_context>"))
        #expect(block.contains("Module \"Pagamenti\" (id Payments, path Sources/Payments): Pagamenti degli ordini"))
        #expect(block.contains("- Sources/Payments/Refund Policy.swift"))
        #expect(block.contains("Issue #70 (open): V07: Composer con menzioni"))
        #expect(block.contains("https://github.com/o/r/issues/70"))
        #expect(block.contains("Decision D-1 v2: Rimborso entro 14 giorni"))
        #expect(block.contains("File Sources/Orders/Order.swift"))
        #expect(block.utf8.count <= ComposerMentions.contextByteLimit)
        let issueBody = try #require(block.components(separatedBy: "\n").first { $0.hasPrefix("corpo") })
        #expect(issueBody.count <= ComposerMentions.issueBodyLimit + 1)
        #expect(ComposerMentions.contextBlock(for: [], sources: Self.sources) == nil)
    }

    @Test("Candidates cover every kind, rank exact names first and honour a kind prefix")
    func candidates() {
        let all = ComposerMentions.candidates(for: "", sources: Self.sources)
        #expect(Set(all.map(\.mention.kind)) == Set(ComposerMentionKind.allCases))
        #expect(all.first?.mention.kind == .module)

        let payments = ComposerMentions.candidates(for: "pag", sources: Self.sources)
        #expect(payments.first?.mention == ComposerMention(kind: .module, key: "Payments"))

        let issue = ComposerMentions.candidates(for: "70", sources: Self.sources)
        #expect(issue.first?.mention == ComposerMention(kind: .issue, key: "70"))

        let restricted = ComposerMentions.candidates(for: "issue:", sources: Self.sources)
        #expect(restricted.map(\.mention.kind) == [.issue, .issue])

        let decision = ComposerMentions.candidates(for: "rimborso", sources: Self.sources)
        #expect(decision.first?.mention == ComposerMention(kind: .decision, key: "D-1"))

        let file = ComposerMentions.candidates(for: "order.swift", sources: Self.sources)
        #expect(file.first?.mention == ComposerMention(kind: .file, key: "Sources/Orders/Order.swift"))
        #expect(file.first?.insertion == "@Sources/Orders/Order.swift ")

        let module = ComposerMentions.candidates(for: "ordini", sources: Self.sources)
        #expect(module.first?.insertion == "@module:Orders ")
    }

    @Test("File scores follow the reference order: name, path, prefix, substring, subsequence")
    func fileScores() {
        #expect(ComposerMentions.fileScore(path: "a/order.swift", query: "order.swift") == 0)
        #expect(ComposerMentions.fileScore(path: "a/order.swift", query: "a/order.swift") == 1)
        #expect(ComposerMentions.fileScore(path: "a/order.swift", query: "ord") == 2)
        #expect(ComposerMentions.fileScore(path: "a/order.swift", query: "der") == 3)
        #expect((100..<1000).contains(ComposerMentions.fileScore(path: "a/order.swift", query: "osw") ?? -1))
        #expect(ComposerMentions.fileScore(path: "src/x.swift", query: "src") == 1000)
        #expect(ComposerMentions.fileScore(path: "a/src/x.swift", query: "src") == 1001)
        #expect(ComposerMentions.fileScore(path: "asrc/x.swift", query: "src") == 1002)
        #expect(ComposerMentions.fileScore(path: "a/b/x.swift", query: "ab") ?? 0 >= 1100)
        #expect(ComposerMentions.fileScore(path: "a/x.swift", query: "zz") == nil)
        #expect(ComposerMentions.fileScore(path: "a/x.swift", query: "@./X.SWIFT") == 0)
    }

    @Test("Backspace after a token removes the whole token")
    func tokenRangeForBackspace() {
        let text = #"Vedi @module:Payments e @"Il mio.md""#
        #expect(ComposerMentions.tokenRange(endingAt: 21, in: text) == 5..<21)
        #expect(ComposerMentions.tokenRange(endingAt: 36, in: text) == 24..<36)
        #expect(ComposerMentions.tokenRange(endingAt: 20, in: text) == nil)
        #expect(ComposerMentions.tokenRange(endingAt: 4, in: text) == nil)
    }
}

@Suite("Composer skills")
struct ComposerSkillTests {
    static let skills = [
        CodexClient.LoadedSkill(name: "tdd", path: "/p/.agents/skills/tdd/SKILL.md", enabled: true, description: "Test-driven development"),
        CodexClient.LoadedSkill(name: "code-review", path: "/p/.agents/skills/code-review/SKILL.md", enabled: true),
        CodexClient.LoadedSkill(name: "off", path: "/p/off/SKILL.md", enabled: false)
    ]

    @Test("The command menu lists enabled skills ranked by the query")
    func candidates() {
        #expect(ComposerSkills.candidates(for: "", skills: Self.skills).map(\.name) == ["code-review", "tdd"])
        // "rev" also matches the description of tdd as a subsequence, which weighs less than the name.
        #expect(ComposerSkills.candidates(for: "rev", skills: Self.skills).map(\.name) == ["code-review", "tdd"])
        #expect(ComposerSkills.candidates(for: "test", skills: Self.skills).map(\.name) == ["tdd"])
        #expect(ComposerSkills.candidates(for: "off", skills: Self.skills).isEmpty)
    }

    @Test("Only skills still written in the text are sent, and /name becomes $name for Codex")
    func invocations() {
        let text = "/tdd poi usa $code-review e /nope, non a/tdd"
        #expect(ComposerSkills.invocations(in: text, skills: Self.skills).map(\.name) == ["tdd", "code-review"])
        #expect(ComposerSkills.codexText(text, skills: Self.skills) == "$tdd poi usa $code-review e /nope, non a/tdd")
        #expect(ComposerSkills.invocations(in: "/off", skills: Self.skills).isEmpty)
        #expect(ComposerSkills.codexText("/tdd", skills: Self.skills) == "$tdd")
    }
}

@Suite("Pasted text and attachments")
struct ComposerPasteTests {
    @Test("Long pastes become cards; short ones stay in the text")
    func thresholds() {
        #expect(!PastedText.shouldCollapse("breve"))
        #expect(PastedText.shouldCollapse(String(repeating: "a", count: 4_000)))
        #expect(!PastedText.shouldCollapse(String(repeating: "a", count: 3_999)))
        #expect(PastedText.shouldCollapse(Array(repeating: "x", count: 25).joined(separator: "\n")))
        #expect(!PastedText.shouldCollapse(Array(repeating: "x", count: 24).joined(separator: "\n")))
        #expect(PastedText.shouldCollapse(Array(repeating: "x", count: 25).joined(separator: "\r\n")))
    }

    @Test("A card has a title from the first non-empty line and a size label")
    func card() {
        let paste = PastedText(text: "\r\n\n  Primo titolo  \r\nseconda\rterza")
        #expect(paste.text == "\n\n  Primo titolo  \nseconda\nterza")
        #expect(paste.title == "Primo titolo")
        #expect(paste.lineCount == 5)
        #expect(paste.sizeLabel == "5 righe")
        #expect(PastedText(text: String(repeating: "b", count: 4_100)).sizeLabel == "4100 caratteri")
        #expect(PastedText(text: String(repeating: "t", count: 200)).title.count == 140)
    }

    @Test("Pastes are serialized after the prompt and read back")
    func serialization() throws {
        let pastes = [PastedText(text: "uno\n\"due\""), PastedText(text: "</pasted_text> tre")]
        let text = PastedText.serialize(prompt: "  Leggi questi log  ", pastes: pastes)
        #expect(text.hasPrefix("Leggi questi log\n\n<pasted_text>\n["))
        #expect(text.hasSuffix("]\n</pasted_text>"))
        let extracted = PastedText.extractTrailing(from: text)
        #expect(extracted.prompt == "Leggi questi log")
        #expect(extracted.texts == ["uno\n\"due\"", "</pasted_text> tre"])
        #expect(PastedText.serialize(prompt: "solo testo", pastes: []) == "solo testo")
        #expect(PastedText.extractTrailing(from: "solo testo").texts == [])
        #expect(PastedText.extractTrailing(from: "solo testo").prompt == "solo testo")
    }

    @Test("Images up to 10 MiB pass, up to 32 MiB are re-encoded, and at most 8 are attached")
    func attachmentPolicy() {
        let mib = 1_024 * 1_024
        #expect(ComposerAttachmentPolicy.decide(byteCount: 10 * mib, attachedCount: 0) == .accept)
        #expect(ComposerAttachmentPolicy.decide(byteCount: 10 * mib + 1, attachedCount: 0) == .reencode)
        #expect(ComposerAttachmentPolicy.decide(byteCount: 32 * mib, attachedCount: 7) == .reencode)
        #expect(ComposerAttachmentPolicy.decide(byteCount: 32 * mib + 1, attachedCount: 0) == .reject(.tooLarge))
        #expect(ComposerAttachmentPolicy.decide(byteCount: 1, attachedCount: 8) == .reject(.tooMany))
        #expect(ComposerAttachmentPolicy.decide(byteCount: 0, attachedCount: 0) == .reject(.empty))
    }
}

@Suite("Coordinator turn input")
struct CoordinatorTurnComposerTests {
    @Test("Items go in order: update, mentioned context, message, images, skills")
    func order() throws {
        let message = PastedText.serialize(prompt: "/tdd su @module:Payments e @issue:70 poi", pastes: [PastedText(text: "log @decision:D-1 /code-review")])
        let turn = CoordinatorTurnComposer.compose(
            message: message,
            imagePaths: ["/data/a.png"],
            moduleLine: "Contesto scelto dalla persona: modulo Pagamenti.",
            contextUpdate: "Aggiornamento dello studio",
            sources: ComposerMentionTests.sources,
            skills: ComposerSkillTests.skills
        )
        #expect(turn.mentions.map(\.label) == ["modulo Pagamenti", "issue #70"])
        #expect(turn.skills.map(\.name) == ["tdd"])
        #expect(turn.input.count == 5)
        #expect(turn.input[0] == .text("Aggiornamento dello studio"))
        guard case let .text(block) = turn.input[1] else { Issue.record("Expected the context block"); return }
        #expect(block.hasPrefix("<mentioned_context>"))
        #expect(!block.contains("Decision D-1"))
        guard case let .text(text) = turn.input[2] else { Issue.record("Expected the message"); return }
        #expect(text.hasPrefix("Contesto scelto dalla persona: modulo Pagamenti.\n\n$tdd su @module:Payments e @issue:70 poi\n\n<pasted_text>"))
        #expect(text.contains("/code-review"))
        #expect(turn.input[3] == .localImage(path: "/data/a.png"))
        #expect(turn.input[4] == .skill(name: "tdd", path: "/p/.agents/skills/tdd/SKILL.md"))
        #expect(turn.summary == "riferimenti: modulo Pagamenti, issue #70 · skill: tdd · 1 immagine · 1 testo incollato")
    }

    @Test("A plain message is one text item with no summary")
    func plain() {
        let turn = CoordinatorTurnComposer.compose(message: "Ciao", imagePaths: [], moduleLine: nil, contextUpdate: nil, sources: ComposerMentionTests.sources, skills: [])
        #expect(turn.input == [.text("Ciao")])
        #expect(turn.summary == nil)
    }

    @Test("Images without text get a starting prompt")
    func imagesOnly() {
        let turn = CoordinatorTurnComposer.compose(message: "  ", imagePaths: ["/a.png", "/b.png"], moduleLine: nil, contextUpdate: nil, sources: ComposerMentionTests.sources, skills: [])
        #expect(turn.input == [.text(CoordinatorTurnComposer.imageOnlyPrompt), .localImage(path: "/a.png"), .localImage(path: "/b.png")])
        #expect(turn.summary == "2 immagini")
    }
}
