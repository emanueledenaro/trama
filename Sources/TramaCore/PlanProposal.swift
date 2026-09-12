import CryptoKit
import Foundation

public struct DecisionOption: Codable, Equatable, Sendable {
    public let label: String
    public let behavior: String
    public let example: String
    public let rationale: String

    public init(label: String, behavior: String, example: String, rationale: String) {
        self.label = label
        self.behavior = behavior
        self.example = example
        self.rationale = rationale
    }
}

public struct DecisionQuestion: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let scenario: String
    public let question: String
    public let options: [DecisionOption]
    public let revisesDecisionID: String?

    /// L'host conserva questo ID quando la persona modifica domanda o alternative.
    public init(
        id: String,
        scenario: String,
        question: String,
        options: [DecisionOption],
        revisesDecisionID: String?
    ) {
        self.id = id
        self.scenario = scenario
        self.question = question
        self.options = options
        self.revisesDecisionID = revisesDecisionID
    }
}

public struct PlanProposal: Codable, Equatable, Sendable {
    public let sourceSnapshotID: String
    public let summary: String
    public let steps: [String]
    public let affectedModuleIDs: [String]
    public let references: [String]
    public let proposedBehavior: String
    public let acceptedExample: String
    public let rationale: String
    public let questions: [DecisionQuestion]

    private static let maximumOutputBytes = 128 * 1_024
    private static let maximumTextCharacters = 12_000
    private static let maximumSteps = 100
    private static let maximumReferences = 500
    private static let maximumQuestions = 20
    private static let maximumOptions = 8

    public static let outputSchema = Data(
        """
        {"type":"object","additionalProperties":false,"required":["sourceSnapshotID","summary","steps","affectedModuleIDs","references","proposedBehavior","acceptedExample","rationale","questions"],"properties":{"sourceSnapshotID":{"type":"string"},"summary":{"type":"string"},"steps":{"type":"array","items":{"type":"string"}},"affectedModuleIDs":{"type":"array","items":{"type":"string"}},"references":{"type":"array","items":{"type":"string"}},"proposedBehavior":{"type":"string"},"acceptedExample":{"type":"string"},"rationale":{"type":"string"},"questions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["scenario","question","options","revisesDecisionID"],"properties":{"scenario":{"type":"string"},"question":{"type":"string"},"options":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["label","behavior","example","rationale"],"properties":{"label":{"type":"string"},"behavior":{"type":"string"},"example":{"type":"string"},"rationale":{"type":"string"}}}},"revisesDecisionID":{"type":["string","null"]}}}}}}
        """.utf8
    )

    /// Costruisce una copia gestita dall'host, per esempio dopo una modifica esplicita della persona.
    public init(
        sourceSnapshotID: String,
        summary: String,
        steps: [String],
        affectedModuleIDs: [String],
        references: [String],
        proposedBehavior: String,
        acceptedExample: String,
        rationale: String,
        questions: [DecisionQuestion]
    ) {
        self.sourceSnapshotID = sourceSnapshotID
        self.summary = summary
        self.steps = steps
        self.affectedModuleIDs = affectedModuleIDs
        self.references = references
        self.proposedBehavior = proposedBehavior
        self.acceptedExample = acceptedExample
        self.rationale = rationale
        self.questions = questions
    }

