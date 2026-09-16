import Foundation
import Testing
@testable import TramaCore

struct RequestStateTests {
    static let historicalValues = [
        "Bozza", "In attesa del Coordinatore", "In attesa di Codex", "Analisi in corso", "Modello non disponibile",
        "Risposta disponibile", "Richiesta da chiarire", "Decisione richiesta", "Da rivedere", "Da rivalutare",
        "Preparazione del worktree", "In esecuzione", "Errore di esecuzione", "Verifica manuale richiesta",
        "Nessuna modifica al candidato", "Da verificare", "Verifiche in corso", "Verifiche interrotte", "Verifiche fallite",
        "Da revisionare", "Revisionato localmente", "PR pubblicata", "Controlli superati", "Interrotto", "Errore"
    ]

    @Test("Every value written by earlier versions decodes without migration")
    func historicalValuesDecode() throws {
        for value in Self.historicalValues {
            let data = Data(#"{"id":"22222222-2222-2222-2222-222222222222","createdAt":0,"plan":"","title":"t","moduleID":"m","moduleName":"M","request":"r","state":"\#(value)","sourceFingerprint":"f"}"#.utf8)
            let request = try JSONDecoder().decode(WorkRequest.self, from: data)
            let expected = RequestState(rawValue: value) ?? RequestState.legacyAliases[value]
            #expect(request.state == expected, "\(value)")
        }
    }

    @Test("Legacy synonyms map to the current case and unknown strings fall back to stale")
    func synonymsAndUnknown() {
        #expect(RequestState(legacy: "In attesa di Codex") == .waitingForCoordinator)
        #expect(RequestState(legacy: "Controlli superati") == .reviewedLocally)
        #expect(RequestState(legacy: "Stato inventato") == .stale)
    }

    @Test("Encoding writes the label so older builds still read the document")
    func encodesLabel() throws {
        let data = try JSONEncoder().encode(RequestState.reviewPending)
        #expect(String(decoding: data, as: UTF8.self) == "\"Da revisionare\"")
    }

    @Test("At most eight visible phases, each with a symbol and a tone")
    func phases() {
        #expect(RequestState.Phase.allCases.count <= 8)
        let symbols = Set(RequestState.allCases.map(\.symbol))
        #expect(symbols.count == RequestState.Phase.allCases.count)
        for state in RequestState.allCases { #expect(state.label == state.rawValue) }
    }
}
