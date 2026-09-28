// Temporary part of the main catalog (issue #301), merged into main.it.ts.
export const mainPlanningIt = {
  // pact.ts
  "main.pact.decisionIncomplete": "Una decisione richiede comportamento, esempio e motivazione.",
  "main.pact.mandateIncomplete": "Un mandato richiede almeno un obiettivo, un modulo e un'azione autorizzata.",
  "main.pact.noMandateToRevoke": "Non c'è un mandato attivo da revocare.",
  "main.pact.revocationReasonMissing": "Indica il motivo della revoca.",
  "main.pact.mandateRequestNotFound": "Richiesta di mandato {id} non trovata.",
  "main.pact.mandateRequestSuperseded": "La richiesta di mandato {id} è superata da {newer}: non si può più concedere.",
  "main.pact.newerRequest": "una richiesta più recente",
  "main.pact.mandateRequestAnswered": "La richiesta di mandato {id} ha già una risposta.",
  "main.pact.rejectionReasonMissing": "Indica perché rifiuti la proposta.",
  "main.pact.questionNotFound": "Domanda non trovata.",
  "main.pact.questionAlreadyAnswered": "Hai già risposto a questa domanda.",
  "main.pact.questionWithdrawn": "Hai ritirato questa domanda: non aspetta più una risposta.",
  "main.pact.alternativeInvalid": "Alternativa non valida.",
  "main.pact.decisionMissing": "Scrivi la tua decisione.",
  "main.pact.answerRationale": "Risposta alla domanda: {question}",
  "main.pact.answeredNotWithdrawable": "Hai già risposto a questa domanda: la decisione presa resta e si rivede con una decisione nuova.",
  "main.pact.questionAlreadyWithdrawn": "Hai già ritirato questa domanda.",
  "main.pact.withdrawalReasonMissing": "Indica il motivo del ritiro.",
  "main.pact.withdrawalGrilling":
    "Ho ritirato la domanda {number} del chiarimento, turno {round}: «{question}». Motivo: {reason} Non conta più come domanda aperta.",
  "main.pact.withdrawal": "Ho ritirato la domanda «{question}». Motivo: {reason}",
  "main.pact.mandateGranted": "Ho concesso il mandato (versione {version}).",
  "main.pact.mandateCorrected": "Ho corretto il mandato: ora è alla versione {version}.",
  "main.pact.mandateRevoked": "Ho revocato il mandato.",
  "main.pact.mandateRevokedWithReason": "Ho revocato il mandato. Motivo: {reason}",
  "main.pact.mandateRejectedKept":
    "Ho rifiutato la proposta di mandato {id}. Il mandato in vigore resta la versione {version}, senza modifiche. Motivo: {reason}",
  "main.pact.mandateRejectedNone": "Ho rifiutato la proposta di mandato {id}. Resta senza mandato. Motivo: {reason}",
  "main.pact.decisionAnswered": "Ho risposto alla domanda «{question}»: {value}. È la decisione {id}, versione {version} del Patto.",

  // pactDemo.ts
  "main.pactDemo.approvalRequired": "Approva questa esatta versione.",
  "main.pactDemo.runFirst": "Esegui prima lo scenario.",
  "main.pactDemo.notVerified": "Lo scenario non è verificato.",

  // projectMandate.ts
  "main.projectMandate.reason":
    "Propongo un mandato per tutto il ciclo di lavoro del progetto: comprensione, squadre, spec, fette, assegnazione, verifica e unione con il via libera. Lo concedi una volta e puoi restringerlo in ogni momento. I divieti fissi restano esclusi.",
  "main.projectMandate.objective":
    "Portare avanti il ciclo di lavoro del progetto: comprensione, squadre, spec, fette, assegnazione, verifica e unione con il via libera.",
  "main.projectMandate.noMandateToRestrict": "Non c'è un mandato in vigore da restringere.",
  "main.projectMandate.restrictionAdds": "Una restrizione toglie moduli o azioni, non ne aggiunge: per allargare il mandato correggilo.",
  "main.projectMandate.restrictionEmpty": "Il mandato ristretto tiene almeno un modulo e un'azione: per togliere tutto revocalo.",
  "main.projectMandate.restrictionNothing": "La restrizione non toglie niente.",
  "main.projectMandate.removedModules": "tolti i moduli {modules}",
  "main.projectMandate.removedActions": "tolte le azioni {actions}",
  "main.projectMandate.dependsOn": "{id} (dipende da {dependsOn})",
  "main.projectMandate.halted":
    "Ho fermato {work}: i worktree restano com'erano, il diff non si perde. Per riprendere, ripianifica e delega di nuovo dentro il mandato ristretto.",
  "main.projectMandate.nothingHalted": "Nessun lavoro in corso era fuori dal mandato ristretto.",
  "main.projectMandate.restricted":
    "Ho ristretto il mandato: ora è alla versione {version}, {parts}. {halted} Vale dal tuo prossimo turno: il lavoro fuori dal mandato ristretto non riparte, il resto continua.",
  "main.projectMandate.refusalNotFound": "Azione fermata non trovata.",
  "main.projectMandate.refusalTitle": "Azione fermata da un divieto fisso: {ban}",
  "main.projectMandate.refusalDetail": "{reason} Nessun mandato la concede: la trovi in Aspetta te.",

  // goals.ts
  "main.goals.titleMissing": "Un obiettivo richiede un titolo.",
  "main.goals.titleTooLong": "Il titolo supera {limit} caratteri.",
  "main.goals.outcomeMissing": "Descrivi il risultato atteso dell'obiettivo.",
  "main.goals.outcomeTooLong": "Il risultato atteso supera {limit} caratteri.",
  "main.goals.exampleKind": "Un esempio è accettato o rifiutato.",
  "main.goals.exampleTooLong": "Un esempio supera {limit} caratteri.",
  "main.goals.tooManyExamples": "Un obiettivo ha al massimo {limit} esempi.",
  "main.goals.notFound": "Obiettivo {id} non trovato.",
  "main.goals.statusInvalid": "Stato dell'obiettivo non valido.",
  "main.goals.onlyCoordinatorProposes": "Solo il Coordinatore propone un obiettivo.",
  "main.goals.unknownDecisions": "Decisioni sconosciute: {ids}.",
  "main.goals.alreadyArchived": "L'obiettivo è già archiviato.",
  "main.goals.workRunning": "Il lavoro di questo obiettivo è in corso: fermalo o aspetta che finisca prima di archiviarlo.",
  "main.goals.notArchived": "L'obiettivo non è archiviato.",
  "main.goals.hasHistory": "Questo obiettivo ha già una cronologia nella chat, che resta. Puoi archiviarlo.",
  "main.goals.candidateNotFound": "Candidato non trovato.",
  "main.goals.candidateChanged": "Il candidato è cambiato mentre lo guardavi: ricontrolla gli esempi sulla versione attuale.",
  "main.goals.candidateUnlinked": "Il candidato non è collegato a un obiettivo.",
  "main.goals.exampleNotFound": "Esempio non trovato nell'obiettivo.",

  // plan.ts
  "main.plan.specIncomplete": "Una spec ha almeno titolo, problema e soluzione.",
  "main.plan.specTooLarge": "La spec supera la dimensione ammessa.",
  "main.plan.invalidJson": "La risposta del pianificatore non è un JSON valido.",
  "main.plan.otherSnapshot": "La spec si riferisce a un'altra istantanea del progetto.",
  "main.plan.noSeams": "Il pianificatore non ha proposto seam da testare.",
  "main.plan.fieldMissing": "La spec del pianificatore non ha il campo {field}.",

  // slices.ts
  "main.slices.noSpec": "Il piano non ha ancora una spec da dividere in fette.",
  "main.slices.tooLarge": "La suddivisione supera la dimensione ammessa.",
  "main.slices.invalidJson": "La risposta del divisore non è un JSON valido.",
  "main.slices.otherSnapshot": "La suddivisione si riferisce a un'altra istantanea del progetto.",
  "main.slices.noSlices": "Il divisore non ha proposto fette.",
  "main.slices.tooMany": "Il divisore ha proposto più di 30 fette.",
  "main.slices.sliceIncomplete": "La fetta {number} non ha titolo o comportamento da consegnare.",
  "main.slices.noCriteria": "La fetta {number} non ha criteri di accettazione.",
  "main.slices.blockedByLater": "La fetta {number} è bloccata da {blocker}: una fetta si blocca solo con fette elencate prima.",

  // slicePicking.ts
  "main.slicePicking.noModules": "La fetta non indica moduli: la assegna il Coordinatore.",
  "main.slicePicking.notCovered": "Il mandato non copre il lavoro di questa fetta.",
  "main.slicePicking.busy": "Aspetta che finisca {ids}, che lavora sugli stessi moduli.",
  "main.slicePicking.occupied": "Qualcuno tocca ora questi moduli: {names}.",
  "main.slicePicking.noDeveloper": "Nessuno sviluppatore libero copre i moduli di questa fetta.",
  "main.slicePicking.noProvider": "Nessun provider collegato può lavorare ora.",
  "main.slicePicking.modelReason": "Presa autonoma della fetta: lo stesso provider e modello del lavoro precedente.",

  // developerQuestions.ts
  "main.developerQuestions.asked": "Domanda {id} al Coordinatore",
  "main.developerQuestions.answeredFromFacts": "Il Coordinatore ha risposto alla domanda {id}",
  "main.developerQuestions.waitingForPerson": "La domanda {id} aspetta la risposta della persona",
  "main.developerQuestions.personDecision": "{answer} (decisione {decision}, versione {version} del Patto)",
  "main.developerQuestions.personWithdrew": "La persona ha ritirato la domanda senza decidere. Motivo: {reason}",
  "main.developerQuestions.personAnswered": "La persona ha risposto alla domanda {id}",

  // focus.ts
  "main.focus.projectWork": "Lavoro del progetto",
  "main.focus.notStarted": "da avviare",
  "main.focus.taskNotOpen": "Il task {id} non è aperto: è chiuso o non esiste.",
  "main.focus.taskAlreadyPaused": "Il task {id} è già in pausa.",
  "main.focus.taskNotPaused": "Il task {id} non è in pausa.",

  // candidates.ts
  "main.candidates.gateRunning": "I revisori del candidato sono al lavoro.",
  "main.candidates.gateFailed": "Una figura non ha finito la revisione.",
  "main.candidates.unknown": "Candidato sconosciuto: {id}.",
  "main.candidates.superseded": "Il candidato è stato sostituito da un lavoro più recente: rivedi quello nuovo.",
  "main.candidates.notVerified": "Il candidato non è verificato: {codes}.",
} satisfies Record<string, string>;
