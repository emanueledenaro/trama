import Foundation

/// Una risposta informativa o un chiarimento non autorizzano una modifica.
public struct PlanningReply: Sendable {
    public enum Kind: String, Codable, Sendable {
        case plan, clarification, explanation
    }
    public let kind: Kind
    public let message: String
    public let references: [String]
    public let proposal: PlanProposal?

    public static var outputSchema: Data {
        let proposal = try! JSONSerialization.jsonObject(with: PlanProposal.outputSchema)
        return try! JSONSerialization.data(withJSONObject: [
            "type": "object", "additionalProperties": false,
            "required": ["kind", "message", "references", "proposal"],
            "properties": [
                "kind": ["type": "string", "enum": ["plan", "clarification", "explanation"]],
                "message": ["type": "string"],
                "references": ["type": "array", "items": ["type": "string"]],
                "proposal": ["anyOf": [proposal, ["type": "null"]]]
            ]
        ])
    }

    public static func instruction(sourceSnapshotID: String, knownModuleIDs: [String], knownFiles: [String], existingDecisionIDs: [String]) -> String {
        """
        Prima distingui cosa chiede la persona. Restituisci un oggetto con kind, message, references e proposal, nel formato imposto dallo schema.
        - kind=clarification: manca un obiettivo operativo o la richiesta è ambigua. message contiene una domanda breve e utile; proposal deve essere null. Un saluto come «ciao» richiede questa risposta, anche se nel progetto esistono decisioni precedenti.
        - kind=explanation: la persona chiede di capire qualcosa. Rispondi in message, cita soltanto file realmente consultati in references, lascia proposal null.
        - kind=plan: la persona chiede una modifica concreta. Inserisci la proposta nel campo proposal. Le decisioni esistenti sono vincoli e non sono una nuova richiesta: non ricavare da esse un lavoro che la persona non ha chiesto.
        Non registrare come decisione di prodotto un chiarimento sull’intenzione della persona. Non attribuirti approvazioni o risultati di verifica.

        Soltanto per il contenuto del campo proposal quando kind=plan, applica la specifica seguente. Il formato esterno resta sempre quello con kind, message, references e proposal:
        \(PlanProposal.instruction(sourceSnapshotID: sourceSnapshotID, knownModuleIDs: knownModuleIDs, knownFiles: knownFiles, existingDecisionIDs: existingDecisionIDs))
        """
    }

    public static func parse(raw: String, sourceSnapshotID: String, knownModuleIDs: [String], knownFiles: [String], existingDecisionIDs: [String]) throws -> PlanningReply {
        guard raw.utf8.count <= 128 * 1024,
              let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == ["kind", "message", "references", "proposal"],
              let name = object["kind"] as? String, let kind = Kind(rawValue: name),
              let message = object["message"] as? String, message.count <= 12000,
              let references = object["references"] as? [String],
              Set(references).count == references.count,
              references.allSatisfy({ knownFiles.contains($0) }) else { throw PlanningReplyError.invalidResponse }
        if kind == .plan {
            guard let value = object["proposal"] as? [String: Any] else { throw PlanningReplyError.missingProposal }
            let bytes = try JSONSerialization.data(withJSONObject: value)
            let proposal = try PlanProposal.parse(raw: String(decoding: bytes, as: UTF8.self), sourceSnapshotID: sourceSnapshotID, knownModuleIDs: knownModuleIDs, knownFiles: knownFiles, existingDecisionIDs: existingDecisionIDs)
            return PlanningReply(kind: kind, message: message, references: proposal.references, proposal: proposal)
        }
        guard object["proposal"] is NSNull else { throw PlanningReplyError.unexpectedProposal }
        guard !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PlanningReplyError.emptyMessage }
        return PlanningReply(kind: kind, message: message, references: references, proposal: nil)
    }
}

public enum PlanningReplyError: Error, LocalizedError {
    case invalidResponse, missingProposal, unexpectedProposal, emptyMessage
    public var errorDescription: String? {
        switch self {
        case .invalidResponse: "La risposta di Codex non rispetta il formato o le fonti del progetto."
        case .missingProposal: "Codex ha dichiarato un piano senza una proposta valida."
        case .unexpectedProposal: "Una risposta informativa contiene una proposta di modifica inattesa."
        case .emptyMessage: "Codex non ha fornito il chiarimento o la spiegazione."
        }
    }
}