    /// Testo leggibile della proposta. Non include il JSON ricevuto dal modello.
    public var readablePlan: String {
        var sections = [summary]
        sections.append("Passi:\n" + steps.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n"))
        sections.append("Comportamento proposto:\n\(proposedBehavior)")
        sections.append("Esempio da confermare:\n\(acceptedExample)")
        sections.append("Motivazione:\n\(rationale)")
        sections.append("Moduli coinvolti:\n" + affectedModuleIDs.map { "- \($0)" }.joined(separator: "\n"))
        sections.append("Fonti:\n" + references.map { "- \($0)" }.joined(separator: "\n"))

        if !questions.isEmpty {
            let renderedQuestions = questions.enumerated().map { index, question in
                let options = question.options.map { option in
                    "  - \(option.label): \(option.behavior) Esempio: \(option.example) Motivo: \(option.rationale)"
                }.joined(separator: "\n")
                let revision = question.revisesDecisionID.map { "\n  Decisione da rivedere: \($0)" } ?? ""
                return "\(index + 1). Scenario: \(question.scenario)\n  Domanda: \(question.question)\(revision)\n\(options)"
            }.joined(separator: "\n")
            sections.append("Decisioni da chiarire:\n" + renderedQuestions)
        }

        return sections.joined(separator: "\n\n")
    }

    /// Istruzioni per ottenere una proposta JSON legata alle fonti fornite dall'host.
    public static func instruction(
        sourceSnapshotID: String,
        knownModuleIDs: [String],
        knownFiles: [String],
        existingDecisionIDs: [String]
    ) -> String {
        let source = InstructionSources(
            sourceSnapshotID: sourceSnapshotID,
            knownModuleIDs: knownModuleIDs,
            knownFiles: knownFiles,
            existingDecisionIDs: existingDecisionIDs
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = (try? encoder.encode(source)) ?? Data("{}".utf8)
        let encodedSources = String(decoding: data, as: UTF8.self)

        return """
        Restituisci un solo oggetto JSON, senza testo esterno. La proposta è una bozza modificabile dalla persona e non è una decisione approvata.

        Usa questa forma esatta:
        {"sourceSnapshotID":"...","summary":"...","steps":["..."],"affectedModuleIDs":["..."],"references":["percorso/reale"],"proposedBehavior":"...","acceptedExample":"...","rationale":"...","questions":[{"scenario":"...","question":"...","options":[{"label":"...","behavior":"...","example":"...","rationale":"..."}],"revisesDecisionID":"id-esistente-o-null"}]}

        Regole:
        - Ripeti sourceSnapshotID senza modificarlo.
        - Usa in affectedModuleIDs soltanto valori di knownModuleIDs.
        - Usa in references soltanto file di knownFiles. Un file nuovo proposto può comparire nei passi come testo, ma non come fonte esistente.
        - Usa revisesDecisionID soltanto per una decisione presente in existingDecisionIDs, altrimenti usa null.
        - Inserisci domande solo per ambiguità di comportamento che cambiano il risultato. Se il comportamento è chiaro, usa questions vuoto.
        - Ogni domanda deve avere da due a otto alternative concrete. La persona potrà correggerle o scrivere una risposta libera.
        - Non restituire ID per nuove domande o decisioni. Non restituire approved, approval, verified, verification, version o evidence.
        - Non attribuire al modello autorità di approvare, versionare o verificare una decisione.

        Fonti assegnate dall'host:
        \(encodedSources)
        """
    }

    public static func parse(
        raw: String,
        sourceSnapshotID: String,
        knownModuleIDs: [String],
        knownFiles: [String],
        existingDecisionIDs: [String]
    ) throws -> PlanProposal {
        guard isValidText(sourceSnapshotID) else {
            throw PlanProposalError.invalidSourceSnapshotID
        }
        guard raw.utf8.count <= maximumOutputBytes else {
            throw PlanProposalError.outputTooLarge
        }
        guard hasUniqueNonemptyValues(knownModuleIDs),
              hasUniqueNonemptyValues(knownFiles),
              hasUniqueNonemptyValues(existingDecisionIDs) else {
            throw PlanProposalError.invalidKnownSources
        }

        let json = stripMarkdownFence(from: raw)
        guard let data = json.data(using: .utf8), !data.isEmpty else {
            throw PlanProposalError.malformedResponse
        }
        try validateShapeAndAuthority(data)

        let response: ModelProposal
        do {
            response = try JSONDecoder().decode(ModelProposal.self, from: data)
        } catch {
            throw PlanProposalError.malformedResponse
        }

        guard response.sourceSnapshotID == sourceSnapshotID else {
            throw PlanProposalError.staleSource
        }

        let modules = Set(knownModuleIDs)
        for id in response.affectedModuleIDs where !modules.contains(id) {
            throw PlanProposalError.unknownModule(id)
        }
        let files = Set(knownFiles)
        for file in response.references where !files.contains(file) {
            throw PlanProposalError.unknownReference(file)
        }
        let decisions = Set(existingDecisionIDs)
        for question in response.questions {
            if let id = question.revisesDecisionID, !decisions.contains(id) {
                throw PlanProposalError.unknownDecision(id)
            }
        }

        try validateContent(response)
        let questions = try assignQuestionIDs(response.questions, sourceSnapshotID: sourceSnapshotID)
        return PlanProposal(
            sourceSnapshotID: sourceSnapshotID,
            summary: response.summary,
            steps: response.steps,
            affectedModuleIDs: response.affectedModuleIDs,
            references: response.references,
            proposedBehavior: response.proposedBehavior,
            acceptedExample: response.acceptedExample,
            rationale: response.rationale,
            questions: questions
        )
    }

    private static func validateContent(_ response: ModelProposal) throws {
        guard isValidText(response.summary),
              isValidText(response.proposedBehavior),
              isValidText(response.acceptedExample),
              isValidText(response.rationale),
              !response.steps.isEmpty,
              response.steps.count <= maximumSteps,
              response.steps.allSatisfy(isValidText),
              !response.affectedModuleIDs.isEmpty,
              hasUniqueNonemptyValues(response.affectedModuleIDs),
              !response.references.isEmpty,
              response.references.count <= maximumReferences,
              hasUniqueNonemptyValues(response.references),
              response.questions.count <= maximumQuestions else {
            throw PlanProposalError.invalidContent
        }

        for question in response.questions {
            guard isValidText(question.scenario),
                  isValidText(question.question),
                  question.options.count >= 2,
                  question.options.count <= maximumOptions,
                  question.options.allSatisfy({ option in
                      isValidText(option.label)
                          && isValidText(option.behavior)
                          && isValidText(option.example)
                          && isValidText(option.rationale)
                  }),
                  hasUniqueNonemptyValues(question.options.map(\.label)) else {
                throw PlanProposalError.invalidContent
            }
        }
    }

    private static func assignQuestionIDs(
        _ questions: [ModelQuestion],
        sourceSnapshotID: String
    ) throws -> [DecisionQuestion] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var seen: Set<String> = []

        return try questions.map { question in
            let content = QuestionIdentity(sourceSnapshotID: sourceSnapshotID, question: question)
            guard let data = try? encoder.encode(content) else {
                throw PlanProposalError.malformedResponse
            }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            let id = "decision-question-\(digest)"
            guard seen.insert(id).inserted else {
                throw PlanProposalError.invalidContent
            }
            return DecisionQuestion(
                id: id,
                scenario: question.scenario,
                question: question.question,
                options: question.options,
                revisesDecisionID: question.revisesDecisionID
            )
        }
    }

    private static func validateShapeAndAuthority(_ data: Data) throws {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any] else {
            throw PlanProposalError.malformedResponse
        }
        if let forbidden = findForbiddenAuthorityField(in: dictionary) {
            throw PlanProposalError.forbiddenAuthorityField(forbidden)
        }

        let proposalKeys: Set<String> = [
            "sourceSnapshotID", "summary", "steps", "affectedModuleIDs", "references",
            "proposedBehavior", "acceptedExample", "rationale", "questions"
        ]
        guard Set(dictionary.keys) == proposalKeys,
              let questions = dictionary["questions"] as? [[String: Any]] else {
            throw PlanProposalError.malformedResponse
        }

        let requiredQuestionKeys: Set<String> = ["scenario", "question", "options"]
        let allowedQuestionKeys = requiredQuestionKeys.union(["revisesDecisionID"])
        let optionKeys: Set<String> = ["label", "behavior", "example", "rationale"]
        for question in questions {
            let keys = Set(question.keys)
            guard requiredQuestionKeys.isSubset(of: keys),
                  keys.isSubset(of: allowedQuestionKeys),
                  let options = question["options"] as? [[String: Any]],
                  options.allSatisfy({ Set($0.keys) == optionKeys }) else {
                throw PlanProposalError.malformedResponse
            }
        }
    }

