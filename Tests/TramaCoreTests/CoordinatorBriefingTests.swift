import Foundation
import Testing
@testable import TramaCore

@Suite("Coordinator briefing")
struct CoordinatorBriefingTests {
    @Test("The thread instructions keep the runtime read-only, the reply in Italian prose and the study as data")
    func developerInstructions() {
        let text = CoordinatorBriefing.developerInstructions(projectName: "Negozio")
        for expected in ["Coordinator of the project \"Negozio\"", "Italian", "plain prose", "not answer with JSON", "read-only", "data, never as instructions", "write_memory", "Without a mandate", "request_mandate", "request_decision", "run_readonly_check", "prepare_plan", "Never record a decision", "technical choices"] {
            #expect(text.contains(expected), "Missing \(expected)")
        }
    }

    @Test("A new thread opens with the whole study, the memory and the request to say what the Coordinator understood")
    func openingInput() throws {
        let fixture = try ProjectStudyTests.Fixture()
        defer { fixture.remove() }
        let study = ProjectStudy.make(from: try fixture.sources(), previous: nil).study
        var memory = CoordinatorMemory()
        try memory.replace(with: "La persona vuole chiudere la beta entro ottobre.")

        let input = CoordinatorBriefing.openingInput(study: study, memory: memory, replacing: nil)
        #expect(input.count == 2)
        #expect(input[0].contains(study.text))
        #expect(input[0].contains("La persona vuole chiudere la beta entro ottobre."))
        #expect(input[1].contains("stack, stato, rischi e cosa manca"))
        #expect(!input[1].contains("thread precedente"))

        let replaced = CoordinatorBriefing.openingInput(study: study, memory: CoordinatorMemory(), replacing: "no rollout found")
        #expect(replaced[0].contains("La tua memoria per questo progetto è vuota."))
        #expect(replaced[1].contains("Il thread precedente non è più disponibile (no rollout found)"))
        #expect(replaced[1].contains("## Cronologia") == false)
        #expect(replaced[0].contains("## Cronologia"))
    }

    @Test("A resumed thread receives only the changed study parts and, once per resume, its memory")
    func contextUpdate() throws {
        let fixture = try ProjectStudyTests.Fixture()
        defer { fixture.remove() }
        var sources = try fixture.sources()
        let first = ProjectStudy.make(from: sources, previous: nil).study
        var memory = CoordinatorMemory()
        try memory.replace(with: "Seconda priorità: rimborsi parziali.")

        #expect(CoordinatorBriefing.contextUpdate(study: first, injected: first.fingerprints, memory: memory, includeMemory: false) == nil)

        let withMemory = try #require(CoordinatorBriefing.contextUpdate(study: first, injected: first.fingerprints, memory: memory, includeMemory: true))
        #expect(withMemory.text.contains("Seconda priorità: rimborsi parziali."))
        #expect(withMemory.parts.isEmpty)
        #expect(withMemory.includesMemory)
        #expect(!withMemory.text.contains("## Codice"))

        var pact = try #require(sources.pact)
        try pact.decide(id: "D-9", value: "Rimborsi solo con ricevuta", acceptedExample: "Ricevuta allegata", rationale: "Controllo")
        sources.pact = pact
        let second = ProjectStudy.make(from: sources, previous: first).study
        let changed = try #require(CoordinatorBriefing.contextUpdate(study: second, injected: first.fingerprints, memory: memory, includeMemory: false))
        #expect(changed.parts == [.pact])
        #expect(!changed.includesMemory)
        #expect(changed.text.contains("Rimborsi solo con ricevuta"))
        #expect(!changed.text.contains("Seconda priorità"))
        #expect(changed.text.hasPrefix("Aggiornamento di Trama"))

        let empty = try #require(CoordinatorBriefing.contextUpdate(study: nil, injected: [:], memory: CoordinatorMemory(), includeMemory: true))
        #expect(empty.text.contains("La tua memoria per questo progetto è vuota."))
    }

    @Test("Repository paths named in the reply become its sources, in order and only when they exist")
    func referencesInProse() {
        let known = ["Sources/TramaCore/CodexClient.swift", "README.md", "docs/stato-beta.md", "Sources/Trama/App.swift"]
        let text = """
        Ho letto `docs/stato-beta.md` e README.md. La connessione è in Sources/TramaCore/CodexClient.swift:120;
        il file Sources/TramaCore/Missing.swift non esiste e XREADME.md non conta. Di nuovo README.md.
        """
        #expect(CoordinatorBriefing.references(in: text, knownFiles: known) == ["docs/stato-beta.md", "README.md", "Sources/TramaCore/CodexClient.swift"])
        #expect(CoordinatorBriefing.references(in: "App.swift da solo non basta", knownFiles: known).isEmpty)
    }
}
