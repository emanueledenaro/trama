import TramaCore

extension PactBlocker {
    var userMessage: String {
        switch code {
        case "BASE_CHANGED": "La base del progetto è cambiata. Riallinea il piano e le verifiche."
        case "CHECK_FAILED": "Un controllo è fallito. Consulta il suo output prima di correggere il lavoro."
        case "CHECK_NOT_RUN", "EVIDENCE_MISSING": "I controlli richiesti devono ancora essere eseguiti."
        case "CHECK_SUITE_CHANGED": "La suite di controlli è cambiata. Eseguila di nuovo."
        case "DECISION_CHANGED", "UNDELEGATED_DECISION": "Una decisione usata dal lavoro è cambiata. Rivedi il piano."
        case "EVIDENCE_STALE": "Le verifiche si riferiscono a una versione precedente del candidato."
        case "EXTERNAL_EFFECT_UNSUPPORTED": "La modifica richiede un effetto esterno non compreso nella delega."
        case "HUMAN_APPROVAL_REQUIRED": "La revisione locale di questo candidato deve ancora essere registrata."
        case "OUT_OF_SCOPE": "Il candidato modifica file fuori dal perimetro confermato."
        case "UNKNOWN_DEPENDENCIES": "Ci sono dipendenze o file esclusi da chiarire prima della revisione."
        case "UNRESOLVED_CHOICE": "Una scelta di comportamento è ancora aperta."
        default: "Il candidato richiede un controllo aggiuntivo prima della revisione."
        }
    }
}