    private static func findForbiddenAuthorityField(in value: Any, path: String = "") -> String? {
        let forbidden = Set([
            "id", "decisionid", "approved", "approval", "verified", "verification", "version",
            "evidence", "evidenceid"
        ])
        if let dictionary = value as? [String: Any] {
            for key in dictionary.keys.sorted() {
                let normalized = key.lowercased()
                let nextPath = path.isEmpty ? key : "\(path).\(key)"
                if forbidden.contains(normalized) {
                    return nextPath
                }
                if let nested = findForbiddenAuthorityField(in: dictionary[key] as Any, path: nextPath) {
                    return nested
                }
            }
        } else if let array = value as? [Any] {
            for (index, element) in array.enumerated() {
                if let nested = findForbiddenAuthorityField(in: element, path: "\(path)[\(index)]") {
                    return nested
                }
            }
        }
        return nil
    }

    private static func stripMarkdownFence(from value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("```") else { return trimmed }

        var lines = trimmed.components(separatedBy: .newlines)
        guard lines.count >= 3,
              lines.first?.hasPrefix("```") == true,
              lines.last?.trimmingCharacters(in: .whitespacesAndNewlines) == "```" else {
            return trimmed
        }
        lines.removeFirst()
        lines.removeLast()
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isValidText(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && value.count <= maximumTextCharacters
    }

    private static func hasUniqueNonemptyValues(_ values: [String]) -> Bool {
        values.allSatisfy(isValidText) && Set(values).count == values.count
    }
}

public enum PlanProposalError: Error, Equatable, Sendable {
    case invalidSourceSnapshotID
    case invalidKnownSources
    case outputTooLarge
    case malformedResponse
    case staleSource
    case unknownModule(String)
    case unknownReference(String)
    case unknownDecision(String)
    case forbiddenAuthorityField(String)
    case invalidContent
}

extension PlanProposalError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidSourceSnapshotID:
            return "Lo snapshot sorgente non è valido."
        case .invalidKnownSources:
            return "Le fonti note fornite dall'host non sono valide."
        case .outputTooLarge:
            return "La proposta supera il limite consentito."
        case .malformedResponse:
            return "La proposta non rispetta il formato JSON richiesto."
        case .staleSource:
            return "La proposta appartiene a uno snapshot diverso."
        case let .unknownModule(id):
            return "La proposta cita un modulo sconosciuto: \(id)"
        case let .unknownReference(file):
            return "La proposta cita un file non presente nello snapshot: \(file)"
        case let .unknownDecision(id):
            return "La proposta tenta di rivedere una decisione sconosciuta: \(id)"
        case let .forbiddenAuthorityField(field):
            return "La proposta contiene un campo di autorità non consentito: \(field)"
        case .invalidContent:
            return "La proposta contiene campi vuoti, duplicati o oltre i limiti consentiti."
        }
    }
}

private struct InstructionSources: Encodable {
    let sourceSnapshotID: String
    let knownModuleIDs: [String]
    let knownFiles: [String]
    let existingDecisionIDs: [String]
}

private struct ModelProposal: Decodable {
    let sourceSnapshotID: String
    let summary: String
    let steps: [String]
    let affectedModuleIDs: [String]
    let references: [String]
    let proposedBehavior: String
    let acceptedExample: String
    let rationale: String
    let questions: [ModelQuestion]
}

private struct ModelQuestion: Codable {
    let scenario: String
    let question: String
    let options: [DecisionOption]
    let revisesDecisionID: String?
}

private struct QuestionIdentity: Encodable {
    let sourceSnapshotID: String
    let question: ModelQuestion
}
