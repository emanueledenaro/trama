import Foundation
import Testing
@testable import TramaCore

@Suite("Project study")
struct ProjectStudyTests {
    static let fakeToken = "ghp_" + String(repeating: "a1B2", count: 9)

    @Test("The study covers code, instructions, catalogue, GitHub, monitor, Pact, mandate, requests and history")
    func studyCoversEverySource() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let update = ProjectStudy.make(from: try fixture.sources(), previous: nil, at: Date(timeIntervalSinceReferenceDate: 1))
        let text = update.study.text

        #expect(update.recomputed == Set(ProjectStudy.Part.allCases))
        #expect(update.study.sections.map(\.part) == ProjectStudy.Part.allCases)
        for expected in [
            "Negozio", "branch main", "commit abc1234",   // code
            "Orders", "Payments", "Swift",
            "AGENTS.md", "Rispondi sempre in italiano", "docs/adr/0001-app.md",   // instructions
            "gpt-5.5", "GPT-5.5", "tdd",   // catalogue
            "acme/negozio", "#12 Rimborsi parziali", "feature/refunds", "#7 Beta checklist",   // GitHub
            "Nuovo commit su feature/refunds",   // monitor
            "D-1", "Rimborso entro 14 giorni",   // Pact
            "Mandato v1", "Chiudere la beta",   // mandate
            "Annulla ordine pagato", "Piano da rivedere",   // requests
            "Cosa manca per la beta?", "Mancano i test del rimborso."   // history
        ] {
            #expect(text.contains(expected), "Missing \(expected)")
        }
    }

    @Test("Instruction files never carry secrets, binaries or linked files")
    func instructionsExcludeSecretsAndBinaries() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let files = RepositoryInstructions().read(root: fixture.root)

        #expect(files.map(\.path) == ["AGENTS.md", "README.md", "CONTEXT.md", "docs/adr/0001-app.md", "docs/stato-beta.md"])
        let readme = try #require(files.first { $0.path == "README.md" })
        #expect(readme.excerpt.contains("Negozio di esempio"))
        #expect(!readme.excerpt.contains(Self.fakeToken))
        #expect(!readme.excerpt.contains("PRIVATE KEY"))
        #expect(!readme.excerpt.contains("MIIEvQIBADANBg"))
        #expect(readme.excerpt.contains("[segreto rimosso]"))

        let study = ProjectStudy.make(from: try fixture.sources(), previous: nil).study
        #expect(!study.text.contains(Self.fakeToken))
        #expect(!study.text.contains("SUPERSECRET"))
        #expect(!study.text.contains("PNG"))
        #expect(!study.text.contains("docs/logo.md"))
    }

    @Test("Long instruction files are cut to an excerpt and the cut is declared")
    func longInstructionFilesAreCut() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let long = String(repeating: "Riga di contesto del progetto.\n", count: 2_000)
        try long.write(to: fixture.root.appendingPathComponent("CONTEXT.md"), atomically: true, encoding: .utf8)

        let context = try #require(RepositoryInstructions().read(root: fixture.root).first { $0.path == "CONTEXT.md" })
        #expect(context.isTruncated)
        #expect(context.excerpt.utf8.count <= RepositoryInstructions.rootExcerptBytes)
        #expect(context.excerpt.hasSuffix("progetto."))
    }

    @Test("Past the total limit, instruction files are listed without their text")
    func instructionFilesHaveATotalLimit() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let page = String(repeating: "Decisione architetturale documentata.\n", count: 70)
        for index in 1...30 {
            try page.write(to: fixture.root.appendingPathComponent(String(format: "docs/adr/%04d-extra.md", index)), atomically: true, encoding: .utf8)
        }

        let files = RepositoryInstructions().read(root: fixture.root)
        let total = files.reduce(0) { $0 + $1.excerpt.utf8.count }
        #expect(total <= RepositoryInstructions.maximumTotalBytes)
        let omitted = files.filter { $0.excerpt.isEmpty }
        #expect(!omitted.isEmpty)
        #expect(omitted.allSatisfy { $0.isTruncated })
        #expect(files.first?.path == "AGENTS.md")
        #expect(files.first?.excerpt.isEmpty == false)

        var sources = try fixture.sources()
        sources.instructionFiles = files
        let text = ProjectStudy.make(from: sources, previous: nil).study.text
        #expect(text.contains("### \(omitted[0].path) (non incluso per il limite dello studio: leggilo dal repository)"))
    }

    @Test("A Pact change recomputes only the Pact part")
    func pactChangeRecomputesPact() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        var sources = try fixture.sources()
        let first = ProjectStudy.make(from: sources, previous: nil, at: Date(timeIntervalSinceReferenceDate: 1)).study

        var pact = try #require(sources.pact)
        try pact.decide(id: "D-2", value: "Il rimborso parziale richiede un motivo", acceptedExample: "Motivo: articolo danneggiato", rationale: "Tracciabilità")
        sources.pact = pact
        let update = ProjectStudy.make(from: sources, previous: first, at: Date(timeIntervalSinceReferenceDate: 2))

        #expect(update.recomputed == [.pact])
        #expect(update.study.text.contains("Il rimborso parziale richiede un motivo"))
        for part in ProjectStudy.Part.allCases where part != .pact {
            #expect(update.study.section(part) == first.section(part))
        }
        #expect(update.study.section(.pact)?.updatedAt == Date(timeIntervalSinceReferenceDate: 2))
    }

    @Test("A new commit recomputes the code, and the instructions only when their text changed")
    func commitRecomputesCodeAndChangedInstructions() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        var sources = try fixture.sources()
        let first = ProjectStudy.make(from: sources, previous: nil).study

        sources.snapshot = fixture.snapshot(headSHA: "def5678")
        let codeOnly = ProjectStudy.make(from: sources, previous: first)
        #expect(codeOnly.recomputed == [.code])
        #expect(codeOnly.study.text.contains("commit def5678"))

        try "# Regole\nRispondi sempre in italiano. Nuova regola: niente rete.\n".write(to: fixture.root.appendingPathComponent("AGENTS.md"), atomically: true, encoding: .utf8)
        sources.snapshot = fixture.snapshot(headSHA: "fed9999")
        sources.instructionFiles = RepositoryInstructions().read(root: fixture.root)
        let withInstructions = ProjectStudy.make(from: sources, previous: codeOnly.study)
        #expect(withInstructions.recomputed == [.code, .instructions])
        #expect(withInstructions.study.text.contains("Nuova regola: niente rete."))
    }

    @Test("A local branch change recomputes the code part; a collaborator branch recomputes GitHub")
    func branchChangesRecomputeTheirParts() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        var sources = try fixture.sources()
        let first = ProjectStudy.make(from: sources, previous: nil).study

        sources.snapshot = fixture.snapshot(branch: "feature/beta")
        let local = ProjectStudy.make(from: sources, previous: first)
        #expect(local.recomputed == [.code])
        #expect(local.study.text.contains("branch feature/beta"))

        sources.github = fixture.github(extraBranch: GitHubBranch(name: "colleague/payments", sha: "9999999999"))
        let remote = ProjectStudy.make(from: sources, previous: local.study)
        #expect(remote.recomputed == [.github])
        #expect(remote.study.text.contains("colleague/payments"))
    }

    @Test("An issue change recomputes only the GitHub part")
    func issueChangeRecomputesGitHub() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        var sources = try fixture.sources()
        let first = ProjectStudy.make(from: sources, previous: nil).study

        sources.issues?.append(GitHubIssue(number: 13, title: "Esportare le fatture", body: "", state: "open", author: "anna", labels: ["enhancement"], url: URL(string: "https://github.com/acme/negozio/issues/13")!))
        let update = ProjectStudy.make(from: sources, previous: first)
        #expect(update.recomputed == [.github])
        #expect(update.study.text.contains("#13 Esportare le fatture"))
    }

    @Test("A thread receives only the parts it has not seen, and never the conversation history")
    func injectionSkipsSeenPartsAndHistory() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        var sources = try fixture.sources()
        let first = ProjectStudy.make(from: sources, previous: nil).study

        #expect(first.partsToInject(after: [:]) == ProjectStudy.Part.allCases.filter { $0 != .history })
        #expect(first.partsToInject(after: first.fingerprints).isEmpty)

        var pact = try #require(sources.pact)
        try pact.decide(id: "D-3", value: "Nessun rimborso dopo 30 giorni", acceptedExample: "Ordine di 31 giorni fa rifiutato", rationale: "Politica")
        sources.pact = pact
        var conversation = try #require(sources.conversation)
        conversation.appendActivity(requestID: nil, title: "Nuova attività", detail: nil)
        sources.conversation = conversation
        let second = ProjectStudy.make(from: sources, previous: first)

        #expect(second.recomputed == [.pact, .history])
        #expect(second.study.partsToInject(after: first.fingerprints) == [.pact])
        let injected = second.study.text(for: [.pact])
        #expect(injected.contains("Nessun rimborso dopo 30 giorni"))
        #expect(!injected.contains("Orders"))
    }

    @Test("Missing sources are stated, not invented")
    func missingSourcesAreStated() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        var sources = try fixture.sources()
        sources.github = nil
        sources.issues = nil
        sources.monitorEvents = []
        sources.pact = nil
        sources.mandate = nil
        sources.requests = []
        sources.conversation = nil
        let text = ProjectStudy.make(from: sources, previous: nil).study.text

        #expect(text.contains("GitHub non è collegato a questo progetto."))
        #expect(text.contains("Nessun evento del monitor."))
        #expect(text.contains("Il Patto non contiene decisioni."))
        #expect(text.contains("Nessun mandato concesso: il Coordinatore legge e propone, senza agire."))
        #expect(text.contains("Nessuna richiesta di modifica registrata."))
        #expect(text.contains("La conversazione è vuota."))
    }

    /// A small repository on disk plus the data Trama holds about it.
    struct Fixture {
        let root: URL
        let projectID = UUID(uuidString: "12345678-1234-1234-1234-123456789012")!

        init() throws {
            root = FileManager.default.temporaryDirectory.appendingPathComponent("study-" + UUID().uuidString)
            let files: [String: String] = [
                "Package.swift": "// swift-tools-version: 6.0\nimport PackageDescription\n",
                "Sources/Orders/Order.swift": "import Foundation\nstruct Order {}\n",
                "Sources/Payments/Payment.swift": "import Orders\nstruct Payment {}\n",
                "AGENTS.md": "# Regole\nRispondi sempre in italiano.\n",
                "README.md": "# Negozio di esempio\nToken: \(ProjectStudyTests.fakeToken)\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\nFine.\n",
                "CONTEXT.md": "Ordine: una richiesta di acquisto.\n",
                "docs/adr/0001-app.md": "# App nativa\nSwiftUI.\n",
                "docs/stato-beta.md": "# Stato beta\nMancano i rimborsi.\n",
                "docs/secrets.md": "SUPERSECRET\n",
                ".env": "API_KEY=SUPERSECRET\n"
            ]
            for (path, contents) in files {
                let url = root.appendingPathComponent(path)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try contents.write(to: url, atomically: true, encoding: .utf8)
            }
            var binary = Data([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00])
            binary.append(Data("PNG".utf8))
            try binary.write(to: root.appendingPathComponent("docs/logo.md"))
            try FileManager.default.createSymbolicLink(
                at: root.appendingPathComponent("docs/link.md"),
                withDestinationURL: root.appendingPathComponent("README.md")
            )
        }

        func remove() {
            try? FileManager.default.removeItem(at: root)
        }

        func snapshot(headSHA: String = "abc1234", branch: String = "main") -> RepositorySnapshot {
            RepositorySnapshot(
                name: "Negozio",
                rootPath: root.path,
                branch: branch,
                modules: [
                    RepositoryModule(id: "Sources/Orders", name: "Orders", summary: "", relativePath: "Sources/Orders", files: [RepositoryFile(id: "Sources/Orders/Order.swift", relativePath: "Sources/Orders/Order.swift", lineCount: 2, contentHash: "h1")], dependencies: [], symbol: "shippingbox"),
                    RepositoryModule(id: "Sources/Payments", name: "Payments", summary: "", relativePath: "Sources/Payments", files: [RepositoryFile(id: "Sources/Payments/Payment.swift", relativePath: "Sources/Payments/Payment.swift", lineCount: 2, contentHash: "h2")], dependencies: ["Sources/Orders"], symbol: "creditcard")
                ],
                totalFileCount: 3,
                scannedAt: Date(timeIntervalSinceReferenceDate: 0),
                warnings: [],
                isDemo: false,
                headSHA: headSHA
            )
        }

        func github(extraBranch: GitHubBranch? = nil) -> GitHubSnapshot {
            GitHubSnapshot(
                repository: "acme/negozio",
                defaultBranch: "main",
                branches: [GitHubBranch(name: "main", sha: "abc1234000"), GitHubBranch(name: "feature/refunds", sha: "bbb2222000")] + (extraBranch.map { [$0] } ?? []),
                pullRequests: [GitHubPullRequest(number: 7, title: "Beta checklist", author: "anna", headRef: "feature/refunds", headSHA: "bbb2222000", baseRef: "main", baseSHA: "abc1234000", url: URL(string: "https://github.com/acme/negozio/pull/7")!, updatedAt: Date(timeIntervalSinceReferenceDate: 5))],
                fetchedAt: Date(timeIntervalSinceReferenceDate: 6)
            )
        }

        func sources() throws -> StudySources {
            var pact = try PactEngine(baseRevision: "abc1234", checkSuiteRevision: "swift-test-v1")
            try pact.decide(id: "D-1", value: "Rimborso entro 14 giorni", acceptedExample: "Ordine del 1 marzo rimborsato il 10", rationale: "Politica commerciale")
            let mandate = try ProjectMandate.grant(projectID: projectID.uuidString, objectives: ["Chiudere la beta"], priorities: ["Rimborsi"], scopeModuleIDs: ["Sources/Orders"], authorizedActions: [.plan(.agreedTicket)], limits: ["Nessuna rete"], grantedBy: "Product Owner", at: Date(timeIntervalSinceReferenceDate: 3))
            var request = WorkRequest(title: "Annulla ordine pagato", moduleID: "Sources/Orders", moduleName: "Orders", request: "Annulla un ordine pagato", sourceFingerprint: "f1")
            request.replyKind = .plan
            request.state = .planReady
            var chat = WorkRequest(title: "Beta", moduleID: "project", moduleName: "Negozio", request: "Cosa manca per la beta?", sourceFingerprint: "f1")
            chat.replyKind = .explanation
            var conversation = ConversationTimeline(projectID: projectID)
            conversation.appendPersonMessage(for: chat, at: Date(timeIntervalSinceReferenceDate: 10))
            conversation.recordReply(requestID: chat.id, text: "Mancano i test del rimborso.", model: "gpt-5.5", references: [], at: Date(timeIntervalSinceReferenceDate: 11))
            let event = TeamEvent(
                id: "e1", repository: "acme/negozio", entity: .branch, change: .updated, reference: "feature/refunds",
                title: "Nuovo commit su feature/refunds", author: "anna", beforeSHA: "a", afterSHA: "b",
                url: nil, observedAt: Date(timeIntervalSinceReferenceDate: 7), source: "github"
            )
            return StudySources(
                snapshot: snapshot(),
                instructionFiles: RepositoryInstructions().read(root: root),
                catalogue: StudyCatalogue(
                    registeredProjects: [RecentProject(id: projectID, name: "Negozio", path: root.path, isDemo: false, lastOpenedAt: Date(timeIntervalSinceReferenceDate: 0))],
                    activeProjectID: projectID,
                    coordinatorModel: "gpt-5.5",
                    models: [CodexClient.Model(id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", description: "", isDefault: true)],
                    skills: [CodexClient.LoadedSkill(name: "tdd", path: "/skills/tdd/SKILL.md", enabled: true)]
                ),
                github: github(),
                issues: [GitHubIssue(number: 12, title: "Rimborsi parziali", body: "", state: "open", author: "anna", labels: ["beta"], url: URL(string: "https://github.com/acme/negozio/issues/12")!)],
                monitorEvents: [event],
                pact: pact,
                mandate: mandate,
                requests: [chat, request],
                conversation: conversation
            )
        }
    }
}
