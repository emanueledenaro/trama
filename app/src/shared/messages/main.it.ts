// The Italian texts of the main process (issue #301): errors, Activity rows, notices, status lines and recaps that the person
// sees. The keys start with `main.` and the module that writes the text. Text written for the model is not here.
export const mainIt = {
  // MARK: Controller: projects, turns, providers and the Coordinator
  // Developers, tools and practices
  "main.controller.selfPickDetail":
    "Era la prossima fetta pronta nei suoi moduli: la prende senza aspettare il Coordinatore, dentro il mandato e il limite di sviluppatori in parallelo del progetto.",
  "main.controller.leftProjectNote":
    "Hai lasciato il progetto mentre il Coordinatore rispondeva.",
  "main.controller.readOutsideScopeDetail":
    "{path} non appartiene al progetto: Trama non lo lascia leggere.\nRichiesta: {tool}",
  "main.controller.choicesInTextTitle":
    "Scelta scritta nel testo invece che in una scheda",
  "main.controller.toolRefusedDetail": "Richiesta: {tool}\n{reason}",
  "main.controller.practiceProposedTitle":
    "Pratica proposta: {title} (v{version})",
  "main.controller.practiceProposedDetail":
    "{method}\nLa trovi in Memoria: solo tu la adotti.",
  "main.controller.practiceAdoptedTitle": "Pratica adottata: {title}",
  "main.controller.practiceRetiredTitle": "Pratica ritirata: {title}",
  "main.controller.practiceRolledBackTitle":
    "Pratica riportata alla versione precedente: {title}",

  // Providers
  "main.controller.providerCodexAccountUnsupported":
    "Trama accetta solo un account ChatGPT; Codex usa un account di tipo {type}.",
  "main.controller.providerAccountUnsupported":
    "{name} usa un account di tipo {type}, che Trama non supporta.",
  "main.controller.providerBlockedTemporaryLimit":
    "{name} è bloccato: ha un limite temporaneo.",
  "main.controller.providerBlockedQuotaExhausted":
    "{name} è bloccato: ha esaurito la quota del piano.",
  "main.controller.providerUnlocksAt": "Si sblocca il {date}.",
  "main.controller.providerWaitOrSwitch":
    "Puoi aspettare o scegliere un altro provider.",
  "main.controller.providerCodexSignedOut":
    "Collega ChatGPT da Collegamenti per parlare con il Coordinatore.",
  "main.controller.providerSignInWithCommand":
    "Accedi a {name} con `{command}` nel terminale, poi aggiorna i collegamenti.",
  "main.controller.providerSignIn":
    "Accedi a {name}, poi aggiorna i collegamenti.",
  "main.controller.providerNotChecked":
    "Stato di {name} non ancora verificato.",
  "main.controller.providerNoAdapter":
    "{name} non ha ancora un adattatore in Trama.",
  "main.controller.providerAccountCheckTimeout":
    "{name} non ha risposto al controllo dell'account.",
  "main.controller.providerBackTitle": "{provider} è di nuovo disponibile",
  "main.controller.providerBackDetail": "Trama riprende l'incarico.",
  "main.controller.providerSwitchWait":
    "Aspetta la fine del turno e della coda prima di cambiare provider.",
  "main.controller.providerSwitchTitle": "Coordinatore su {provider}",
  "main.controller.providerSwitchDetail":
    "Hai spostato il Coordinatore da {from} a {to}. La conversazione resta: {to} apre una sessione nuova e riceve studio, memoria e trascrizione.",
  "main.controller.providerSwitchProposal":
    "Puoi passare a {providers} con Cambia provider: sono già collegati.",
  "main.controller.providerSwitchProposal.one":
    "Puoi passare a {providers} con Cambia provider: è già collegato.",
  "main.controller.providerBlockedTitle": "{provider} bloccato",
  "main.controller.networkUnreachable":
    "Rete non raggiungibile: {message}. Trama riprova quando la rete torna e la persona riprende il lavoro.",

  // Retries and resumes of a turn
  "main.controller.retryReopenedTitle": "Turno ripreso alla riapertura",
  "main.controller.retryReopenedDetail":
    "Trama riprende da sola, dentro il mandato, il turno interrotto dalla chiusura. Il Coordinatore controlla prima cosa era già stato fatto.",
  "main.controller.retryResumedTitle": "Turno ripreso",
  "main.controller.retryResumedDetail":
    "Trama riprende il messaggio del turno interrotto. Il Coordinatore controlla prima cosa era già stato fatto.",
  "main.controller.retryManualTitle": "Nuovo tentativo",
  "main.controller.retryManualDetail":
    "Trama riprova il messaggio del turno non riuscito.",
  "main.controller.retryAutomaticTitle":
    "Nuovo tentativo automatico ({attempt} di {max})",
  "main.controller.retryQuotaBackDetail":
    "La quota di {provider} è di nuovo disponibile: Trama riprende il messaggio.",
  "main.controller.retryUnreachableDetail":
    "Dopo l'interruzione di {provider} o della rete, Trama riprova il messaggio.",
  "main.controller.retryTemporaryLimitDetail":
    "Dopo il limite temporaneo di {provider}, Trama riprova il messaggio.",
  "main.controller.turnInterruptedTitle": "Turno interrotto",
  "main.controller.turnFailedTitle": "Il turno non è riuscito",
  "main.controller.turnNotRepeatable": "Questo turno non si può più ripetere.",
  "main.controller.quotaWaitStoppedTitle": "Attesa della quota fermata",
  "main.controller.quotaWaitStoppedDetail":
    "Trama non aspetta più la quota di {provider}: il turno riparte solo su tua richiesta.",
  "main.controller.retriesStoppedTitle": "Tentativi automatici fermati",
  "main.controller.retriesStoppedDetail":
    "Hai fermato i tentativi con {provider}.",
  "main.controller.resumeSkippedTitle": "Ripresa non eseguita",
  "main.controller.resumeOutsideMandate":
    "Il mandato non copre più questo incarico.",
  "main.controller.assignmentResumedOnReopeningTitle":
    "Incarico ripreso alla riapertura",
  "main.controller.assignmentResumedOnReopeningDetail":
    "Trama riprende l'incarico nel suo worktree, com'era alla chiusura.",

  // Projects
  "main.controller.projectMoved":
    "Il progetto {name} non è più in {path}: è stato spostato o eliminato. Riaprilo dalla nuova posizione o toglilo dai recenti.",
  "main.controller.projectReadOnly":
    "Lo stato di questo progetto è in sola lettura.",
  "main.controller.projectNotOpen": "Apri un progetto.",
  "main.controller.folderUnreadable": "La cartella non è leggibile: {path}",
  "main.controller.folderIsFile": "Scegli una cartella, non un file.",
  "main.controller.folderIsRoot":
    "Scegli la cartella di un progetto, non la radice del disco o la cartella Inizio.",
  "main.controller.folderNameInvalid": "Scegli un nome di cartella valido.",
  "main.controller.folderExists":
    "Esiste già una cartella {name} in questa posizione.",
  "main.controller.cloneRepositoryInvalid":
    "Scrivi il repository come proprietario/nome oppure incolla il suo indirizzo GitHub.",
  "main.controller.legacyImportTitle":
    "Conversazione importata dalla versione SwiftUI",
  "main.controller.legacyImportDetail":
    "Conversazione, Patto, mandato, memoria e thread del Coordinatore vengono dall'app precedente. Il file originale resta invariato.",
  "main.controller.orphanStopConfirmedTitle": "Arresto confermato",
  "main.controller.demoWithoutGitHub": "Progetto di esempio senza GitHub.",
  "main.controller.demoProjectName": "Progetto di esempio",

  // GitHub, conflicts and presence
  "main.controller.githubRemoteNotGitHub":
    "Il remoto origin non punta a GitHub.",
  "main.controller.githubIssuesUnreadable":
    "GitHub CLI non ha letto le issue: {reason}",
  "main.controller.githubNotLinked": "Nessun repository GitHub collegato.",
  "main.controller.githubIssueTitleMissing": "Scrivi un titolo per la issue.",
  "main.controller.conflictCardTitle": "Conflitto",
  "main.controller.conflictNotifyTitle": "Trama: conflitto con {references}",
  "main.controller.conflictNotifyBody":
    "Il candidato {candidate} entra in conflitto con {references}.",
  "main.controller.branchDivergenceNotifyTitle":
    "Trama: il branch del progetto è andato in un'altra direzione",
  "main.controller.presenceConsentTitle": "Condividere la presenza?",
  "main.controller.presenceConsentConflictDetail":
    "Il tuo lavoro si sovrappone a {who}. Con la presenza condivisa ve ne sareste accorti prima.",
  "main.controller.presenceColleagueFallback": "quello di un collega",
  "main.controller.presenceDemo":
    "Il progetto di esempio non condivide la presenza.",
  "main.controller.presenceChooseFirst":
    "Prima scegli di condividere la presenza.",
  "main.controller.colleagueCommentInvalid":
    "Il messaggio è vuoto o troppo lungo.",
  "main.controller.colleaguePullRequestNotOpen":
    "La pull request #{number} non è tra quelle aperte.",

  // Coordinator
  "main.controller.coordinatorModelNotInCatalog":
    "Il modello {model} non è più nel catalogo di {provider}. Scegline un altro dal composer.",
  "main.controller.coordinatorNoModels":
    "{provider} non ha restituito modelli disponibili.",
  "main.controller.coordinatorNotReady": "Il Coordinatore non è pronto.",
  "main.controller.assignmentCardTitle": "Incarico",
  "main.controller.newThreadTitle": "Nuovo thread del Coordinatore",
  "main.controller.newThreadDetail":
    "La sessione precedente del Coordinatore non è più disponibile. Il Coordinatore riparte dallo studio e dalla memoria.",
  "main.controller.studyCardTitle": "Studio del progetto",
  "main.controller.messageSentTitle": "Messaggio inviato al Coordinatore",
  "main.controller.messageSentEffort": "sforzo {effort}",
  "main.controller.messageSentGoal": "obiettivo {goal}",
  "main.controller.messageSentStudyUpdate": "aggiornamento: {parts}",
  "main.controller.messageSentTeamUpdates": "aggiornamenti del team",
  "main.controller.messageSentPhase": "fase: {phase}",
  "main.controller.messageSentAutomaticMove": "mossa automatica: {move}",
  "main.controller.messageSentConfirmationReminder":
    "richiamo: domanda di conferma generica",
  "main.controller.messageSentMissingButtonReminder":
    "richiamo: pulsante che non c'era",
  "main.controller.messageSentSkills": "skill: {skills}",
  "main.controller.noReplyTitle": "Il Coordinatore non ha scritto una risposta",
  "main.controller.commandActivityFallback": "Comando",
  "main.controller.commandExitCode": "Uscita {code}",
  "main.controller.fileChangeTitle": "Modifica di {files} file",
  "main.controller.fileChangeTitle.one": "Modifica di {files} file",
  "main.controller.tramaToolTitle": "Strumento di Trama: {tool}",
  "main.controller.reasoningTitle": "Ragionamento",
  "main.controller.coordinatorNoteTitle": "Nota del Coordinatore",

  // Continuous work and delegated steps
  "main.controller.stepUnderstandingSummary":
    'Comprensione della richiesta "{request}".',
  "main.controller.stepSeamsSummary": "Seam del piano {plan}: {seams}.",
  "main.controller.stepSlicesSummary": "Fette del piano {plan}: {slices}.",
  "main.controller.stepStillWriting":
    "Il Coordinatore sta ancora scrivendo questo passo: correggilo quando ha finito.",
  "main.controller.stepCorrectedTitle": "{step}: corretto",
  "main.controller.slicesBackTitle":
    "Le fette del piano {plan} tornano in preparazione",
  "main.controller.slicesBackDetail":
    "Le issue già pubblicate ({issues}) restano su GitHub: il Coordinatore le aggiorna o le chiude.",
  "main.controller.roundFallbackSpecialist": "Uno specialista",
  "main.controller.roundWorksOnSlice": "{name} lavora sulla fetta {slice}",
  "main.controller.roundWorksOnAssignment":
    "{name} lavora sull'incarico {assignment}",
  "main.controller.roundStartedMove": 'Avviata la mossa "{move}"',
  "main.controller.coordinatorPausedTitle": "Coordinatore in pausa",
  "main.controller.coordinatorPausedDetail":
    "Nessuna mossa automatica, nessun giro e nessun lavoro automatico partono finché non riprendi il Coordinatore.",
  "main.controller.coordinatorResumedTitle": "Coordinatore ripreso",
  "main.controller.stepNoLongerAvailable":
    "Questo passo non è più disponibile.",
  "main.controller.queuedMessageGone":
    "Il messaggio è già partito o non è più in coda.",
  "main.controller.queuedMessageNotRemovable":
    "Questo messaggio riferisce al Coordinatore una scelta già registrata: parte comunque.",
  "main.controller.goalDialogBusyTurn":
    "Il Coordinatore sta rispondendo su questo obiettivo: aspetta la fine del turno.",
  "main.controller.goalDialogBusyQueue":
    "L'obiettivo ha un messaggio in coda: aspetta che parta o eliminalo.",

  // Ask Trama routes
  "main.controller.routeNotFound": "Percorso {route} non trovato.",
  "main.controller.routeWaitTurn":
    "Aspetta la fine del turno del Coordinatore prima di rispondere al percorso.",
  "main.controller.routeBoundaryTitle": "{label} per il percorso {route}",

  // MARK: Controller: goals, pact, team, candidates and learning
  // Goals
  "main.controller.goalCardTitle": "Obiettivo",
  "main.controller.focusNotSavedUnreadable":
    "Il focus non è stato salvato: lo stato del progetto non è leggibile e Trama non lo sovrascrive.",
  "main.controller.focusNotSaved": "Il focus non è stato salvato: {error}",
  "main.controller.goalNotSavedUnreadable":
    "L'obiettivo non è stato salvato: lo stato del progetto non è leggibile e Trama non lo sovrascrive.",
  "main.controller.goalNotSaved": "L'obiettivo non è stato salvato: {error}",
  "main.controller.projectNotRecent": "Il progetto non è tra quelli recenti.",
  // Pact and mandate
  "main.controller.decisionChangedStop":
    "La decisione {decision} è cambiata o è in revisione.",
  "main.controller.mandateCorrectedStop":
    "Il mandato corretto non copre più questo lavoro.",
  "main.controller.projectMandateCardTitle": "Mandato di progetto",
  "main.controller.mandateRestrictedStop":
    "Il mandato ristretto non copre più questo lavoro. Il worktree resta com'è.",
  "main.controller.mandateRevokedStop": "Mandato revocato: {reason}",
  // Team
  "main.controller.waitingForDeveloperTitle":
    "In attesa di uno sviluppatore libero",
  "main.controller.waitingForDeveloperDetail":
    "Nei progetti aperti lavorano già {count} sviluppatori, il massimo condiviso. L'incarico parte appena se ne libera uno, secondo l'ordine dei progetti della Panoramica.",
  "main.controller.waitingForDeveloperDetail.one":
    "Nei progetti aperti lavorano già {count} sviluppatore, il massimo condiviso. L'incarico parte appena se ne libera uno, secondo l'ordine dei progetti della Panoramica.",
  "main.controller.mandateNoLongerCoversAssignment":
    "Il mandato non copre più questo incarico.",
  "main.controller.startSkippedTitle": "Avvio non eseguito",
  "main.controller.assignmentProviderNoAdapter":
    "{provider} non ha un adattatore.",
  "main.controller.providerCannotWork":
    "{provider} non può lavorare ora: {reason}",
  "main.controller.assignmentWaitingProviderTitle":
    "Incarico in attesa del provider",
  "main.controller.assignmentResumedTitle": "Ripresa dell'incarico",
  "main.controller.assignmentStartedTitle": "Avvio dell'incarico",
  "main.controller.assignmentRunsInWorktree": "{model}, worktree proprio",
  "main.controller.assignmentRunsReadOnly": "{model}, sola lettura",
  "main.controller.worktreeReadyTitle": "Worktree pronto",
  "main.controller.dependenciesUnavailableTitle": "Dipendenze non disponibili",
  "main.controller.stopBeforeStart":
    "L'arresto è stato richiesto prima dell'avvio.",
  "main.controller.stopBeforeTurn":
    "L'arresto è stato richiesto prima dell'avvio del turno.",
  "main.controller.newSpecialistThreadTitle": "Nuovo thread dello specialista",
  "main.controller.specialistNoteTitle": "Nota dello specialista",
  "main.controller.specialistReasoningTitle": "Ragionamento",
  "main.controller.specialistCommandTitle": "Comando",
  "main.controller.specialistCommandExit": "Uscita {code}",
  "main.controller.specialistEditedFiles": "Ha modificato {count} file",
  "main.controller.specialistEditedFiles.one": "Ha modificato un file",
  "main.controller.specialistEditFailed": "Modifica dei file non riuscita",
  "main.controller.specialistNoReport":
    "Lo specialista non ha scritto un resoconto.",
  "main.controller.turnNotStarted": "Il turno non era partito.",
  "main.controller.decisionCardTitle": "Decisione",
  "main.controller.assignmentCompletedTitle": "Incarico concluso",
  "main.controller.stopConfirmedTitle": "Arresto confermato",
  "main.controller.pausedForQuestionTitle": "In pausa per una domanda",
  "main.controller.assignmentFailedTitle": "Incarico non riuscito",
  "main.controller.waitingProviderUnblockTitle":
    "In attesa che {provider} si sblocchi",
  "main.controller.waitingProviderUnblockDetail":
    "{reason} Trama riprende da solo l'incarico quando torna disponibile, se il mandato lo copre ancora.",
  "main.controller.providerBlockedNotificationTitle":
    "Trama: {provider} bloccato",
  "main.controller.providerBlockedNotificationBody":
    "Il lavoro di {specialist} in {project} aspetta che {provider} si sblocchi.",
  "main.controller.exampleProjectName": "Progetto di esempio",
  "main.controller.waitingTemporaryLimitTitle":
    "In attesa che il limite temporaneo di {provider} passi",
  "main.controller.waitingTemporaryLimitDetail":
    "Non è la quota dell'account. Trama riprende da sola l'incarico tra {seconds} secondi, se il mandato lo copre ancora.",
  "main.controller.developerQuestionTitle":
    "Domanda {question} al Coordinatore",
  "main.controller.answerReceivedTitle": "Risposta ricevuta",
  "main.controller.answerReceivedDetail":
    "Trama riprende il lavoro con la risposta.",
  "main.controller.projectStateReadOnly":
    "Lo stato di questo progetto è in sola lettura.",
  "main.controller.exampleProjectDutiesStill":
    "Nel progetto di esempio i compiti automatici restano fermi.",
  "main.controller.projectChangedDutyNotStarted":
    "Il progetto è cambiato: il lavoro automatico non è partito.",
  "main.controller.problemIssuesUnreadable":
    "GitHub CLI non ha letto le issue: {error}",
  "main.controller.problemIssueNotOpened":
    "La issue non è stata aperta: {error}",
  "main.controller.selfPickTitle":
    "{developer} prende in autonomia la fetta {slice}",
  "main.controller.worktreeConflictNotificationTitle":
    "Trama: conflitto tra due worktree",
  "main.controller.worktreeConflictNotificationBody":
    "Il candidato {candidate} entra in conflitto con {other}: si risolve prima dell'unione.",
  "main.controller.parallelDevelopersNotInteger":
    "Il numero di sviluppatori in parallelo deve essere un numero intero.",
  "main.controller.developersPerSquadNotInteger": "Il numero di sviluppatori per squadra deve essere un numero intero.",
  "main.controller.activeSquadsNotInteger": "Il numero di squadre al lavoro insieme deve essere un numero intero.",
  "main.controller.noTurnRunning": "Nessun turno in corso.",
  "main.controller.noSessionToReorder": "Il Coordinatore non ha ancora una sessione da riordinare.",
  "main.controller.cloudStopUntracked":
    "Trama non segue più la sessione cloud. La sessione si ferma dalla sua pagina di Claude Code.",
  "main.controller.personActor": "Persona",
  "main.controller.stoppedByPerson": "Fermato dalla persona",
  "main.controller.noWorktreeToRemove":
    "L'incarico non ha un worktree da rimuovere.",
  "main.controller.stopBeforeRemovingWorktree":
    "Ferma l'incarico prima di rimuovere il worktree.",
  "main.controller.worktreeInUse":
    "Un altro incarico sta lavorando in questo worktree: aspetta che finisca.",
  "main.controller.worktreeRemovedTitle": "Worktree rimosso",
  "main.controller.worktreeRemovedBranchDeleted":
    "Anche il branch {branch} è stato eliminato: non aveva commit.",
  "main.controller.worktreeRemovedBranchKept": "Il branch {branch} resta.",
  "main.controller.modelNotInCatalog":
    "Il modello {model} non è nel catalogo di {provider}.",
  "main.controller.assignmentProviderChangedTitle":
    "Provider dell'incarico cambiato",
  "main.controller.assignmentProviderChangedDetail":
    "{provider} {model}. Incarico e worktree restano; la prossima ripresa apre una sessione nuova.",
  "main.controller.currentMandateNoLongerCovers":
    "Il mandato attuale non copre più questo incarico.",
  "main.controller.assignmentWorktreeRemoved":
    "Il worktree di questo incarico è stato rimosso: assegna un nuovo incarico.",
  "main.controller.assignmentRedelegatedTitle":
    "Incarico ridelegato sulle decisioni attuali",
  "main.controller.developerRenamedTitle": "Sviluppatore rinominato",
  "main.controller.developerRenamedDetail":
    "{previous} ora si chiama {name} ({id}).",
  "main.controller.dependsOnStop": "Dipende da {assignment}. {reason}",
  // Checks and candidates
  "main.controller.checkoutCheckPassed": "Verifica {check}: superata",
  "main.controller.checkoutCheckFailed": "Verifica {check}: non superata",
  "main.controller.candidateCheckEnvironment":
    "Verifica {check} su {candidate}: non riuscita per la sandbox o la macchina, le evidenze restano quelle di prima",
  "main.controller.candidateCheckPassed":
    "Verifica {check} su {candidate}: superata",
  "main.controller.candidateCheckFailed":
    "Verifica {check} su {candidate}: non superata",
  "main.controller.gateReviewersTitle":
    "Revisori sul candidato {candidate}: {status}",
  "main.controller.reviewUnreadableVerdict":
    "La revisione tecnica non ha restituito un verdetto leggibile.",
  "main.controller.tramaQuitting": "Trama si sta chiudendo.",
  "main.controller.noReadOnlyModelForReviewers":
    "Nessun modello in sola lettura disponibile per i revisori del candidato.",
  "main.controller.blockingFindingsTitle":
    "{reviewer} a {developer}: {count} rilievi bloccanti sul candidato {candidate}",
  "main.controller.blockingFindingsTitle.one":
    "{reviewer} a {developer}: {count} rilievo bloccante sul candidato {candidate}",
  "main.controller.findingsWaitAssignmentGone":
    "L'incarico non c'è più: serve un nuovo incarico.",
  "main.controller.findingsWaitProjectClosed":
    "Il progetto non è aperto: il lavoro riprende quando lo riapri.",
  "main.controller.findingsWaitMandate":
    "Il mandato attuale non copre più questo incarico: il lavoro riprende quando lo concedi di nuovo.",
  // Focus mode and publication
  "main.controller.candidateNotFound": "Candidato non trovato.",
  "main.controller.focusNoWorktree":
    "Il candidato non ha più il suo worktree: la focus mode non può leggerlo.",
  "main.controller.focusWorktreeChanged":
    "Il worktree è cambiato dopo la dichiarazione del candidato {candidate}: la focus mode esamina solo il candidato dichiarato.",
  "main.controller.noReadOnlyModelForAxes":
    "Nessun modello in sola lettura disponibile per gli assi di code-review.",
  "main.controller.confirmationFailed":
    "La conferma di {model} non è riuscita: {error}",
  "main.controller.commitMessageRefused":
    "Trama non scrive questo messaggio di commit: {problems} Chiedi al Coordinatore di correggerlo.",
  "main.controller.candidateSuperseded":
    "Il candidato è stato sostituito da un lavoro più recente: pubblica quello nuovo.",
  "main.controller.candidateNotVerified":
    "Il candidato non è verificato: {blockers}.",
  "main.controller.candidateNeedsApproval":
    "Rivedi e approva il candidato prima di pubblicarlo.",
  "main.controller.candidateAlreadyPublished":
    "Il candidato è già pubblicato: {url}",
  "main.controller.candidatePublishedMessage":
    "Ho pubblicato il candidato {candidate} come pull request #{number}: {url}",
  "main.controller.projectNoGitHubRemote":
    "Il progetto non ha un remoto GitHub.",
  "main.controller.candidateBranchFallback": "branch del candidato",
  "main.controller.publicationStandardMissing":
    "Il candidato non rispetta lo standard di pubblicazione: {missing}",
  "main.controller.gitHubUnreachable": "GitHub non è raggiungibile.",
  "main.controller.gitHubNoPushPermission":
    "Il tuo account GitHub non ha il permesso di push su {repository}.",
  "main.controller.pullRequestPublishedTitle":
    "Pull request #{number} pubblicata",
  // Merge
  "main.controller.mergeInterrupted":
    "L'unione è stata interrotta: Trama riprova.",
  "main.controller.mergeUnknownHead":
    "Trama non conosce il commit pubblicato nella pull request #{number}: uniscila su GitHub dopo averla guardata.",
  "main.controller.mergeCandidateChanged":
    "Il candidato è cambiato dopo il via libera: serve un nuovo via libera sul candidato com'è ora.",
  "main.controller.mergeWaitingChecks":
    "Aspetto le verifiche della pull request #{number}.",
  "main.controller.mergeChecksRed":
    "Le verifiche della pull request #{number} su GitHub sono rosse: il Coordinatore le sistema prima dell'unione.",
  "main.controller.mergeCommitByCoordinator":
    "Via libera del Coordinatore sul candidato {candidate}, unito da Trama.",
  "main.controller.mergeCommitByPerson":
    "Ok della persona sulle schermate sul candidato {candidate}, unito da Trama.",
  "main.controller.shotNotFound": "Schermata non trovata.",
  "main.controller.shotOutsideFolder":
    "Schermata fuori dalla cartella di Trama.",
  "main.controller.candidateRejectedTitle": "Candidato {candidate} rifiutato",
  "main.controller.rejectionAssignmentGone": "L'incarico non c'è più.",
  "main.controller.candidateRejectedMessage":
    "Ho rifiutato il candidato {candidate} di {developer}: {reason}\nIl lavoro non riprende da solo ({waiting}): fallo correggere con un nuovo incarico.",
  "main.controller.candidateRejectedMessageNoDeveloper":
    "Ho rifiutato il candidato {candidate}: {reason}\nIl lavoro non riprende da solo ({waiting}): fallo correggere con un nuovo incarico.",
  // Tickets and monitor
  "main.controller.monitorNotificationTitle": "Trama: aggiornamenti condivisi",
  "main.controller.monitorNotificationBody":
    "{count} novità su {repository}. Apri Trama per valutarne l'impatto sul tuo lavoro.",
  "main.controller.monitorNotificationBody.one":
    "Una novità su {repository}. Apri Trama per valutarne l'impatto sul tuo lavoro.",
  "main.controller.invalidRepository": "Repository non valido.",
  // Plans and slices
  "main.controller.planCardTitle": "Piano",
  "main.controller.planCancelledByPerson": "Annullato dalla persona.",
  "main.controller.planNoSpecToCorrect":
    "Il piano non ha ancora una spec da correggere.",
  "main.controller.specCorrectedTitle": "Spec del piano {plan} corretta",
  "main.controller.planNoProposalToCorrect":
    "Il piano non ha ancora una proposta da correggere.",
  "main.controller.planCorrectionIncomplete":
    "Un piano corretto ha almeno un passo e un comportamento.",
  "main.controller.planCorrectedTitle": "Piano {plan} corretto",
  "main.controller.planNotWaitingSeams":
    "Il piano non aspetta una risposta sui seam.",
  "main.controller.seamsCorrectionEmpty": "Scrivi cosa cambiare nei seam.",
  "main.controller.seamsConfirmedTitle": "Seam del piano {plan} confermati",
  "main.controller.seamsCorrectedTitle": "Seam del piano {plan} corretti",
  "main.controller.planNoSpecToPublish":
    "Il piano non ha una spec pronta da pubblicare.",
  "main.controller.specStaysInTrama":
    "GitHub non è collegato: la spec resta in Trama.",
  "main.controller.specNotPublished":
    "La spec non è stata pubblicata su GitHub: {error}",
  "main.controller.specPublishedTitle":
    "Spec del piano {plan} pubblicata come issue #{issue}",
  "main.controller.gitHubNotConnected": "GitHub non è collegato.",
  "main.controller.specIssueNotUpdated":
    "La issue #{issue} non ha preso la correzione: {error}",
  "main.controller.noModelForPlanner":
    "Nessun modello disponibile per il pianificatore.",
  "main.controller.repositoryChangedDuringPlan":
    "Il repository è cambiato durante l'analisi: rivaluta il piano o chiedine uno nuovo.",
  "main.controller.planNotWaitingSlices":
    "Il piano non aspetta una risposta sulle fette.",
  "main.controller.slicesCorrectionEmpty": "Scrivi cosa cambiare nelle fette.",
  "main.controller.slicesConfirmedTitle": "Fette del piano {plan} confermate",
  "main.controller.slicesCorrectedTitle": "Fette del piano {plan} corrette",
  "main.controller.planNoSpecToSlice":
    "Il piano non ha una spec pronta da dividere in fette.",
  "main.controller.slicesAlreadyInProgress":
    "Le fette del piano sono già in preparazione o proposte.",
  "main.controller.sliceBlockedInTextOnly":
    "#{issue} bloccata da {blocker} solo nel testo: {error}",
  "main.controller.sliceNotPublished":
    "La fetta {slice} non è stata pubblicata: {error}",
  "main.controller.slicesPublishedTitle":
    "Fette del piano {plan} pubblicate come issue",
  "main.controller.planNoApprovedSlices":
    "Il piano non ha fette approvate da pubblicare.",
  "main.controller.slicesStayInTrama":
    "GitHub non è collegato: le fette restano in Trama.",
  "main.controller.noModelForSlicer":
    "Nessun modello disponibile per dividere il lavoro in fette.",
  // Example project and working method
  "main.controller.pactDemoOnlyExample":
    "Lo scenario vale solo per il progetto di esempio.",
  "main.controller.pactDemoApprover": "Utente locale di Trama, simulazione",
  "main.controller.aiHeroUpdatedTitle":
    "Metodo di lavoro AI Hero aggiornato da {version}: {count} file",
  "main.controller.aiHeroUpdatedTitle.one":
    "Metodo di lavoro AI Hero aggiornato da {version}: {count} file",
  "main.controller.aiHeroPreparedTitle":
    "Metodo di lavoro AI Hero: {count} file creati",
  "main.controller.aiHeroPreparedTitle.one":
    "Metodo di lavoro AI Hero: {count} file creati",
  "main.controller.aiHeroRollbackTitle":
    "Aggiornamento del metodo AI Hero annullato",
  "main.controller.aiHeroRollbackKept":
    "Modificato da te dopo l'aggiornamento, non ripristinato: {path}",
  "main.controller.unknownExercise": "Esercizio sconosciuto.",
  "main.controller.conflictExerciseOnlyExample":
    "L'esercizio di conflitto vale solo per il progetto di esempio.",
  "main.controller.conflictExerciseNeedsCandidate":
    "Serve un candidato non pubblicato in un worktree: completa prima l'esercizio di modifica.",
  "main.controller.conflictExerciseDone":
    "Il confronto di esercizio è già stato fatto sul candidato {candidate}.",
  "main.controller.conflictExerciseTitle": "Esercizio di conflitto",
  "main.controller.conflictExerciseDetail":
    "Trama crea due modifiche simulate in una copia locale separata e le confronta con il candidato {candidate}. Non c'è un collaboratore reale e non si usa la rete.",
  // Learning
  "main.controller.learningReviewFailedTitle":
    "La revisione dell'esperienza non è riuscita",
  "main.controller.learningReviewTitle": "Revisione dell'esperienza",
  "main.controller.learningReviewDetail":
    "{actions}\nLo trovi in Memoria: puoi correggere o ritirare quanto appreso.",
  "main.controller.skillPinned":
    "'{name}' è fissata: togli il fissaggio prima di archiviarla.",
  "main.controller.skillMissing": "La skill {name} non esiste più.",
  // Settings
  "main.controller.languageUnavailable": "Lingua non disponibile.",
  "main.controller.sharedDevelopersNotInteger":
    "Il numero di sviluppatori condivisi deve essere un numero intero.",

  // MARK: Fixed roles and work phases (duties.ts, workPhase.ts)
  // duties.ts: why an issue is no longer new for triage, stored in the ledger and shown after "Ultima esclusa".
  "main.duties.droppedClosed": "è stata chiusa",
  "main.duties.droppedTriageState": "ha già lo stato di triage `{role}`",
  "main.duties.droppedInAssignment": "è già in lavoro nell'incarico {id}",
  "main.duties.droppedInPlan": "è già in lavoro nel piano {id}",
  "main.duties.droppedPullRequest": "ha la pull request #{number} collegata",
  "main.duties.unknownCommit": "sconosciuto",
  // duties.ts: objectives of the automatic work.
  "main.duties.triageObjective": "Triage della issue #{number}: {title}",
  "main.duties.placeCandidate": "candidato {id}",
  "main.duties.placeCheckout": "checkout al commit {commit}",
  "main.duties.diagnosisObjective":
    "Diagnosi: la verifica {check} non passa sul {place}",
  "main.duties.diagnosisObjectiveRegression":
    "Diagnosi: la verifica {check} non passa sul {place}, e prima passava",
  "main.duties.fixObjective":
    "Correzione con test di regressione: la verifica {check} sul {place}",
  "main.duties.reviewObjective":
    "Revisione dell'architettura al commit {commit}",
  "main.duties.domainObjective": "Glossario e ADR dalle decisioni {decisions}",
  // duties.ts: why a fix waits.
  "main.duties.fixNoModules":
    "La diagnosi non indica moduli del progetto: la correzione la assegna il Coordinatore.",
  "main.duties.fixWorkingCopyGone":
    "La copia di lavoro del candidato non c'è più: la correzione la assegna il Coordinatore.",
  "main.duties.fixNotCovered":
    "Il mandato non copre la correzione su {modules}: parte quando il mandato lo permette.",
  "main.duties.fixWaitsForWork":
    "La correzione aspetta che finisca il lavoro in corso su {modules}.",
  "main.duties.fixRoleBusy":
    "La correzione aspetta: il bug triage non può prenderla ora.",
  // duties.ts: where the architecture review stands.
  "main.duties.reviewCleanCodeBusy":
    "Clean Code è al lavoro sull'incarico {id}: la revisione aspetta che finisca.",
  "main.duties.reviewAlreadyDone":
    "Clean Code ha già rivisto il commit {commit}: torna a proporre dopo i prossimi cambiamenti al codice.",
  "main.duties.reviewCardOpen":
    "Aspetta la tua risposta alla scheda {card} con le proposte della revisione precedente.",
  "main.duties.reviewNoChangeSinceLast":
    "Nessun lavoro ha cambiato il codice dall'ultima revisione: parte quando il team finisce un lavoro che cambia il codice ed è libero.",
  "main.duties.reviewNoChangeYet":
    "Nessun lavoro del team ha ancora cambiato il codice: parte quando il team finisce un lavoro che cambia il codice ed è libero.",
  "main.duties.reviewHeadUnknown":
    "Trama non legge il commit del checkout: la revisione parte quando lo legge.",
  "main.duties.reviewTeamBusy":
    "Aspetta che il team sia libero: {count} incarichi sono al lavoro.",
  "main.duties.reviewTeamBusy.one":
    "Aspetta che il team sia libero: un incarico è al lavoro.",
  "main.duties.reviewCoordinatorBusy":
    "Aspetta che il Coordinatore finisca il turno in corso.",
  "main.duties.reviewDue":
    "Parte ora: il team è libero e ha cambiato il codice dall'ultima revisione (commit {commit}).",
  // duties.ts: why the person or the Coordinator cannot start the work now.
  "main.duties.requestMandateMissing":
    "Senza un mandato concesso Trama non avvia i compiti automatici dei ruoli fissi.",
  "main.duties.requestProviderUnavailable":
    "Nessun provider collegato può eseguire ora il lavoro dei ruoli fissi.",
  "main.duties.requestRoleBusy":
    "{role} è già al lavoro sull'incarico {id}: riprova quando finisce.",
  "main.duties.requestCardOpen":
    "La scheda {card} con le proposte della revisione precedente aspetta ancora la tua risposta.",
  "main.duties.requestHeadUnknown":
    "Trama non legge il commit del checkout: la revisione non può partire.",
  "main.duties.requestGitHubUnavailable":
    "Trama non legge le issue di GitHub: il triage non può partire.",
  "main.duties.requestIssueNotFound":
    "La issue #{number} non è tra quelle che Trama legge su GitHub.",
  "main.duties.requestIssueClosed":
    "La issue #{number} è chiusa: il triage riguarda le issue aperte.",
  // duties.ts: where each piece of automatic work stands.
  "main.duties.runnerMissing":
    "Nessun provider collegato può eseguirlo ora: parte quando il provider del Coordinatore è disponibile.",
  "main.duties.mandateMissing":
    "Senza un mandato concesso resta fermo: parte quando concedi un mandato.",
  "main.duties.triageNoGitHub":
    "Trama non legge le issue di GitHub: il triage parte quando le legge.",
  "main.duties.triageNothingNew":
    "Nessuna issue nuova da smistare: parte quando arriva una issue aperta dopo che Trama ha iniziato a seguire il progetto, non ancora in lavoro e senza pull request collegate.",
  "main.duties.triageLastDropped": "Ultima esclusa: #{number}, che {reason}.",
  "main.duties.triageOthers": " (e altre {count} dopo)",
  "main.duties.triageWaitsRole":
    "La issue #{number}{others} aspetta che il bug triage finisca l'incarico {id}.",
  "main.duties.triageWaitsDiagnosis":
    "La issue #{number}{others} aspetta la diagnosi di una verifica non superata, che viene prima.",
  "main.duties.triageDue": "Parte ora sulla issue #{number}{others}.",
  "main.duties.diagnosisNothing":
    "Nessuna verifica non superata da diagnosticare: parte quando un test o una verifica di Trama fallisce.",
  "main.duties.diagnosisWaitsRole":
    "La verifica {check} aspetta che il bug triage finisca l'incarico {id}.",
  "main.duties.diagnosisDue": "Parte ora sulla verifica {check} non superata.",
  "main.duties.domainNothing":
    "Nessuna proposta di glossario o ADR da scrivere: parte quando il Coordinatore ne trae una dalle tue decisioni.",
  "main.duties.domainNotAllowed":
    "Il mandato non permette di scrivere la proposta {id}: aspetta una correzione del mandato.",
  "main.duties.domainNotAllowedOn":
    "Il mandato non permette di scrivere la proposta {id} su {modules}: aspetta una correzione del mandato.",
  "main.duties.domainNoMandate": "La proposta {id} aspetta un mandato.",
  "main.duties.domainWaitsRole":
    "La proposta {id} aspetta che il ruolo Documentazione e dominio finisca l'incarico {assignment}.",
  "main.duties.domainWaitsWork":
    "La scrittura della proposta {id} aspetta che finisca il lavoro in corso su {modules} (incarico {assignment}).",
  "main.duties.domainWaitsRunner": "La proposta {id} aspetta.",
  "main.duties.domainDue": "Parte ora la scrittura della proposta {id}.",
  "main.duties.running": "In corso nell'incarico {id}: {objective}.",
  // duties.ts: why a domain proposal waits to be written.
  "main.duties.writingNoMandate":
    "Senza un mandato valido nessuno scrive i file: la proposta aspetta il mandato.",
  "main.duties.writingNotAllowed":
    "Il mandato non permette di lavorare in una copia di lavoro: la proposta aspetta una correzione del mandato.",
  "main.duties.writingNotAllowedOn":
    "Il mandato non permette di lavorare in una copia di lavoro su {modules}: la proposta aspetta una correzione del mandato.",
  "main.duties.writingNoRunner":
    "Nessun provider può eseguire ora il lavoro del ruolo Documentazione e dominio.",
  "main.duties.writingRoleBusy":
    "Il ruolo Documentazione e dominio è occupato: scrive la proposta appena è libero.",
  "main.duties.writingWaitsWork":
    "La scrittura aspetta che finisca il lavoro in corso su {modules}.",
  "main.duties.writingRoleUnavailable":
    "La scrittura aspetta: il ruolo Documentazione e dominio non può prenderla ora.",
  // duties.ts: why Trama picked the model of the automatic work.
  "main.duties.modelLight":
    "Scelto da Trama: il modello più leggero del catalogo, per il lavoro automatico dei ruoli fissi.",
  "main.duties.modelFallback":
    "Scelto da Trama: il catalogo non ha un modello leggero riconoscibile, quindi usa quello del Coordinatore.",
  // duties.ts: the readable results of the automatic work.
  "main.duties.triageResultTitle":
    "**Triage della issue #{number}: {category}, `{state}` ({stateLabel}).**",
  "main.duties.headingVerification": "### Verifica",
  "main.duties.headingAlreadyImplemented": "### Già presente nel codice",
  "main.duties.headingProposedComment": "### Commento proposto per la issue",
  "main.duties.triageOpenedByCoordinator":
    "Il Coordinatore ha aperto questa issue per un problema trovato: Trama le applica le etichette di triage. Il commento resta una tua scelta.",
  "main.duties.triageNothingPublished":
    "Trama non pubblica niente su GitHub: etichette e commento restano una tua scelta.",
  "main.duties.diagnosisReproducedTitle":
    "**Bug riprodotto: il ciclo di verifica va in rosso.**",
  "main.duties.diagnosisNotReproducedTitle":
    "**Bug non riprodotto: manca un ciclo di verifica che vada in rosso.**",
  "main.duties.headingLoop": "### Ciclo di verifica",
  "main.duties.headingSeams": "### Punti di prova",
  "main.duties.headingHypotheses": "### Ipotesi",
  "main.duties.headingCause": "### Causa",
  "main.duties.headingRegressionTest": "### Test di regressione",
  "main.duties.headingFix": "### Correzione",
  "main.duties.headingOpenQuestions": "### Cosa serve",
  "main.duties.architectureNothing":
    "**Niente da segnalare**: Clean Code non ha trovato occasioni di approfondimento.",
  "main.duties.architectureProposals": "**{count} proposte di Clean Code.**",
  "main.duties.architectureProposals.one": "**Una proposta di Clean Code.**",
  "main.duties.proposalFiles": "File: {files}",
  "main.duties.proposalFilesNotGiven": "non indicati",
  "main.duties.proposalProblem": "Problema: {text}",
  "main.duties.proposalSolution": "Soluzione: {text}",
  "main.duties.proposalBenefits": "Benefici: {text}",
  // duties.ts: the Pact card with Clean Code's proposals.
  "main.duties.cardQuestion":
    "Quale miglioramento dell'architettura vuoi approfondire?",
  "main.duties.cardReviewed":
    "Clean Code ha rivisto il progetto al commit {commit} (incarico {id}).",
  "main.duties.cardAdvice": "Consiglio: {text}",
  "main.duties.cardOtherProposals":
    "Le altre {count} proposte sono nel risultato dell'incarico.",
  "main.duties.cardFilesNotGiven": "File non indicati",
  "main.duties.cardWarning": "Attenzione: {text}",
  "main.duties.cardNoneForNow": "Nessuno per ora",
  "main.duties.cardNoneExample":
    "Il codice resta com'è; Clean Code torna a proporre dopo i prossimi cambiamenti.",
  // duties.ts: the last update of a finished duty.
  "main.duties.triageLine": "Triage della issue #{number}: {category}, {state}",
  "main.duties.diagnosisLineReproduced": "Diagnosi: bug riprodotto.",
  "main.duties.diagnosisLineNotReproduced": "Diagnosi: bug non riprodotto",
  "main.duties.architectureLineProposals":
    "Revisione dell'architettura: {count} proposte da decidere",
  "main.duties.architectureLineNothing":
    "Revisione dell'architettura: niente da segnalare",

  // workPhase.ts: the phases of the work.
  "main.workPhase.phaseClarification": "chiarimento",
  "main.workPhase.phaseSpec": "spec",
  "main.workPhase.phaseSlices": "fette",
  "main.workPhase.phaseExecution": "esecuzione",
  "main.workPhase.phaseVerification": "verifica",
  "main.workPhase.phaseCandidate": "candidato",
  "main.workPhase.phaseMerged": "unito",
  "main.workPhase.phaseBlocked": "bloccata",
  // workPhase.ts: the person's step buttons.
  "main.workPhase.answerQuestions": "Rispondi alla domanda",
  "main.workPhase.answerQuestionsMany": "Rispondi alle {count} domande",
  "main.workPhase.confirmUnderstanding": "Conferma la comprensione",
  "main.workPhase.confirmUnderstandingMessage":
    "Confermo la comprensione condivisa: procedi.",
  "main.workPhase.grantMandate": "Concedi il mandato",
  "main.workPhase.confirmTeam": "Conferma il team",
  "main.workPhase.confirmSeams": "Conferma i punti di prova",
  "main.workPhase.confirmSlices": "Conferma le fette",
  "main.workPhase.reviewPlan": "Rivedi il piano",
  "main.workPhase.reviewCandidate": "Verifica il candidato",
  "main.workPhase.mergePullRequest": "Unisci la pull request",
  // workPhase.ts: the Coordinator's moves.
  "main.workPhase.preparePlan": "Prepara il piano",
  "main.workPhase.preparePlanMessage": "Prepara il piano.",
  "main.workPhase.assignWork": "Assegna il lavoro",
  "main.workPhase.assignWorkMessage": "Assegna il lavoro.",
  "main.workPhase.verifyCandidate": "Esegui le verifiche",
  "main.workPhase.verifyCandidateMessage": "Esegui le verifiche del lavoro.",
  "main.workPhase.answerQuestion": "Rispondi allo sviluppatore",
  "main.workPhase.answerQuestionMessage":
    "Rispondi alla domanda dello sviluppatore.",
  // workPhase.ts: the moves that resolve a technical block.
  "main.workPhase.blockCheckFailed": "Risolvi la verifica rossa",
  "main.workPhase.blockWorktreeConflict": "Risolvi il conflitto",
  "main.workPhase.blockStalledAssignment": "Riprendi l'incarico fermo",
  "main.workPhase.blockCheckFailedPhrase": "Sto risolvendo la verifica rossa",
  "main.workPhase.blockWorktreeConflictPhrase": "Sto risolvendo il conflitto",
  "main.workPhase.blockStalledAssignmentPhrase":
    "Sto riprendendo l'incarico fermo",
  // workPhase.ts: whose work it is.
  "main.workPhase.workOfOnSlice": "lavoro di {name} su {slice}",
  "main.workPhase.workOf": "lavoro di {name}",
  "main.workPhase.workOnSlice": "lavoro su {slice}",
  "main.workPhase.work": "lavoro",
  // workPhase.ts: why the work is blocked, for the person.
  "main.workPhase.whyCheckFailed": "Una verifica del {work} non è passata.",
  "main.workPhase.whyDecisionChanged":
    "Una decisione del Patto è cambiata dopo il {work}: va rivisto.",
  "main.workPhase.whyUnresolvedChoice": "Il {work} lascia aperta una scelta.",
  "main.workPhase.whyExternalEffect":
    "Il {work} ha un effetto esterno che Trama non sa verificare.",
  "main.workPhase.whyRemoteConflict":
    "Il {work} è in conflitto con il branch principale su GitHub: vanno riallineati.",
  "main.workPhase.whyWorktreeConflict":
    "Il {work} tocca gli stessi file di un altro lavoro in corso.",
  "main.workPhase.whySemanticConflict":
    "Il {work} non funziona insieme a un altro lavoro in corso: una verifica fallisce sulle due modifiche unite.",
  "main.workPhase.whyCloudCheckFailed":
    "Il {work} viene dal cloud e non ha superato i controlli sul Mac.",
  "main.workPhase.whyNotMergeable": "Il {work} non si può ancora unire.",
  "main.workPhase.whyPlanFailed": "Il piano non è riuscito: va rifatto.",
  "main.workPhase.whyPlanStale":
    "Il repository è cambiato mentre si scriveva il piano: va rifatto.",
  "main.workPhase.whySlicingFailed":
    "La divisione del piano in fette non è riuscita: va rivista.",
  "main.workPhase.whyProvider":
    "Il {work} aspetta che {provider} torni disponibile.",
  "main.workPhase.whyFailed": "Il {work} non è riuscito.",
  "main.workPhase.whyStopped": "Il {work} è stato fermato.",
  "main.workPhase.whyReviewChanges":
    "La revisione tecnica chiede modifiche al {work}.",
  "main.workPhase.whyPaused":
    "Il {work} è in pausa: aspetta la tua risposta a una domanda.",
  // workPhase.ts: why the work is blocked, with the records' ids.
  "main.workPhase.blockerCheckFailed":
    "La verifica {check} del candidato {id} non è passata.",
  "main.workPhase.blockerDecisionChanged":
    "La decisione {decision} è cambiata dopo il candidato {id}.",
  "main.workPhase.blockerGate":
    "I revisori hanno un rilievo bloccante sul candidato {id}: {detail}",
  "main.workPhase.blockerUnresolvedChoice":
    "Il candidato {id} lascia aperta una scelta: {detail}",
  "main.workPhase.blockerExternalEffect":
    "Il candidato {id} ha un effetto esterno che Trama non verifica: {detail}",
  "main.workPhase.blockerRemoteConflict":
    "Il candidato {id} è in conflitto con il lavoro su GitHub: {detail}",
  "main.workPhase.blockerWorktreeConflict":
    "Il candidato {id} è in conflitto con il lavoro di un altro incarico: {detail}",
  "main.workPhase.blockerHeld": "La revisione ha fermato il lavoro dell'incarico {assignment} {rounds} volte di seguito, l'ultima sul candidato {candidate}. Trama non lo rimanda più allo sviluppatore e la persona lo trova in Aspetta te: non assegnare altre correzioni e non rilanciare i revisori finché la persona non ti scrive come andare avanti.",
  "main.workPhase.blockerSemanticConflict":
    "Il candidato {id} non funziona insieme al lavoro di un altro incarico: {detail}",
  "main.workPhase.blockerCloudCheckFailed":
    "Il candidato {id} viene da una sessione cloud e non ha superato i controlli sul Mac: {detail}",
  "main.workPhase.blockerOther":
    "Il candidato {id} è bloccato: {reason}. {detail}",
  "main.workPhase.blockerPlanFailed": "Il piano {id} non è riuscito.",
  "main.workPhase.blockerPlanFailedWith":
    "Il piano {id} non è riuscito: {failure}",
  "main.workPhase.blockerPlanStale":
    "Il repository è cambiato mentre si scriveva il piano {id}: va rifatto.",
  "main.workPhase.blockerSlicingFailed":
    "La divisione in fette del piano {id} non è riuscita.",
  "main.workPhase.blockerSlicingFailedWith":
    "La divisione in fette del piano {id} non è riuscita: {failure}",
  "main.workPhase.blockerProvider":
    "L'incarico {id} aspetta che {provider} torni disponibile.",
  "main.workPhase.blockerFailed": "L'incarico {id} non è riuscito.",
  "main.workPhase.blockerFailedWith":
    "L'incarico {id} non è riuscito: {failure}",
  "main.workPhase.blockerStopped": "L'incarico {id} è stato fermato.",
  "main.workPhase.blockerReviewChanges":
    "La revisione tecnica del candidato {id} chiede modifiche.",
  "main.workPhase.blockerPausedSlice":
    "La fetta {slice} è in pausa: lo sviluppatore aspetta la tua risposta alla domanda {question}.",
  "main.workPhase.blockerPausedAssignment":
    "L'incarico {id} è in pausa: lo sviluppatore aspetta la tua risposta alla domanda {question}.",

  // MARK: Providers and Codex
  // Shared by every provider runtime.
  "main.provider.emptyMessage": "Il messaggio è vuoto.",
  "main.provider.turnRunning": "Un turno è già in corso.",
  "main.opencode.compactFailed": "OpenCode non ha compattato la sessione: {error}",
  "main.provider.turnInterrupted": "Turno interrotto.",
  "main.provider.invalidModel": "Modello non valido: {model}",
  "main.provider.closed": "{provider} è stato chiuso.",
  "main.provider.temporaryLimit": "{provider} ha un limite temporaneo.",
  "main.provider.usageLimit": "{provider} ha raggiunto il limite di utilizzo.",
  "main.provider.noMethods": "nessuno",

  // registry.ts, codex.ts
  "main.registry.noAdapter":
    "Il provider {id} non ha ancora un adattatore in Trama.",
  "main.codex.writeOutsideThread":
    "Il turno chiede di scrivere fuori dalla cartella del thread di Codex.",

  // acp/acpRuntime.ts
  "main.acpRuntime.notResponding": "{provider} è installato ma non risponde.",
  "main.acpRuntime.doesNotStart": "{provider} è installato ma non si avvia.",
  "main.acpRuntime.notInstalled":
    "{provider} non è installato o non è nel PATH.",
  "main.acpRuntime.accessAction": "accesso",
  "main.acpRuntime.closedInput": "{provider} ha chiuso l'input: {error}",
  "main.acpRuntime.closedOutput": "{provider} ha chiuso l'output: {error}",
  "main.acpRuntime.didNotStart": "{provider} non si è avviato: {error}",
  "main.acpRuntime.exited": "{provider} è terminato (codice {code}).",
  "main.acpRuntime.notRunning": "{provider} non è attivo.",
  "main.acpRuntime.requestTimeout":
    "{provider} non ha risposto a {method} entro {seconds} s.",
  "main.acpRuntime.notAccepting": "{provider} non accetta più messaggi.",
  "main.acpRuntime.frameTooLarge":
    "{provider} ha inviato un messaggio oltre il limite di 8 MB.",
  "main.acpRuntime.requestFailed": "Richiesta ACP non riuscita.",
  "main.acpRuntime.noModels": "{provider} non ha restituito modelli.",
  "main.acpRuntime.sessionNewWithoutId":
    "{provider}: risposta session/new senza sessionId.",
  "main.acpRuntime.sessionNotOpen":
    "{provider}: la sessione {session} non è aperta.",
  "main.acpRuntime.sessionNoLongerOpen":
    "{provider}: la sessione {session} non è più aperta.",
  "main.acpRuntime.idleStopped":
    "Turno fermato: {provider} non ha dato segni di attività per {minutes} min.",
  "main.acpRuntime.signInRequired": "{provider} richiede l'accesso: {message}",
  "main.acpRuntime.sessionDidNotStart":
    "{provider} non ha avviato la sessione: {message}",
  "main.acpRuntime.toolCallFailed": "Chiamata allo strumento non riuscita.",
  "main.acpRuntime.callFailed": "Chiamata non riuscita.",

  // antigravity.ts
  "main.antigravity.notInstalled":
    "Antigravity CLI (agy) non è installato o non è nel PATH.",
  "main.antigravity.unknownModel":
    "Il modello {model} non è disponibile in Antigravity CLI. Cambia modello e riprova. Dettaglio di agy: {detail}",
  "main.antigravity.promptTooLong":
    "Su Windows Antigravity accetta al massimo {max} caratteri, perché il prompt passa come argomento della riga di comando. Accorcia il messaggio o allega il contenuto come file.",
  "main.antigravity.deniedCommand":
    "Negato da Trama: Antigravity non può eseguire comandi di shell, perché non restano nel worktree né fuori dalla rete.",
  "main.antigravity.deniedNetwork":
    "Negato da Trama: gli strumenti di rete non sono consentiti.",
  "main.antigravity.deniedTool":
    "Negato da Trama: con Antigravity sono consentiti solo lettura, modifiche nel worktree e gli strumenti di Trama.",
  "main.antigravity.readOnlyDeniedCommand":
    "Negato da Trama: in sola lettura Antigravity non può eseguire comandi di shell.",
  "main.antigravity.deniedRead":
    "Negato da Trama: Antigravity legge solo nel progetto, nel suo worktree e nelle cartelle che Trama permette.",
  "main.antigravity.readOnlyDeniedTool":
    "Negato da Trama: in sola lettura Antigravity può usare solo gli strumenti di lettura e quelli di Trama.",
  "main.antigravity.checkFailed":
    "Controllo di Antigravity CLI non riuscito: {error}",
  "main.antigravity.versionCheckTimeout":
    "Il controllo della versione di Antigravity CLI è scaduto.",
  "main.antigravity.versionCheckFailed":
    "Il controllo della versione di Antigravity CLI non è riuscito.",
  "main.antigravity.modelsTimeout": "agy models non ha risposto in tempo.",
  "main.antigravity.modelsFailed": "agy models non è riuscito.",
  "main.antigravity.unknownThread":
    "Thread Antigravity sconosciuto: aprilo prima di avviare un turno.",
  "main.antigravity.cwdOutsideWorktree":
    "Antigravity lavora solo dentro il worktree dello specialista: la cartella del turno è fuori.",
  "main.antigravity.startFailed":
    "Avvio di Antigravity CLI non riuscito: {error}",
  "main.antigravity.exitedWithoutResult":
    "Antigravity CLI è terminato senza un risultato completo.",
  "main.antigravity.exitedWithCode":
    "Antigravity CLI è terminato con codice {code}.",
  "main.antigravity.modelsCheckTimeout":
    "Antigravity CLI è installato, ma l'elenco dei modelli non ha risposto in tempo: Trama non ha potuto verificare l'accesso.",
  "main.antigravity.modelsCheckFailed":
    "Antigravity CLI è installato, ma Trama non ha potuto verificare l'accesso elencando i modelli.",

  // claudeAgent.ts
  "main.claudeAgent.notInstalled":
    "Claude Code non trovato. Installa Claude Code e accedi con `claude login` dal terminale.",
  "main.claudeAgent.signedOut":
    "Accedi a Claude con `claude login` dal terminale per usarlo in Trama.",
  "main.claudeAgent.noAuthStatus":
    "Questa versione di Claude Code non ha `claude auth status`. Aggiorna Claude Code.",
  "main.claudeAgent.authJsonWithoutStatus":
    "Impossibile verificare l'accesso a Claude: l'output JSON non indica lo stato.",
  "main.claudeAgent.commandExited": "Il comando è terminato con codice {code}.",
  "main.claudeAgent.authCheckFailed":
    "Impossibile verificare l'accesso a Claude. {detail}",
  "main.claudeAgent.authCheckTimeout":
    "Impossibile verificare l'accesso a Claude: il comando non ha risposto in tempo.",
  "main.claudeAgent.authCheckError":
    "Impossibile verificare l'accesso a Claude: {error}",
  "main.claudeAgent.apiKeyLabel": "Chiave API Claude",
  "main.claudeAgent.retryAfter": "Riprova dopo le {time}.",
  "main.claudeAgent.usageLimit":
    "Hai raggiunto il limite di utilizzo di Claude.",
  "main.claudeAgent.toolServerNoAnswer":
    "Il server degli strumenti di Trama non ha risposto: {error}",
  "main.claudeAgent.orgNotAllowed":
    "L'accesso a Claude è riuscito, ma questa organizzazione non consente Claude Code.",
  "main.claudeAgent.accountOnHold":
    "L'account Claude attivo è sospeso. Risolvi il problema dell'account e riprova.",
  "main.claudeAgent.billingError":
    "Problema di fatturazione o abbonamento Claude. Controlla l'account attivo e riprova.",
  "main.claudeAgent.rateLimit":
    "Limite di richieste di Claude raggiunto. Attendi un momento e riprova.",
  "main.claudeAgent.overloaded":
    "Claude è temporaneamente sovraccarico. Riprova tra poco.",
  "main.claudeAgent.invalidRequest":
    "Claude ha rifiutato la richiesta perché non valida.",
  "main.claudeAgent.modelNotFound":
    "Il modello Claude scelto non è disponibile per questo account.",
  "main.claudeAgent.serverError":
    "Claude ha restituito un errore del server. Riprova tra poco.",
  "main.claudeAgent.maxOutputTokens":
    "Claude ha raggiunto la lunghezza massima della risposta prima di finire il turno.",
  "main.claudeAgent.turnNotCompleted":
    "Claude non è riuscito a completare il turno.",
  "main.claudeAgent.sessionGone":
    "La sessione Claude non esiste più. Apri una nuova conversazione.",
  "main.claudeAgent.sandboxUnavailable":
    "Il sandbox di Claude Code non è disponibile su questo sistema: le modifiche nella worktree non sono consentite.",
  "main.claudeAgent.stoppedWithError": "Claude si è fermato con un errore.",
  "main.claudeAgent.stoppedWithoutCompleting":
    "Claude si è fermato senza completare il turno.",
  "main.claudeAgent.schemaNotMet":
    "Claude non è riuscito a produrre una risposta conforme allo schema richiesto.",
  "main.claudeAgent.maxTurns":
    "Claude ha raggiunto il numero massimo di passaggi per questo turno.",
  "main.claudeAgent.modelListTimeout":
    "Timeout in attesa dell'elenco dei modelli Claude.",
  "main.claudeAgent.noModels":
    "Claude Code non ha restituito i modelli: {error}",

  // opencode.ts
  "main.opencode.notInstalled":
    "OpenCode CLI non trovato. Installa OpenCode (https://opencode.ai) o indica il percorso del comando nelle impostazioni.",
  "main.opencode.truncated": "[troncato]",
  "main.opencode.emptyOutput": "<vuoto>",
  "main.opencode.serverStartTimeout":
    "Timeout in attesa dell'avvio del server OpenCode.",
  "main.opencode.serverExitedBeforeStart":
    "Il server OpenCode è terminato prima di avviarsi (codice {code}).",
  "main.opencode.notExecutable":
    "OpenCode CLI non trovato o non eseguibile. Installa OpenCode (https://opencode.ai).",
  "main.opencode.cannotStart": "Impossibile avviare OpenCode: {error}",
  "main.opencode.apiMissing":
    "Questa versione di OpenCode non espone l'API richiesta da Trama (GET /provider → HTTP {status}). Aggiorna OpenCode.",
  "main.opencode.unreachable": "irraggiungibile",
  "main.opencode.serverNotResponding":
    "Il server OpenCode non risponde (GET /provider → {outcome}).",
  "main.opencode.invalidProviderList":
    "OpenCode ha restituito un elenco provider non valido.",
  "main.opencode.invalidModel":
    "Modello OpenCode non valido: {model}. Usa il formato provider/modello.",
  "main.opencode.sessionFailed": "La sessione OpenCode non è riuscita.",
  "main.opencode.notResponding": "OpenCode non risponde: {error}",
  "main.opencode.emptyProviderList":
    "OpenCode ha restituito un elenco provider vuoto.",
  "main.opencode.connectProvider":
    "Collega un provider in OpenCode con `opencode auth login` per usarlo in Trama.",
  "main.opencode.permissionsNotApplied":
    "OpenCode non ha applicato i permessi di Trama: {error}",
  "main.opencode.noSessionCreated":
    "OpenCode session.create non ha restituito una sessione.",
  "main.opencode.messageNotAccepted":
    "OpenCode non ha accettato il messaggio: {error}",
  "main.opencode.serverExited":
    "Il server OpenCode è terminato (codice {code}).",
  "main.opencode.reservedServerName":
    "Un server MCP di OpenCode usa il nome {name}, riservato agli strumenti di Trama.",
  "main.opencode.toolsNotConnectedDetail":
    "OpenCode non ha collegato gli strumenti di Trama: {error}",
  "main.opencode.toolsNotConnected":
    "OpenCode non ha collegato gli strumenti di Trama.",
  "main.opencode.permissionPolicyNotApplied":
    "OpenCode non ha applicato la politica dei permessi di Trama: {error}",
  "main.opencode.turnWithoutAnswer":
    "OpenCode ha chiuso il turno senza una risposta.",

  // pi.ts
  "main.pi.toolServerStatus":
    "Il server degli strumenti di Trama ha risposto {status}.",
  "main.pi.invalidMcpResponse": "Risposta MCP non valida.",
  "main.pi.mcpError": "Errore MCP.",
  "main.pi.hostToolFailed": "Lo strumento di Trama non è riuscito.",
  "main.pi.invalidToolCatalog":
    "tools/list ha restituito un catalogo non valido.",
  "main.pi.sdkUnavailable": "SDK di Pi non disponibile: {error}",
  "main.pi.credentialsUnreadable":
    "Pi non ha potuto leggere le credenziali: {error}",
  "main.pi.toolsNotConnected":
    "Pi non ha potuto collegare gli strumenti di Trama: {error}",
  "main.pi.modelUnavailable": "Il modello Pi {model} non è disponibile.",
  "main.pi.sessionStartFailed": "Avvio della sessione Pi non riuscito: {error}",
  "main.pi.extensionsNotBound":
    "Pi non ha potuto collegare le sue estensioni: {error}",
  "main.pi.sessionNotOpen": "La sessione Pi non è aperta.",
  "main.pi.imageUnreadable": "Impossibile leggere l'immagine allegata: {path}",
  "main.pi.sessionNoLongerOpen": "La sessione Pi non è più aperta.",
  "main.pi.turnFailed": "Il turno di Pi non è riuscito.",
  "main.pi.toolFailed": "Strumento non riuscito.",

  // acp/cursor.ts
  "main.cursor.cannotCheckAccess":
    "Questa versione di Cursor Agent non permette di verificare l'accesso. Aggiorna cursor-agent.",
  "main.cursor.accessCheckFailed":
    "Trama non riesce a verificare l'accesso di Cursor Agent.",
  "main.cursor.notInstalled":
    "Cursor Agent CLI (cursor-agent) non trovato. Installalo e accedi con `cursor-agent login`.",
  "main.cursor.accessCheckTimeout":
    "Cursor Agent non ha risposto alla verifica dell'accesso.",
  "main.cursor.accessCheckError":
    "Trama non riesce a verificare l'accesso di Cursor Agent: {error}",

  // acp/devin.ts
  "main.devin.browserOnly":
    "Devin offre solo un accesso dal browser ({methods}). Imposta WINDSURF_API_KEY oppure esegui `devin auth login`, poi riprova.",
  "main.devin.noHeadlessMethod":
    "Devin non offre un metodo di accesso senza browser (metodi offerti: {methods}). Aggiorna Devin.",
  "main.devin.serverUrlRejected":
    "L'indirizzo del server API di Devin non è accettato: serve HTTPS (HTTP solo su loopback) e nessuna credenziale nell'URL.",
  "main.devin.notInstalled":
    "Devin CLI (devin) non trovato. Installalo e accedi con `devin auth login`.",
  "main.devin.apiKeyLabel": "Chiave API Devin",
  "main.devin.cliSignInLabel": "Accesso Devin CLI",

  // acp/droid.ts
  "main.droid.noSignIn":
    "Droid non ha un accesso disponibile. Esegui `droid` per accedere oppure imposta FACTORY_API_KEY.",
  "main.droid.notInstalled":
    "Droid CLI (droid) non trovato. Installalo e accedi eseguendo `droid`.",
  "main.droid.apiKeyLabel": "Chiave API Factory",
  "main.droid.cliSignInLabel": "Accesso Droid CLI",

  // acp/grok.ts
  "main.grok.apiKeyRequired":
    "Grok richiede una chiave API: imposta XAI_API_KEY oppure esegui `grok login`.",
  "main.grok.browserOnly":
    "Grok non ha un accesso utilizzabile senza browser. Esegui `grok login` e riprova (metodi offerti: {methods}).",
  "main.grok.apiKeyNotOffered":
    "Grok non offre l'accesso con chiave API anche se XAI_API_KEY è impostata (metodi offerti: {methods}). Aggiorna Grok.",
  "main.grok.noHeadlessMethod":
    "Grok non offre un metodo di accesso senza browser (metodi offerti: {methods}). Aggiorna Grok.",
  "main.grok.notInstalled":
    "Grok CLI (grok) non trovato. Installalo e accedi con `grok login`.",
  "main.grok.apiKeyLabel": "Chiave API xAI",
  "main.grok.cliSignInLabel": "Accesso Grok CLI",

  // codexClient.ts
  "main.codexClient.notInstalled":
    "Codex CLI non trovato. Installa Codex e accedi con ChatGPT dal terminale o da Collegamenti.",
  "main.codexClient.mcpInventoryMissing":
    "Codex non ha restituito l'inventario MCP necessario al runtime ristretto.",
  "main.codexClient.mcpInventoryUnreadable": "Inventario MCP non leggibile.",
  "main.codexClient.mcpEntryWithoutName":
    "L'inventario MCP contiene una voce senza nome valido.",
  "main.codexClient.reservedServerName":
    "Un server MCP globale usa il nome {name}, riservato agli strumenti di Trama.",
  "main.codexClient.fileChangeAction": "Modifica di {path}",
  "main.codexClient.invalidAccountRead": "risposta account/read non valida",
  "main.codexClient.accountWithoutPlan": "account ChatGPT senza piano",
  "main.codexClient.usageExhausted":
    "Hai esaurito l'utilizzo di ChatGPT (piano {plan}).",
  "main.codexClient.unknownAccountType": "sconosciuto",
  "main.codexClient.incompleteLoginStart":
    "risposta account/login/start incompleta",
  "main.codexClient.modelListTooManyPages":
    "model/list ha superato il limite di pagine",
  "main.codexClient.incompleteModelList": "risposta model/list incompleta",
  "main.codexClient.threadStartWithoutId":
    "risposta thread/start senza thread.id",
  "main.codexClient.turnStartWithoutId": "risposta turn/start senza turn.id",
  "main.codexClient.unsupportedAccount":
    "Trama accetta solo un account ChatGPT. Codex usa un account di tipo {type}.",
  "main.codexClient.signIn":
    "Accedi con ChatGPT da Collegamenti per usare Codex.",
  "main.codexClient.appServerExited":
    "Codex app-server è terminato (codice {code}).",
  "main.codexClient.appServerClosedPipe":
    "Codex app-server ha chiuso la comunicazione: {error}",
  "main.codexClient.incompleteInitialize": "risposta initialize incompleta",
  "main.codexClient.appServerNotRunning": "Codex app-server non è attivo.",
  "main.codexClient.requestTimeout": "Timeout in attesa di {method}.",
  "main.codexClient.rpcError": "errore JSON-RPC",
  "main.codexClient.modelError": "errore del modello",
  "main.codexClient.unknownError": "errore sconosciuto",

  // MARK: Checks, reviewers, deep review and conventions
  // gate.ts
  "main.gate.checksFailedNote":
    "Non è partito: una verifica richiesta non è passata.",
  "main.gate.environmentNote":
    "Non è partito: una verifica richiesta non è riuscita per la sandbox o la macchina.",
  "main.gate.environmentFailure":
    "Le verifiche {checks} non sono riuscite per la sandbox o la macchina: rilancia la revisione quando girano.",
  "main.gate.secretNote":
    "Non è partito: il diff contiene un segreto, e Trama non lo manda ai modelli.",
  "main.gate.secretTitle": "Segreto nel diff: {secret}",
  "main.gate.secretDetail":
    "Trama l'ha trovato prima dei revisori: togli il segreto dal lavoro e, se è una chiave vera, revocala.",
  "main.gate.secretReport":
    "Trama ha trovato nel diff: {secrets}. Nessun modello ha ricevuto il diff.",
  "main.gate.noSuiteReport":
    "Il candidato non richiede build né test: non c'è una suite da confrontare.",
  "main.gate.noSuiteTitle": "Nessuna suite da confrontare",
  "main.gate.noSuiteDetail":
    "Tra le verifiche richieste non ci sono build né test.",
  "main.gate.regressionTitle": "Regressione: {check}",
  "main.gate.regressionDetail":
    "{check} passa sulla base e fallisce sul candidato.",
  "main.gate.notComparable": "{check} non confrontabile",
  "main.gate.alreadyFailing": "{check} fallisce già sulla base",
  "main.gate.changesRequested": "Il revisore chiede modifiche",
  "main.gate.reviewsFailed":
    "{names}: revisione non riuscita. Rilancia la revisione.",
  "main.gate.interrupted":
    "La revisione si è interrotta alla chiusura di Trama: rilanciala.",
  "main.gate.summary.skipped": "{name}: {report}.",
  "main.gate.summary.skippedDefault": "saltato",
  "main.gate.summary.failed": "{name}: revisione non riuscita.",
  "main.gate.summary.running": "{name}: in corso.",
  "main.gate.summary.blocking":
    "{name}: {count} rilievi bloccanti, il primo: {first}.",
  "main.gate.summary.blocking.one":
    "{name}: 1 rilievo bloccante, il primo: {first}.",
  "main.gate.summary.suggestions": "{name}: {count} suggerimenti.",
  "main.gate.summary.suggestions.one": "{name}: 1 suggerimento.",
  "main.gate.summary.nothing": "{name}: niente da segnalare.",
  "main.gate.summary.secretOthers":
    "Gli altri revisori non sono partiti: il diff contiene un segreto, e Trama non lo manda ai modelli.",
  "main.gate.summary.checksFailed": "Verifiche non superate: {checks}.",
  "main.gate.summary.checksOthers":
    "Gli altri revisori non sono partiti: la verifica fallita passa al debugger.",
  "main.gate.waiting.specialistBusy":
    "Lo sviluppatore lavora a un altro incarico: riprende questo quando è libero.",
  "main.gate.waiting.parallelLimit":
    "Gli sviluppatori al lavoro sono già al limite del progetto: il lavoro riprende quando uno si libera.",
  "main.gate.waiting.workNotIndependent":
    "Qualcuno lavora sugli stessi moduli: il lavoro riprende quando finisce.",
  "main.gate.waiting.noWorktree":
    "La copia di lavoro dell'incarico non c'è più: serve un nuovo incarico.",
  "main.gate.waiting.specialistRemoved":
    "Lo sviluppatore non è più nel team: serve un nuovo incarico.",
  "main.gate.unreadableAnswer":
    "Il revisore non ha restituito un rapporto leggibile.",
  "main.gate.malformedFinding":
    "Il revisore ha restituito un rilievo fuori dallo schema: la revisione non vale.",

  // quality.ts
  "main.quality.secret.privateKey": "chiave privata",
  "main.quality.secret.githubToken": "token GitHub",
  "main.quality.secret.apiKey": "chiave API",
  "main.quality.secret.awsKey": "chiave AWS",
  "main.quality.secret.slackToken": "token Slack",
  "main.quality.secret.googleKey": "chiave Google",
  "main.quality.secret.assignedCredential": "credenziale assegnata",
  "main.quality.sensitiveFile": "file sensibile {path}",
  "main.quality.secretIn": "{label} in {file}",
  "main.quality.aFile": "un file",
  "main.quality.blocker.BASE_CHANGED": "la base del progetto è cambiata",
  "main.quality.blocker.DECISION_CHANGED": "una decisione è cambiata",
  "main.quality.blocker.UNRESOLVED_CHOICE": "c'è una scelta non risolta",
  "main.quality.blocker.EXTERNAL_EFFECT_UNSUPPORTED":
    "c'è un effetto esterno non supportato",
  "main.quality.blocker.EVIDENCE_MISSING": "una verifica non è stata eseguita",
  "main.quality.blocker.EVIDENCE_STALE": "una verifica non vale più",
  "main.quality.blocker.CHECK_FAILED": "una verifica non è passata",
  "main.quality.blocker.GATE_BLOCKED": "un revisore ha un rilievo bloccante",
  "main.quality.blocker.GATE_RUNNING": "i revisori sono ancora al lavoro",
  "main.quality.blocker.GATE_FAILED": "una figura non ha finito la revisione",
  "main.quality.blocker.REMOTE_CONFLICT":
    "c'è un conflitto con il lavoro su GitHub",
  "main.quality.blocker.CLOUD_CHECK_FAILED":
    "il lavoro della sessione cloud non ha superato i controlli sul Mac",
  "main.quality.blocker.WORKTREE_CONFLICT":
    "c'è un conflitto con il lavoro di un altro incarico",
  "main.candidates.worktreeChanged": "La copia di lavoro è cambiata dopo questo candidato: dichiarane uno nuovo dalla copia di lavoro.",
  "main.quality.blocker.WORKTREE_CHANGED": "la copia di lavoro è cambiata dopo il candidato",
  "main.quality.blocker.SEMANTIC_CONFLICT":
    "insieme al lavoro di un altro incarico una verifica non passa",
  "main.quality.verified.missing": "Non è verificato: {blockers}.",
  "main.quality.verified.fix":
    "Chiedi al Coordinatore di correggere il lavoro e di verificare un nuovo candidato.",
  "main.quality.verified.passed":
    "Tutte le {count} verifiche richieste sono passate nella sandbox.",
  "main.quality.commit.noAssignment":
    "Trama non trova l'incarico del candidato.",
  "main.quality.commit.fix":
    "Chiedi al Coordinatore di correggere il messaggio con set_commit_message.",
  "main.quality.commit.rulesFrom": "{header} (regole da {sources})",
  "main.quality.secrets.found": "Trovato: {secrets}.",
  "main.quality.secrets.fix":
    "Togli il segreto o il file dal lavoro e dichiara un nuovo candidato; una chiave esposta va anche revocata.",
  "main.quality.secrets.none":
    "Nessun segreto né file sensibile nelle modifiche.",
  "main.quality.diffCheck.notRun":
    "git diff --check non è stato eseguito su questo candidato.",
  "main.quality.diffCheck.notRunFix":
    "Chiedi al Coordinatore di dichiarare un nuovo candidato: Trama lo controlla alla dichiarazione.",
  "main.quality.diffCheck.fix":
    "Togli gli spazi in fondo alle righe e i marcatori di conflitto, poi dichiara un nuovo candidato.",
  "main.quality.diffCheck.clean": "git diff --check è pulito.",
  "main.quality.issue.linked": "Collegato alla issue #{issue}.",
  "main.quality.issue.missing":
    "La fetta {slice} non ha ancora la sua issue su GitHub.",
  "main.quality.issue.missingFix":
    "Pubblica su GitHub le fette del piano {plan}, poi riapri la pull request.",
  "main.quality.issue.none": "Il lavoro non ha una issue da collegare.",
  "main.quality.pact.open": "Domande del Patto ancora aperte: {questions}.",
  "main.quality.pact.openFix":
    "Rispondi alle domande aperte o ritirale con un motivo.",
  "main.quality.pact.settled": "Nessuna decisione del Patto è rimasta aperta.",
  "main.quality.mandate.fix":
    "Concedi o correggi il mandato con l'azione Aprire pull request, poi prepara la pull request.",
  "main.quality.mandate.allowed": "Il mandato permette di aprire pull request.",

  // auditFindings.ts
  "main.auditFindings.noQuote": "La prova non cita il testo della riga.",
  "main.auditFindings.unread": "Trama non legge questo percorso: {reason}",
  "main.auditFindings.outsideFiles":
    "`{file}` è fuori dai file che Trama legge.",
  "main.auditFindings.place.candidateCopy": "nella copia di lavoro del candidato",
  "main.auditFindings.place.candidate": "su questo candidato",
  "main.auditFindings.place.projectCopy": "nel progetto",
  "main.auditFindings.place.module": "sul modulo {name}",
  "main.auditFindings.place.project": "sul progetto",
  "main.auditFindings.fileMissing":
    "Il file {file} non esiste {copy}.",
  "main.auditFindings.lineMissing":
    "Il file {file} ha {lines} righe: la riga {line} non esiste.",
  "main.auditFindings.quoteMissing":
    "La riga {line} di {file} non contiene il testo citato dall'asse.",
  "main.auditFindings.lineHeld":
    "Trama ha letto {file}:{line} e la riga contiene il testo citato.",
  "main.auditFindings.commandNotOurs":
    "Trama esegue solo le proprie verifiche, e questo comando non è tra quelle di questo esame.",
  "main.auditFindings.checkPassed":
    "Trama ha eseguito {check} {on} e la verifica è superata.",
  "main.auditFindings.checkFailed":
    "Trama ha eseguito {check} {on} e la verifica non è superata.",
  "main.auditFindings.reproduction":
    "Trama non esegue le riproduzioni scritte da un modello.",
  "main.auditFindings.noProof":
    "L'asse non ha dato una prova: resta un'ipotesi.",
  "main.auditFindings.contradicted":
    "{basis} La prova non regge: resta un'ipotesi.",
  "main.auditFindings.minor":
    "{basis} Il rilievo non è grave: resta un'ipotesi.",
  "main.auditFindings.unreadableConfirmation":
    "Il secondo modello non ha restituito una risposta leggibile.",
  "main.auditFindings.incompleteConfirmation":
    "Il secondo modello ha risposto senza esito o senza motivo.",
  "main.auditFindings.unconfirmed": "{basis} {failure} Resta un'ipotesi.",
  "main.auditFindings.confirmed": "Confermato da {model}: {reason}",
  "main.auditFindings.rejected": "{model} non lo conferma: {reason}",
  "main.auditFindings.noStrongerModel":
    "Nessun modello più forte di quello degli assi è disponibile per confermarlo.",

  // audit.ts
  "main.audit.running":
    "La focus mode sul candidato {candidate} è già in corso.",
  "main.audit.commitIssuesSource": "Issue {issues} citate nei commit",
  "main.audit.commitIssuesSource.one": "Issue {issues} citata nei commit",
  "main.audit.sliceSource": "Fetta {slice} del piano {plan}",
  "main.audit.sliceSourceIssue":
    "Fetta {slice} del piano {plan}, issue #{issue}",
  "main.audit.unreadableAnswer":
    "L'asse non ha restituito un rapporto leggibile.",
  "main.audit.emptyReport": "L'asse ha risposto senza rapporto.",
  "main.audit.noFindings": "nessun rilievo",
  "main.audit.findings": "{count} rilievi",
  "main.audit.findings.one": "1 rilievo",
  "main.audit.axisFailed": "{title}: non riuscito.",
  "main.audit.axisLine": "{title}: {findings}.",
  "main.audit.axisLineWorst": "{title}: {findings}, il più grave: {worst}.",
  "main.audit.noReport": "Nessun asse ha prodotto un rapporto.",
  "main.audit.verificationStopped":
    "La verifica si è interrotta prima di ricontrollare la prova.",
  "main.audit.interrupted":
    "La focus mode si è interrotta alla chiusura di Trama: aprila di nuovo.",

  // checks.ts
  "main.checks.title.gitStatus": "stato Git",
  "main.checks.title.gitDiffCheck": "spazi e marcatori di conflitto",
  "main.checks.title.nodeTest": "test Node",
  "main.checks.title.nodeTypecheck": "typecheck Node",
  "main.checks.noDependencies":
    "Il checkout del progetto non ha le dipendenze installate (node_modules): esegui npm ci nel progetto.",
  "main.checks.dependenciesDiffer":
    "Le dipendenze del candidato sono diverse da quelle del checkout (package-lock.json): servirebbe npm ci, che le verifiche non eseguono perché non hanno rete.",
  "main.checks.nodeModulesNotIgnored":
    "git non ignora node_modules in questo progetto: Trama non collega le dipendenze per non cambiare il candidato.",
  "main.checks.sandboxLoopback":
    "[Trama] Alcuni fallimenti vengono dalla sandbox: la rete è permessa solo verso 127.0.0.1, internet è bloccato.",
  "main.checks.sandboxNoNetwork":
    "[Trama] Alcuni fallimenti vengono dalla sandbox senza rete: su questo sistema Trama non ha una sandbox che lasci la rete locale, quindi i test che aprono un server su 127.0.0.1 non possono girare qui.",

  // conventions.ts
  "main.conventions.existingBranches": "branch esistenti",
  "main.conventions.emptyMessage": "Il messaggio è vuoto.",
  "main.conventions.spaceAfterColon":
    "Dopo i due punti serve uno spazio prima della descrizione.",
  "main.conventions.colonPlacement":
    "I due punti vanno subito dopo il tipo o l'ambito, senza spazi.",
  "main.conventions.scopeParentheses":
    "L'ambito va tra una sola coppia di parentesi, subito dopo il tipo.",
  "main.conventions.headerForm":
    'Il titolo deve iniziare con un tipo seguito da due punti e spazio, per esempio "feat: add the search palette". Titolo attuale: "{header}".',
  "main.conventions.typeNotAllowed":
    'Il tipo "{type}" non è tra quelli ammessi dal progetto: {types}.',
  "main.conventions.emptyScope":
    "L'ambito tra parentesi è vuoto: scrivilo o togli le parentesi.",
  "main.conventions.scopeSpaces": 'L\'ambito "{scope}" è un nome senza spazi.',
  "main.conventions.scopeNotAllowed":
    'L\'ambito "{scope}" non è tra quelli ammessi dal progetto: {scopes}.',
  "main.conventions.missingDescription":
    "Manca la descrizione dopo i due punti.",
  "main.conventions.descriptionSpacing":
    "La descrizione segue subito i due punti e un solo spazio.",
  "main.conventions.descriptionCut":
    'La descrizione sembra tagliata a metà: finisce con "{end}". Scrivila completa.',
  "main.conventions.headerTooLong":
    "Il titolo ha {length} caratteri: il progetto ne ammette al massimo {max}.",
  "main.conventions.bodyBlankLine":
    "Il corpo inizia dopo una riga vuota sotto il titolo.",
  "main.conventions.footerSpaces":
    'Il token del footer "{token}" usa spazi: usa i trattini ({hyphenated}).',
  "main.conventions.breakingUppercase":
    '"{token}" va scritto in maiuscolo: BREAKING CHANGE.',
  "main.conventions.breakingDescription":
    "BREAKING CHANGE deve descrivere la modifica incompatibile.",
  "main.conventions.breakingForm":
    "{token} è seguito da due punti, uno spazio e la descrizione.",
  "main.conventions.invalidMessage":
    "Messaggio di commit non valido: {problems}",
  "main.conventions.branchType":
    'Il branch "{branch}" inizia con un tipo: {prefixes}.',
  "main.conventions.branchDescription":
    "Dopo il tipo serve una descrizione breve.",
  "main.conventions.releaseCharacters":
    "La descrizione usa solo minuscole, cifre, trattini e punti.",
  "main.conventions.branchCharacters":
    "La descrizione usa solo minuscole, cifre e trattini; i punti solo nelle versioni di release/.",
  "main.conventions.branchRepeats":
    "Trattini e punti non vanno ripetuti, né all'inizio o alla fine.",

  // practices.ts
  "main.practices.evidence.review": "Revisione tecnica con modifiche richieste",
  "main.practices.evidence.check": "Verifica {check} non superata",
  "main.practices.evidence.failure": "Incarico non riuscito",
  "main.practices.evidence.wait": "Incarico in attesa di un provider bloccato",
  "main.practices.evidence.conflict": "Conflitto riprodotto con altro lavoro",
  "main.practices.retiredByPerson": "Ritirata dalla persona",

  // referenceCheck.ts
  "main.referenceCheck.title": "Riferimento che Trama non trova",
  "main.referenceCheck.detail":
    "La risposta cita {ids}, che non esistono tra i dati di Trama: restano testo semplice.",
  "main.referenceCheck.detail.one":
    "La risposta cita {ids}, che non esiste tra i dati di Trama: resta testo semplice.",

  // coordinatorGrounding.ts
  "main.coordinatorGrounding.missingTitle": "Pulsante citato che ora non c'è",
  "main.coordinatorGrounding.quoted": "«{label}»",
  "main.coordinatorGrounding.named":
    "i pulsanti {buttons}, che ora non ci sono",
  "main.coordinatorGrounding.named.one":
    "il pulsante {buttons}, che ora non c'è",
  "main.coordinatorGrounding.canUse": "Adesso puoi usare: {buttons}.",
  "main.coordinatorGrounding.noButton":
    "Adesso non c'è un pulsante da premere.",
  "main.coordinatorGrounding.detail":
    "Il Coordinatore ha nominato {named}. {now}",

  // MARK: Coordinator loop: continuous work, status line, recap, team
  // Status line
  "main.statusLine.nothingGoingOn": "Niente in corso.",
  "main.statusLine.paused":
    "Coordinatore in pausa: i turni in corso finiscono, poi non parte niente finché non lo riprendi.",
  "main.statusLine.list": "{items} e {last}",
  "main.statusLine.running.preparePlan": "Sto preparando il piano",
  "main.statusLine.running.assignTarget": "Sto assegnando {target}",
  "main.statusLine.running.assignWork": "Sto assegnando il lavoro",
  "main.statusLine.running.verifyTarget": "Sto verificando {target}",
  "main.statusLine.running.verifyWork": "Sto verificando il lavoro",
  "main.statusLine.running.answerQuestion":
    "Sto rispondendo a uno sviluppatore",
  "main.statusLine.running.answerMessage": "Sto rispondendo al tuo messaggio",
  "main.statusLine.running.writingPlan": "Sto scrivendo il piano",
  "main.statusLine.running.slicingPlan": "Sto dividendo il piano in fette",
  "main.statusLine.next.preparePlan": "preparo il piano",
  "main.statusLine.next.assignTarget": "assegno {target}",
  "main.statusLine.next.assignWork": "assegno il lavoro",
  "main.statusLine.next.verifyTarget": "verifico {target}",
  "main.statusLine.next.verifyWork": "verifico il lavoro",
  "main.statusLine.next.answerQuestion": "rispondo allo sviluppatore",
  "main.statusLine.next.waitForYou": "aspetto te",
  "main.statusLine.nowThen": "{now}, poi {next}.",
  "main.statusLine.waitingForYou": "Aspetto te per andare avanti.",
  "main.statusLine.nextIsMine": "Il prossimo passo è mio: {next}.",
  "main.statusLine.workStopped": "Il lavoro è fermo.",
  "main.statusLine.manyAgents": "{count} agenti sono al lavoro",
  "main.statusLine.workingOn": "{names} lavorano su {slices}",
  "main.statusLine.workingOn.one": "{names} lavora su {slices}",
  "main.statusLine.working": "{names} lavorano",
  "main.statusLine.working.one": "{names} lavora",
  "main.statusLine.sliceWaits": "La fetta {slice} aspetta {waitedFor}.",
  "main.statusLine.slicesWait": "Le fette {slices} aspettano {waitedFor}.",
  "main.statusLine.slicesAndOthersWait":
    "Le fette {slices} e altre aspettano {waitedFor}.",

  // Provider wait and resuming (issue #249)
  "main.resumeWork.atTime": "alle {time}",
  "main.resumeWork.onDayAtTime": "il {day} alle {time}",
  "main.resumeWork.unreachable": "Aspetto che {provider} torni raggiungibile.",
  "main.resumeWork.quotaUntil":
    "Aspetto che la quota di {provider} si sblocchi {when}.",
  "main.resumeWork.quota":
    "Aspetto che la quota di {provider} si sblocchi: il provider non dice quando.",
  "main.resumeWork.limitUntil":
    "Aspetto la fine del limite di {provider}, prevista {when}.",
  "main.resumeWork.limit":
    "Aspetto la fine del limite di {provider}: il provider non dice quando finisce.",
  "main.resumeWork.waitReason":
    "Fino ad allora non parte nessun turno. Poi riprendo da solo.",

  // Recap
  "main.recap.sliceDone": "Fetta {slice} fatta{issue}",
  "main.recap.sliceDoneTitled": "Fetta {slice} fatta: {title}{issue}",
  "main.recap.candidateMerged": "Candidato unito con la pull request #{number}",
  "main.recap.goalAchieved": "Obiettivo raggiunto: {title}",
  "main.recap.specIssue": "Aperta la issue #{number} della spec",
  "main.recap.specIssueTitled": "Aperta la issue #{number} della spec: {title}",
  "main.recap.sliceIssue":
    "Aperta la issue #{number} della fetta {slice}: {title}",
  "main.recap.problemIssue":
    "Aperta la issue #{number} per un problema trovato: {title}",
  "main.recap.fact.preparePlan": "Preparazione del piano",
  "main.recap.fact.assignWork": "Assegnazione del lavoro",
  "main.recap.fact.verifyCandidate": "Verifica del lavoro",
  "main.recap.fact.answerQuestion": "Risposta allo sviluppatore",
  "main.recap.fact.answerQuestions": "Risposta alla domanda",
  "main.recap.fact.confirmUnderstanding": "Conferma della comprensione",
  "main.recap.fact.grantMandate": "Concessione del mandato",
  "main.recap.fact.confirmTeam": "Conferma del team",
  "main.recap.fact.confirmSeams": "Conferma dei punti di prova",
  "main.recap.fact.confirmSlices": "Conferma delle fette",
  "main.recap.fact.reviewPlan": "Revisione del piano",
  "main.recap.fact.reviewCandidate": "Verifica del candidato",
  "main.recap.fact.mergePullRequest": "Unione della pull request",
  "main.recap.outcome.running": "in corso",
  "main.recap.outcome.done": "fatta",
  "main.recap.outcome.stalled": "non riuscita",
  "main.recap.outcome.stopped": "fermata",
  "main.recap.outcome.failed": "finita con un errore",
  "main.recap.outcome.corrected": "corretta da te",
  "main.recap.outcome.undone": "annullata",
  "main.recap.stepCorrected": "{label} (corretto da te): {detail}",
  "main.recap.moreMoves": "Altre {count} mosse sono in Attività",
  "main.recap.moreMoves.one": "Un'altra mossa è in Attività",

  // Continuous work
  "main.continuousWork.unblocked":
    "{why} Il Coordinatore ha sbloccato il lavoro: ora è in {phase}.",
  "main.continuousWork.stillBlocked":
    "{why} Il Coordinatore non l'ha risolto in questo turno: ci riprova al prossimo evento o giro.",
  "main.continuousWork.phase.none": "attesa",
  "main.continuousWork.phase.clarification": "chiarimento",
  "main.continuousWork.phase.spec": "spec",
  "main.continuousWork.phase.slices": "fette",
  "main.continuousWork.phase.execution": "esecuzione",
  "main.continuousWork.phase.verification": "verifica",
  "main.continuousWork.phase.candidate": "attesa di unione",
  "main.continuousWork.phase.merged": "unione fatta",
  "main.continuousWork.phase.blocked": "blocco",
  "main.continuousWork.blockResolved":
    "Blocco risolto dal Coordinatore: {kind}",
  "main.continuousWork.blockOpen": "Blocco ancora aperto: {kind}",
  "main.continuousWork.block.checkFailed": "verifica rossa",
  "main.continuousWork.block.worktreeConflict": "conflitto tra lavori",
  "main.continuousWork.block.stalledAssignment": "incarico fermo",
  "main.continuousWork.moveFailed":
    "La mossa automatica non è riuscita: {reason}",
  "main.continuousWork.stall.noPlan":
    "il Coordinatore non ha avviato il piano.",
  "main.continuousWork.stall.noAssignment":
    "il Coordinatore non ha assegnato il lavoro.",
  "main.continuousWork.stall.undeclaredMany":
    "gli incarichi {ids} sono conclusi ma i loro candidati non sono stati dichiarati.",
  "main.continuousWork.stall.undeclaredOne":
    "l'incarico {id} è concluso ma il suo candidato non è stato dichiarato.",
  "main.continuousWork.stall.unverified":
    "le verifiche di {ids} non sono partite.",
  "main.continuousWork.automaticMoveDetail":
    "Mossa del Coordinatore avviata da Trama dentro il mandato, senza chiederti conferma.",

  // Presence
  "main.coordinatorPresence.agentOf": "l'agente {agent} di {person}",

  // The whole cycle within the mandate (A06)
  "main.autonomousCycle.stepNotFound": "Passo del Coordinatore non trovato.",
  "main.autonomousCycle.alreadyCorrected":
    "Hai già corretto questo passo: scrivi al Coordinatore nella chat.",
  "main.autonomousCycle.emptyCorrection": "Scrivi cosa cambiare.",
  "main.autonomousCycle.correction":
    "Correggo {what}: {note}\nRiparti da quel passo con la mia correzione.",
  "main.autonomousCycle.what.confirmUnderstanding":
    "la comprensione condivisa che hai confermato da solo",
  "main.autonomousCycle.what.confirmTeam": "il team che hai confermato da solo",
  "main.autonomousCycle.what.confirmSeams": "i seam che hai confermato da solo",
  "main.autonomousCycle.what.confirmSlices":
    "le fette che hai confermato da solo",
  "main.autonomousCycle.what.formSquads": "le squadre che hai formato da solo",

  // Ask Trama
  "main.askTrama.superseded":
    "Il Coordinatore ha proposto un percorso più recente.",
  "main.askTrama.alreadyAnswered": "Hai già risposto a questo percorso.",
  "main.askTrama.noRunnableStep":
    "Nessun passo di questo percorso è ancora disponibile in Trama.",
  "main.askTrama.declined":
    "Non avvio il percorso {id} di Ask Trama ({steps}).",
  "main.askTrama.start":
    "Avvia il percorso {id} di Ask Trama: {path}, {steps}.",
  "main.askTrama.firstStep": "Primo passo: {skill}.",
  "main.askTrama.firstStepFlow": "Primo passo: {skill} ({flow}).",
  "main.askTrama.boundary": "Confine di fase: {boundary}.",

  // Agent chat
  "main.agentThreads.sliceSubject": "fetta {slice}",
  "main.agentThreads.assignmentSubject": "incarico {id}",

  // Coordinator tools: the cards they open in the chat
  "main.coordinatorTools.card.mandate": "Mandato",
  "main.coordinatorTools.card.decision": "Decisione",
  "main.coordinatorTools.card.teamProposal": "Proposta del team",
  "main.coordinatorTools.card.assignment": "Incarico",
  "main.coordinatorTools.card.route": "Percorso di Ask Trama",
  "main.coordinatorTools.card.domainProposal": "Glossario e ADR",
  "main.coordinatorTools.card.goal": "Obiettivo proposto",
  "main.coordinatorTools.card.candidate": "Candidato",

  // Team
  "main.team.fixedRoleReason":
    "Ogni team di Trama ha questa figura, in ogni progetto.",
  "main.team.inTheTeam": "Nel team",
  "main.team.confirmed": "Ho confermato il team che hai proposto: {members}.",
  "main.team.corrected": "Ho corretto il team: resta {members}.",
  "main.team.removed": "Ho tolto {names}.",
  "main.team.superseded": "La proposta di team precedente non vale più.",
  "main.team.left": "Uscito dal team: {why}",
  "main.team.assignmentReceived": "Incarico ricevuto: {objective}",
  "main.team.worktreeReady": "Worktree pronto sul branch {branch}",
  "main.team.turnRunning": "Turno {number} in corso con {model}",
  "main.team.stopped": "Fermato: {note}",
  "main.team.assignmentDone": "Incarico concluso",
  "main.team.waitsForAnswer": "Aspetta la risposta alla domanda {id}",
  "main.team.providerInterrupted": "Il provider ha interrotto il turno.",
  "main.team.turnFailed": "Turno non riuscito: {message}",
  "main.team.waitsForAnswerAfterFailure":
    "Aspetta la risposta alla domanda {id}. Il turno non è riuscito: {message}",
  "main.team.stopRequested": "Arresto richiesto da {actor}: {why}",
  "main.team.resumed": "Ripresa dell'incarico con {model}",
  "main.team.resumedWithAnswer": "Ripresa con la risposta alla domanda {id}",
  "main.team.resumedWithFindings":
    "Ripresa con i rilievi bloccanti sul candidato {id}",
  "main.team.providerSet":
    "Provider impostato dalla persona: {provider} {model}",

  // MARK: Pact, mandate, goals, plan, slices and candidates
  // pact.ts
  "main.pact.decisionIncomplete":
    "Una decisione richiede comportamento, esempio e motivazione.",
  "main.pact.mandateIncomplete":
    "Un mandato richiede almeno un obiettivo, un modulo e un'azione autorizzata.",
  "main.pact.noMandateToRevoke": "Non c'è un mandato attivo da revocare.",
  "main.pact.revocationReasonMissing": "Indica il motivo della revoca.",
  "main.pact.mandateRequestNotFound": "Richiesta di mandato {id} non trovata.",
  "main.pact.mandateRequestSuperseded":
    "La richiesta di mandato {id} è superata da {newer}: non si può più concedere.",
  "main.pact.newerRequest": "una richiesta più recente",
  "main.pact.mandateRequestAnswered":
    "La richiesta di mandato {id} ha già una risposta.",
  "main.pact.rejectionReasonMissing": "Indica perché rifiuti la proposta.",
  "main.pact.questionNotFound": "Domanda non trovata.",
  "main.pact.questionAlreadyAnswered": "Hai già risposto a questa domanda.",
  "main.pact.questionWithdrawn":
    "Hai ritirato questa domanda: non aspetta più una risposta.",
  "main.pact.alternativeInvalid": "Alternativa non valida.",
  "main.pact.decisionMissing": "Scrivi la tua decisione.",
  "main.pact.answerRationale": "Risposta alla domanda: {question}",
  "main.pact.answeredNotWithdrawable":
    "Hai già risposto a questa domanda: la decisione presa resta e si rivede con una decisione nuova.",
  "main.pact.questionAlreadyWithdrawn": "Hai già ritirato questa domanda.",
  "main.pact.withdrawalReasonMissing": "Indica il motivo del ritiro.",
  "main.pact.withdrawalGrilling":
    "Ho ritirato la domanda {number} del chiarimento, turno {round}: «{question}». Motivo: {reason} Non conta più come domanda aperta.",
  "main.pact.withdrawal":
    "Ho ritirato la domanda «{question}». Motivo: {reason}",
  "main.pact.mandateGranted": "Ho concesso il mandato (versione {version}).",
  "main.pact.mandateCorrected":
    "Ho corretto il mandato: ora è alla versione {version}.",
  "main.pact.mandateRevoked": "Ho revocato il mandato.",
  "main.pact.mandateRevokedWithReason":
    "Ho revocato il mandato. Motivo: {reason}",
  "main.pact.mandateRejectedKept":
    "Ho rifiutato la proposta di mandato {id}. Il mandato in vigore resta la versione {version}, senza modifiche. Motivo: {reason}",
  "main.pact.mandateRejectedNone":
    "Ho rifiutato la proposta di mandato {id}. Resta senza mandato. Motivo: {reason}",
  "main.pact.decisionAnswered":
    "Ho risposto alla domanda «{question}»: {value}. È la decisione {id}, versione {version} del Patto.",

  // pactDemo.ts
  "main.pactDemo.approvalRequired": "Approva questa esatta versione.",
  "main.pactDemo.runFirst": "Esegui prima lo scenario.",
  "main.pactDemo.notVerified": "Lo scenario non è verificato.",

  // projectMandate.ts
  "main.projectMandate.reason":
    "Propongo un mandato per tutto il ciclo di lavoro del progetto: comprensione, squadre, spec, fette, assegnazione, verifica e unione con il via libera. Lo concedi una volta e puoi restringerlo in ogni momento. I divieti fissi restano esclusi.",
  "main.projectMandate.objective":
    "Portare avanti il ciclo di lavoro del progetto: comprensione, squadre, spec, fette, assegnazione, verifica e unione con il via libera.",
  "main.projectMandate.noMandateToRestrict":
    "Non c'è un mandato in vigore da restringere.",
  "main.projectMandate.restrictionAdds":
    "Una restrizione toglie moduli o azioni, non ne aggiunge: per allargare il mandato correggilo.",
  "main.projectMandate.restrictionEmpty":
    "Il mandato ristretto tiene almeno un modulo e un'azione: per togliere tutto revocalo.",
  "main.projectMandate.restrictionNothing": "La restrizione non toglie niente.",
  "main.projectMandate.removedModules": "tolti i moduli {modules}",
  "main.projectMandate.removedActions": "tolte le azioni {actions}",
  "main.projectMandate.dependsOn": "{id} (dipende da {dependsOn})",
  "main.projectMandate.halted":
    "Ho fermato {work}: i worktree restano com'erano, il diff non si perde. Per riprendere, ripianifica e delega di nuovo dentro il mandato ristretto.",
  "main.projectMandate.nothingHalted":
    "Nessun lavoro in corso era fuori dal mandato ristretto.",
  "main.projectMandate.restricted":
    "Ho ristretto il mandato: ora è alla versione {version}, {parts}. {halted} Vale dal tuo prossimo turno: il lavoro fuori dal mandato ristretto non riparte, il resto continua.",
  "main.projectMandate.refusalNotFound": "Azione fermata non trovata.",
  "main.projectMandate.refusalTitle":
    "Azione fermata da un divieto fisso: {ban}",
  "main.projectMandate.refusalDetail":
    "{reason} Nessun mandato la concede: la trovi in Aspetta te.",

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
  "main.goals.onlyCoordinatorProposes":
    "Solo il Coordinatore propone un obiettivo.",
  "main.goals.unknownDecisions": "Decisioni sconosciute: {ids}.",
  "main.goals.alreadyArchived": "L'obiettivo è già archiviato.",
  "main.goals.workRunning":
    "Il lavoro di questo obiettivo è in corso: fermalo o aspetta che finisca prima di archiviarlo.",
  "main.goals.notArchived": "L'obiettivo non è archiviato.",
  "main.goals.hasHistory":
    "Questo obiettivo ha già una cronologia nella chat, che resta. Puoi archiviarlo.",
  "main.goals.candidateNotFound": "Candidato non trovato.",
  "main.goals.candidateChanged":
    "Il candidato è cambiato mentre lo guardavi: ricontrolla gli esempi sulla versione attuale.",
  "main.goals.candidateUnlinked":
    "Il candidato non è collegato a un obiettivo.",
  "main.goals.exampleNotFound": "Esempio non trovato nell'obiettivo.",

  // plan.ts
  "main.plan.specIncomplete":
    "Una spec ha almeno titolo, problema e soluzione.",
  "main.plan.specTooLarge": "La spec supera la dimensione ammessa.",
  "main.plan.invalidJson":
    "La risposta del pianificatore non è un JSON valido.",
  "main.plan.otherSnapshot":
    "La spec si riferisce a un'altra istantanea del progetto.",
  "main.plan.noSeams": "Il pianificatore non ha proposto seam da testare.",
  "main.plan.fieldMissing":
    "La spec del pianificatore non ha il campo {field}.",

  // slices.ts
  "main.slices.noSpec": "Il piano non ha ancora una spec da dividere in fette.",
  "main.slices.tooLarge": "La suddivisione supera la dimensione ammessa.",
  "main.slices.invalidJson": "La risposta del divisore non è un JSON valido.",
  "main.slices.otherSnapshot":
    "La suddivisione si riferisce a un'altra istantanea del progetto.",
  "main.slices.noSlices": "Il divisore non ha proposto fette.",
  "main.slices.tooMany": "Il divisore ha proposto più di 30 fette.",
  "main.slices.sliceIncomplete":
    "La fetta {number} non ha titolo o comportamento da consegnare.",
  "main.slices.noCriteria": "La fetta {number} non ha criteri di accettazione.",
  "main.slices.blockedByLater":
    "La fetta {number} è bloccata da {blocker}: una fetta si blocca solo con fette elencate prima.",

  // slicePicking.ts
  "main.slicePicking.noModules":
    "La fetta non indica moduli: la assegna il Coordinatore.",
  "main.slicePicking.notCovered":
    "Il mandato non copre il lavoro di questa fetta.",
  "main.slicePicking.busy":
    "Aspetta che {who}: lavora sugli stessi moduli.",
  "main.slicePicking.busyWho": "{developer} finisca «{objective}»",
  "main.slicePicking.busyJoin": " e che ",
  "main.slicePicking.someDeveloper": "uno sviluppatore",
  "main.slicePicking.occupied": "Qualcuno tocca ora questi moduli: {names}.",
  "main.slicePicking.noDeveloper":
    "Nessuno sviluppatore libero copre i moduli di questa fetta.",
  "main.slicePicking.noDeveloperInSquad": "Nessuno sviluppatore libero della squadra {squad} copre i moduli di questa fetta.",
  "main.slicePicking.noProvider": "Nessun provider collegato può lavorare ora.",
  "main.slicePicking.modelReason":
    "Presa autonoma della fetta: lo stesso provider e modello del lavoro precedente.",

  // developerQuestions.ts
  "main.developerQuestions.asked": "Domanda {id} al Coordinatore",
  "main.developerQuestions.answeredFromFacts":
    "Il Coordinatore ha risposto alla domanda {id}",
  "main.developerQuestions.waitingForPerson":
    "La domanda {id} aspetta la risposta della persona",
  "main.developerQuestions.personDecision":
    "{answer} (decisione {decision}, versione {version} del Patto)",
  "main.developerQuestions.personWithdrew":
    "La persona ha ritirato la domanda senza decidere. Motivo: {reason}",
  "main.developerQuestions.personAnswered":
    "La persona ha risposto alla domanda {id}",

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
  "main.candidates.superseded":
    "Il candidato è stato sostituito da un lavoro più recente: rivedi quello nuovo.",
  "main.candidates.notVerified": "Il candidato non è verificato: {codes}.",

  // MARK: Repository, GitHub, menu, memory and learning
  // App menu and dialogs (main.ts)
  "main.dialog.openProject": "Apri progetto",
  "main.dialog.chooseFolder": "Scegli la cartella",
  "main.dialog.chooseCloneFolder": "Scegli dove clonare il progetto",
  "main.menu.settings": "Impostazioni…",
  "main.menu.hide": "Nascondi Trama",
  "main.menu.hideOthers": "Nascondi altre",
  "main.menu.showAll": "Mostra tutte",
  "main.menu.quitTrama": "Esci da Trama",
  "main.menu.file": "Archivio",
  "main.menu.openProject": "Apri progetto…",
  "main.menu.openDemo": "Apri progetto di esempio",
  "main.menu.createProject": "Crea un progetto…",
  "main.menu.refreshProject": "Aggiorna progetto",
  "main.menu.closeWindow": "Chiudi finestra",
  "main.menu.quit": "Esci",
  "main.menu.edit": "Composizione",
  "main.menu.undo": "Annulla",
  "main.menu.redo": "Ripeti",
  "main.menu.cut": "Taglia",
  "main.menu.copy": "Copia",
  "main.menu.paste": "Incolla",
  "main.menu.selectAll": "Seleziona tutto",
  "main.menu.view": "Vista",
  "main.menu.focusComposer": "Scrivi al Coordinatore",
  "main.menu.toggleSidebar": "Mostra o nascondi la barra laterale",
  "main.menu.toggleInspector": "Mostra dettagli",
  "main.menu.map": "Mappa",
  "main.menu.pact": "Patto",
  "main.menu.mandate": "Mandato",
  "main.menu.issues": "Issue",
  "main.menu.team": "Team",
  "main.menu.work": "Lavoro",
  "main.menu.group": "Gruppo",
  "main.menu.memory": "Memoria",
  "main.menu.resetZoom": "Dimensione reale",
  "main.menu.zoomIn": "Ingrandisci",
  "main.menu.zoomOut": "Riduci",
  "main.menu.fullScreen": "Schermo intero",
  "main.menu.devTools": "Strumenti per sviluppatori",
  "main.menu.window": "Finestra",
  "main.menu.help": "Aiuto",
  "main.menu.welcome": "Benvenuto in Trama",
  "main.menu.guide": "Guida introduttiva",
  "main.menu.exercises": "Esercizi sul progetto di esempio",
  // Merge and push (merge.ts, push.ts)
  "main.merge.noRemote":
    "Il progetto non ha un remoto GitHub: Trama non apre né unisce la pull request.",
  "main.merge.mandateDoesNotCover":
    "Il mandato non copre l'integrazione di questi moduli: il candidato aspetta la tua revisione.",
  "main.merge.superseded":
    "Il candidato è stato sostituito da un lavoro più recente.",
  "main.merge.alreadyMerged": "Il candidato è già unito.",
  "main.merge.personPublishes":
    "Il candidato lo rivede e lo pubblica la persona.",
  "main.merge.notVerified": "Il candidato non è verificato.",
  "main.merge.gateNotPassed":
    "Il candidato non ha superato il cancello dei revisori.",
  "main.merge.noClearance":
    "Manca il via libera del Coordinatore su questo candidato.",
  "main.merge.clearanceOtherMandate": "Il via libera è stato dato con un mandato diverso da quello in vigore: serve un nuovo via libera.",
  "main.merge.running": "Trama sta unendo il candidato.",
  "main.merge.stopped": "L'unione di questo candidato si è fermata.",
  "main.merge.githubRefused": "GitHub non ha unito la pull request.",
  "main.merge.rejectedByPerson":
    "La persona ha rifiutato il candidato: torna allo sviluppatore.",
  "main.merge.action": "Unione della pull request del candidato {id}",
  "main.merge.actionOnBranch":
    "Unione della pull request del candidato {id} ({branch})",
  "main.merge.candidateNotFound": "Candidato non trovato.",
  "main.merge.rejectMerged":
    "Il candidato è già unito: chiedi al Coordinatore una correzione.",
  "main.merge.rejectNeedsReason":
    "Scrivi perché rifiuti il candidato: il motivo torna allo sviluppatore.",
  "main.merge.mergedByCoordinator":
    "Candidato {id} unito con il via libera del Coordinatore",
  "main.merge.mergedByPerson": "Candidato {id} unito con il tuo ok",
  "main.merge.mergedDetail": "Pull request #{number}: {url}",
  "main.merge.failed": "Unione del candidato {id} non riuscita",
  "main.merge.destructiveTitle": "Unione fermata: serve la tua decisione",
  "main.merge.destructiveDetail": "{reasons} La trovi in Aspetta te con conseguenze e alternative.",
  "main.merge.destructive.breaking": "Modifica incompatibile.",
  "main.merge.destructive.breakingConsequence": "Chi usa questa parte deve adattarsi: {breaking}",
  "main.merge.destructive.deletes": "Cancella {count} file.",
  "main.merge.destructive.deletes.one": "Cancella un file.",
  "main.merge.destructive.deletedConsequence": "Dopo l'unione sul branch principale non ci sono più: {files}.",
  "main.merge.destructive.andOthers": " e altri {count}",
  "main.merge.destructive.sql": "Contiene istruzioni che cancellano dati.",
  "main.merge.destructive.sqlConsequence": "Quando le istruzioni girano, i dati tolti non tornano indietro senza un backup.",
  "main.merge.destructive.mergeAnyway": "Unisci comunque, se le conseguenze ti vanno bene: Trama unisce con il tuo ok.",
  "main.merge.destructive.askSafer": "Chiedi al Coordinatore una versione che non toglie niente, per esempio prima deprecare e poi rimuovere.",
  "main.merge.destructive.leave": "Non unire e lascia le cose come sono.",
  "main.merge.destructive.stopped": "Il Coordinatore non unisce questo candidato da solo: {reasons}",
  "main.merge.destructive.noStop": "Il candidato non ha un'unione fermata.",
  "main.merge.drift.newWork": "Sul branch della pull request #{number} è arrivato altro lavoro dopo la pubblicazione: serve un nuovo candidato con nuove verifiche.",
  "main.merge.drift.conflicts": "GitHub trova conflitti tra la pull request #{number} e la base.",
  "main.merge.banned": "Unione fermata da un divieto fisso",
  "main.merge.bannedDetail":
    "{reason} Nessun mandato lo concede: il candidato {id} aspetta te.",
  "main.push.noMandate":
    "Il progetto non ha un mandato: Trama non pubblica branch su GitHub.",
  "main.push.mandateRevoked":
    "Il mandato è revocato: Trama non pubblica branch su GitHub.",
  "main.push.mandateNoPullRequests":
    "Il mandato non permette di aprire pull request: Trama non pubblica branch su GitHub.",
  "main.push.bannedReason":
    "{reason} Nessun mandato lo concede: Trama non pubblica {branch}.",
  "main.push.exitCode": "uscita {code}",
  "main.push.failedError": "git push non riuscito: {detail}",
  "main.push.where": "{branch} su {remote}",
  "main.push.banned": "Pubblicazione fermata da un divieto fisso",
  "main.push.refused": "Pubblicazione fermata dal mandato",
  "main.push.started": "Trama sta pubblicando un branch su GitHub",
  "main.push.pushed": "Trama ha pubblicato un branch su GitHub",
  "main.push.failed": "Pubblicazione del branch non riuscita",
  "main.push.agentPushed": "Un agente ha eseguito git push fuori da Trama",
  "main.push.agentTried": "Un agente ha provato a pubblicare con git push",
  "main.push.agentPushedDetail":
    "Richiesta: {command}\nControlla il remoto: solo Trama pubblica, e solo con un mandato che lo permette.",
  "main.push.agentTriedDetail":
    "Richiesta: {command}\nIl sandbox l'ha fermato: solo Trama pubblica, e solo con un mandato che lo permette.",
  // Publication (publication.ts)
  "main.publication.noWorktree": "L'incarico non ha un worktree da pubblicare.",
  "main.publication.worktreeChanged":
    "Il worktree è cambiato dopo la dichiarazione del candidato: serve un nuovo candidato con nuove verifiche.",
  "main.publication.missingMarker":
    "Il messaggio di commit non porta il marcatore del candidato ({marker}).",
  "main.publication.extraFiles":
    "L'indice contiene file fuori dal candidato: {files}.",
  "main.publication.pullRequestClosed":
    "La pull request #{number} di questo branch è già chiusa: il nuovo candidato richiede un nuovo incarico.",
  "main.publication.createFailed":
    "GitHub non ha creato la pull request: {detail}",
  "main.publication.listFailed":
    "GitHub non ha elencato le pull request: {detail}",
  // GitHub (github.ts)
  "main.github.issueMissing": "GitHub non ha restituito la issue creata.",
  "main.github.mergeFailed":
    "GitHub non ha unito la pull request #{number}: {detail}",
  "main.github.unknownError": "errore sconosciuto",
  "main.github.ghMissing":
    "GitHub CLI (gh) non è installato. Installalo ed esegui gh auth login.",
  "main.github.signedOut":
    "GitHub CLI non ha un accesso valido. Esegui gh auth login nel terminale.",
  "main.github.sso":
    "L'organizzazione richiede SSO: autorizza il token di gh per l'organizzazione (gh auth refresh).",
  "main.github.rateLimited":
    "GitHub ha applicato un limite di richieste. Trama riprova più tardi.",
  "main.github.notFound":
    "Il repository non esiste o il tuo account non vi ha accesso (repository privato).",
  // Conflicts (conflicts.ts, worktreeConflicts.ts)
  "main.conflicts.invalidRevision": "Revisione non valida: {sha}",
  "main.conflicts.remoteUnavailable":
    "Revisione remota non disponibile: {detail}",
  "main.conflicts.unsafePath": "Percorso non sicuro nel candidato: {path}",
  "main.conflicts.tooLarge":
    "Il candidato supera il limite della prova di fusione.",
  "main.conflicts.changedDuringProbe":
    "Il candidato è cambiato durante la prova.",
  "main.conflicts.diffUnreadable": "Il diff del candidato non è leggibile.",
  "main.conflicts.doesNotApply": "Il candidato non si applica alla sua base.",
  "main.conflicts.noMergeBase":
    "Le due revisioni non hanno una base comune verificabile.",
  "main.conflicts.clean":
    "La fusione temporanea è stata riprodotta senza conflitti testuali.",
  "main.conflicts.mergeTreeFailed":
    "git merge-tree non ha completato la prova: {detail}",
  "main.conflicts.conflict":
    "La fusione temporanea produce conflitti testuali.",
  "main.conflicts.overlap":
    "Nessun conflitto testuale, ma entrambe le revisioni cambiano {files}.",
  "main.conflicts.worktreeOverlap":
    "Nessun conflitto testuale tra le due copie di lavoro, ma entrambe cambiano {files}.",
  "main.conflicts.worktreeConflict":
    "La fusione temporanea delle due copie di lavoro produce conflitti testuali: si risolvono prima dell'unione.",
  // Worktrees (workspace.ts)
  "main.workspace.invalidName": "Il nome del worktree non è valido.",
  "main.workspace.headNotCommit": "HEAD non è un commit.",
  "main.workspace.invalidBranch": "Nome di branch non valido: {problems}",
  "main.workspace.unsafePath": "Percorso non sicuro: {path}",
  "main.workspace.notManaged": "Il worktree non è gestito da Trama.",
  "main.workspace.sessionMismatch":
    "Il worktree non corrisponde più alla sessione.",
  "main.workspace.branchChanged": "Il branch del worktree è cambiato.",
  "main.workspace.symlink": "Collegamento simbolico nel candidato: {path}",
  "main.workspace.diffFailed": "git diff non riuscito",
  "main.workspace.diffCheckFailed": "git diff --check non riuscito",
  "main.workspace.uncommitted":
    "Il worktree ha modifiche non salvate in un commit: rimuoverlo le perderebbe.",
  "main.workspace.unpublished":
    "Il worktree ha commit non pubblicati: pubblica il candidato o tienilo.",
  // Presence (presence.ts)
  "main.presence.cacheFailed": "Cache della presenza non creata: {detail}",
  "main.presence.recordTooLarge": "Il record della presenza supera il limite.",
  "main.presence.remoteSilent": "Il remoto non risponde.",
  "main.presence.notUpdated": "La presenza non è aggiornata: {detail}",
  "main.presence.remoteDidNotAnswer": "Il remoto non ha risposto: {detail}",
  "main.presence.noRemote":
    "Il progetto non ha un remoto: la presenza resta su questo computer.",
  "main.presence.noAccount":
    "Trama non conosce ancora il tuo account: la presenza parte appena lo legge.",
  "main.presence.readOnly":
    "Hai solo la lettura su questo remoto: vedi la presenza dei colleghi senza condividere la tua.",
  "main.presence.rejected":
    "Il remoto non accetta la tua presenza ({detail}): vedi quella dei colleghi senza condividere la tua.",
  "main.presence.you": "Tu",
  "main.presence.notPublished": "La presenza non è stata pubblicata: {detail}",
  // Problems outside the work in progress (problems.ts)
  "main.problems.unknownCommit": "sconosciuto",
  "main.problems.checkTitle":
    "La verifica {check} non passa sul branch del progetto",
  "main.problems.checkoutDetail":
    "La verifica {check} (`{command}`) non passa sul checkout del progetto al commit {commit}.",
  "main.problems.checkoutDetailRegression":
    "La verifica {check} (`{command}`) non passa sul checkout del progetto al commit {commit}, e prima passava.",
  "main.problems.checkOutput": "Uscita della verifica:\n\n```\n{output}\n```",
  "main.problems.checkoutEvidence":
    "Verifica {check} rossa sul checkout al commit {commit} ({id})",
  "main.problems.gateDetail":
    "La verifica `{check}` non passa sul candidato {candidate} e nemmeno sulla sua base, il commit {commit}: il candidato non l'ha causata.",
  "main.problems.baseOutput": "Uscita sulla base:\n\n```\n{output}\n```",
  "main.problems.gateEvidence":
    "Verifica {check} rossa anche sulla base {commit} del candidato {candidate} ({id})",
  "main.problems.findingDetail":
    "{name} ha trovato questo problema in `{file}`, un file che il candidato {candidate} non cambia.",
  "main.problems.findingEvidence":
    "Rilievo di {name} sul candidato {candidate} ({id})",
  "main.problems.issueEvidence": "**Prova:** {evidence}.",
  "main.problems.issueOpenedAlone":
    "Il Coordinatore di Trama ha aperto questa issue da solo, perché il problema è fuori dal lavoro in corso. Il bug triage la smista con `triage`.",
  "main.problems.triageOutcome": "Triage: {state} ({label}).",
  "main.problems.triageUnreadable":
    "Il triage {id} non ha dato un esito leggibile.",
  "main.problems.issueAlreadyOpen":
    "La issue era già aperta: il triage segue le regole delle issue nuove.",
  "main.problems.placedOnAssignment":
    "{note} L'incarico {id} lavora già su questo problema.",
  "main.problems.placedInBacklog":
    "{note} Nessun incarico lavora su questo problema: resta nel backlog.",
  "main.problems.localBacklog":
    "GitHub non è collegato: il problema resta nel backlog di Trama, senza issue.",
  // Document, storage and onboarding (document.ts, storage.ts, onboarding.ts)
  "main.document.quitNote":
    "Trama è stato chiuso mentre il Coordinatore lavorava.",
  "main.document.crashNote":
    "Trama si è chiuso senza fermare il turno mentre il Coordinatore lavorava.",
  "main.document.assignmentQuitNote":
    "Esci: Trama si sta chiudendo. L'incarico riprende alla riapertura se il mandato lo consente.",
  "main.document.assignmentCrashNote":
    "Trama si è interrotto senza un arresto controllato (crash o chiusura forzata) mentre lo specialista lavorava.",
  "main.document.specInterrupted":
    "La scrittura della spec si è interrotta prima della fine: rispondi di nuovo sui punti di prova.",
  "main.document.planInterrupted":
    "La preparazione si è interrotta prima della fine: chiedi di nuovo il piano.",
  "main.document.slicingInterrupted":
    "La divisione in fette si è interrotta prima della fine: chiedila di nuovo.",
  "main.storage.symlink":
    "Il file di stato è un collegamento simbolico: {path}",
  "main.storage.unreadable":
    "Lo stato del progetto non è leggibile e resta invariato in {path}. {detail}",
  "main.storage.tooManyImages":
    "Puoi allegare al massimo {max} immagini per messaggio.",
  "main.storage.unsupportedImage": "Formato immagine non supportato: {name}.",
  "main.storage.imageTooLarge": "L'immagine {name} supera 10 MB o è vuota.",
  "main.onboarding.ghTimeout":
    "gh auth status non ha risposto entro 15 secondi.",
  "main.onboarding.cloneTimeout":
    "La clonazione di {repository} non è finita entro 10 minuti.",
  "main.onboarding.cloneNeedsAccess":
    "{repository} non si clona senza accesso. Se è privato, collega GitHub CLI con gh auth login e riprova.",
  "main.onboarding.cloneFailed":
    "La clonazione di {repository} non è riuscita.",
  "main.onboarding.cloneFailedReason":
    "La clonazione di {repository} non è riuscita: {reason}",
  "main.onboarding.unsafePath": "Percorso non sicuro nell'esercizio: {path}",
  "main.onboarding.nothingToCompare":
    "Il candidato non cambia file: non c'è niente da confrontare.",
  "main.onboarding.compatibleLabel": "modifica compatibile simulata",
  "main.onboarding.incompatibleLabel": "modifica incompatibile simulata",
  // Skill setup (skillSetup.ts)
  "main.skills.unsafePath": "Il setup non può usare il percorso: {path}",
  "main.skills.missingResource":
    "Manca una risorsa AI Hero richiesta: skills/{skill}/SKILL.md",
  "main.skills.tooLarge":
    "Le risorse AI Hero superano il limite locale di 3 MB: {bytes} byte.",
  "main.skills.conflictPreserved": "Conflitto preservato: {path}.",
  "main.skills.changedNotUpdated": "Modificato da te, non aggiornato: {path}.",
  "main.skills.changedKeptOldName":
    "Modificato da te, conservato con il vecchio nome: {path}.",
  "main.skills.nothingToRollBack":
    "Non c'è un aggiornamento del metodo da annullare.",
  // Interface screenshots (interfaceShots.ts)
  "main.shots.defaultName": "schermata",
  "main.shots.timeout":
    "Lo script {script} non ha finito entro {seconds} secondi.",
  "main.shots.failed": "Lo script {script} non è riuscito: {detail}",
  "main.shots.noPng":
    "Lo script {script} non ha salvato nessun PNG in TRAMA_SCREENSHOTS_DIR.",
  "main.shots.noScript":
    'Il progetto non dichiara lo script "{script}" nel package.json: Trama non può fare le schermate prima e dopo. Guarda il diff o prova il branch del candidato.',
  "main.shots.baseWithoutScript":
    'La base non ha ancora lo script "{script}": ci sono solo le schermate dopo.',
  "main.shots.sideFailed": "{side}, tema {theme}: {failure}",
  "main.shots.before": "Prima",
  "main.shots.after": "Dopo",
  "main.shots.light": "chiaro",
  "main.shots.dark": "scuro",
  "main.shots.notPrepared": "Trama non ha preparato le schermate: {detail}",
  // Repository scan (repositoryScanner.ts)
  "main.scanner.invalidRoot":
    "La cartella del repository non è leggibile: {path}",
  "main.scanner.invalidRelativePath":
    "Il percorso deve essere relativo: {path}",
  "main.scanner.unsafePath":
    "Il percorso non è disponibile per la lettura: {path}",
  "main.scanner.fileTooLarge": "Il file supera il limite di lettura: {path}",
  "main.scanner.unreadableAttributes":
    "Impossibile leggere gli attributi di {path}.",
  "main.scanner.stopped": "La scansione si è fermata a {count} file sorgente.",
  "main.scanner.fileTooLargeSkipped":
    "File ignorato perché supera {size} KB: {path}.",
  "main.scanner.unreadableFile":
    "File non leggibile o non UTF-8 ignorato: {path}.",
  "main.scanner.moduleSummary":
    "{files} file rilevati in {path}. Per Swift sono riportati solo gli import diretti; per gli altri linguaggi restano disponibili i file e gli import relativi risolvibili.",
  "main.scanner.contextSkipped": "File di contesto ignorato: {name}. {detail}",
  // Projects overview (overview.ts)
  "main.overview.decisions": "{count} decisioni richieste",
  "main.overview.decisions.one": "{count} decisione richiesta",
  "main.overview.mandates": "{count} richieste di mandato",
  "main.overview.mandates.one": "{count} richiesta di mandato",
  "main.overview.teams": "{count} proposte di team",
  "main.overview.teams.one": "{count} proposta di team",
  "main.overview.blocked": "{count} lavori fermi o falliti",
  "main.overview.blocked.one": "{count} lavoro fermo o fallito",
  "main.overview.toApprove": "{count} risultati da approvare",
  "main.overview.toApprove.one": "{count} risultato da approvare",
  "main.overview.running": "{count} incarichi in corso",
  "main.overview.running.one": "{count} incarico in corso",
  "main.overview.waitingForCapacity":
    "{count} incarichi aspettano uno sviluppatore libero",
  "main.overview.waitingForCapacity.one":
    "{count} incarico aspetta uno sviluppatore libero",
  "main.overview.ciFailing": "CI rossa su {count} pull request",
  "main.overview.ciFailing.one": "CI rossa su {count} pull request",
  "main.overview.demoName": "Progetto di esempio",
  // GitHub monitor (monitor.ts)
  "main.monitor.ghFailed": "gh api {endpoint} non riuscito",
  "main.monitor.branchesLimited":
    "Elenco branch limitato ai primi {count} risultati.",
  "main.monitor.pullsLimited":
    "Elenco pull request limitato ai primi {count} risultati.",
  "main.monitor.renamed":
    "Il repository è stato rinominato in {name}: aggiorna il remoto origin.",
  "main.monitor.branchCreated": "Nuovo branch {branch}",
  "main.monitor.branchForcePushed": "Riscrittura forzata di {branch}",
  "main.monitor.branchUpdated": "Nuovi commit su {branch}",
  "main.monitor.branchDeleted": "Branch {branch} eliminato",
  "main.monitor.pullOpened": "Aperta #{number} {title}",
  "main.monitor.pullOpenedFromFork": "Aperta #{number} {title} (da un fork)",
  "main.monitor.pullUpdated": "Aggiornata #{number} {title}",
  "main.monitor.pullUpdatedFromFork":
    "Aggiornata #{number} {title} (da un fork)",
  "main.monitor.reviewApproved": "approvata",
  "main.monitor.reviewChanges": "modifiche richieste",
  "main.monitor.reviewCommented": "commentata",
  "main.monitor.review": "Revisione di #{number}: {label}",
  "main.monitor.ciGreen": "CI di #{number}: verde",
  "main.monitor.ciFailed": "CI di #{number}: fallita",
  "main.monitor.pullClosed": "Chiusa #{number} {title}",
  // Example project and SwiftUI import (demoProject.ts, legacyImport.ts)
  "main.demo.folderTaken":
    "La cartella dell'esempio esiste già e non è gestita da Trama. Spostala o rinominala per ricreare il progetto di esempio.",
  "main.legacy.importedTitle": "{title} (importata dalla versione SwiftUI)",
  // Memory errors (learning/memoryErrors.ts)
  "main.memory.userFull":
    "Il profilo è pieno ({chars} su {limit} caratteri): togli o accorcia una nota prima di aggiungerne un'altra.",
  "main.memory.projectFull":
    "La memoria del progetto è piena ({chars} su {limit} caratteri): togli o accorcia una nota prima di aggiungerne un'altra.",
  "main.memory.noMatch": "Questa nota non c'è più: la memoria è cambiata.",
  "main.memory.ambiguous":
    "Il testo indicato corrisponde a più note: correggine una alla volta.",
  "main.memory.drift":
    "Il file della memoria è cambiato fuori da Trama: Trama non lo sovrascrive e ne ha salvato una copia accanto.",
  "main.memory.unreadable":
    "Trama non riesce a leggere il file della memoria in questo momento. Riprova tra poco.",
  "main.memory.threat":
    "La nota contiene istruzioni che Trama non salva in memoria.",
  "main.memory.disabled": "Questa memoria è disattivata nelle impostazioni.",
  "main.memory.staleProposal":
    "La memoria è cambiata dopo la proposta: le voci che toccava non sono più le stesse. Scartala.",
  "main.memory.unknownProposal": "Questa proposta non c'è più.",
  "main.memory.notUpdated": "La memoria non è stata aggiornata.",
  "main.memory.activity.full": "Memoria non aggiornata: è piena.",
  "main.memory.activity.noMatch":
    "Memoria non aggiornata: la nota da cambiare non c'è più.",
  "main.memory.activity.ambiguous":
    "Memoria non aggiornata: il testo indicato corrisponde a più note.",
  "main.memory.activity.drift":
    "Memoria non aggiornata: il file è cambiato fuori da Trama.",
  "main.memory.activity.unreadable":
    "Memoria non aggiornata: il file non si legge in questo momento.",
  "main.memory.activity.threat":
    "Memoria non aggiornata: la nota conteneva istruzioni che Trama non salva.",
  "main.memory.activity.tooManyFailures":
    "Memoria non aggiornata: troppi tentativi in questo turno.",
  "main.memory.activity.disabled":
    "Memoria non aggiornata: è disattivata nelle impostazioni.",
  "main.memory.activity.notUpdated": "Memoria non aggiornata.",
  // Learning: proposals and reviews (learning/projectLearning.ts, learning/review.ts)
  "main.memory.change.remove": "Togliere la nota «{old}»",
  "main.memory.change.replace": "Sostituire la nota «{old}» con «{content}»",
  "main.memory.change.add": "Aggiungere la nota «{content}»",
  "main.memory.change.other": "Cambiare la nota: «{content}»",
  "main.memory.reorder": "Riordinare {count} note",
  "main.memory.reorderOneChanges":
    "Riordinare {count} note: una cambia o sparisce",
  "main.memory.reorderChanges":
    "Riordinare {count} note: {removed} cambiano o spariscono",
  "main.memory.userOverLimit":
    "Il profilo supera il limite ({chars} su {limit} caratteri). Trama propone di togliere le note più vecchie; puoi anche accorciarle a mano.",
  "main.memory.projectOverLimit":
    "La memoria del progetto supera il limite ({chars} su {limit} caratteri). Trama propone di togliere le note più vecchie; puoi anche accorciarle a mano.",
  "main.review.verb.created": "creata",
  "main.review.verb.updated": "aggiornata",
  "main.review.verb.rewritten": "riscritta",
  "main.review.verb.deleted": "eliminata",
  "main.review.verb.archived": "archiviata",
  "main.review.skillLine": "Skill '{name}' {verb}",
  "main.review.skillLineWithPath": "Skill '{name}' {verb} ({path})",
  "main.review.stopped": "La revisione è stata fermata.",
  "main.review.timedOut": "La revisione ha finito il tempo a disposizione.",
  "main.review.foreignTool":
    "La revisione ha usato uno strumento fuori da memoria e skill: Trama l'ha fermata.",
  "main.review.staged":
    "Proposta di modifica della memoria: la trovi in Memoria",
  "main.review.profileUpdated": "Profilo aggiornato",
  "main.review.memoryUpdated": "Memoria aggiornata",
  // MARK: Cloud sessions (A19)
  "main.controller.cloudNotStarted": "La sessione cloud non è partita: {error}",
  "main.controller.cloudNotStartedTitle": "Sessione cloud non avviata",
  "main.controller.cloudStartingTitle": "Avvio della sessione cloud",
  "main.controller.cloudStartedTitle": "Sessione cloud avviata",
  "main.controller.cloudNoLink":
    "Claude Code non ha dato il link della sessione.",
  "main.controller.cloudStoppedWhileStarting":
    "Fermato dalla persona mentre la sessione cloud partiva.",
  "main.controller.cloudPullClosed":
    "La pull request #{number} è stata chiusa prima delle verifiche di Trama.",
  "main.controller.cloudPullClosedTurn":
    "La pull request #{number} della sessione cloud è stata chiusa prima delle verifiche di Trama.",
  "main.controller.cloudFailedTitle": "Sessione cloud non riuscita",
  "main.controller.cloudOpenedDraft":
    "La sessione cloud ha aperto la pull request in bozza #{number}.",
  "main.controller.cloudReturnedTitle": "Sessione cloud tornata sul Mac",
  "main.controller.cloudReturnedDetail":
    "Pull request in bozza #{number}, branch {branch}: {url}",
  "main.controller.macChecksFailedTitle": "Controlli sul Mac non superati",
  "main.controller.macChecksPassedTitle": "Controlli sul Mac superati",
  "main.controller.macChecksFailedDetail":
    "{problems} Il candidato resta fermo finché il lavoro non li supera.",
  "main.controller.macChecksPassedDetail":
    "Niente segreti né file sensibili, git diff --check pulito, messaggi di commit validi.",
  "main.controller.cloudNotReturned":
    "Il lavoro della sessione cloud non è tornato sul Mac: {error}",
  "main.controller.cloudNotReturnedTitle": "Sessione cloud non tornata sul Mac",
  "main.controller.notCloudAssignment":
    "L'incarico non lavora in una sessione cloud.",
  "main.controller.cloudNoGitHubRemote":
    "Il progetto non ha un remoto GitHub: Trama non può leggere la sessione.",
  "main.controller.assignmentNotFound": "Incarico non trovato.",
  "main.controller.cannotMovePlace":
    "Puoi spostare l'incarico prima dell'avvio o quando aspetta una ripresa.",
  "main.controller.movedToCloudTitle": "Spostato in cloud",
  "main.controller.movedToLocalTitle": "Spostato in locale",
  "main.controller.movedToCloudDetail":
    "Alla prossima ripresa lavora in una sessione cloud, se il cloud si può usare.",
  "main.controller.movedToLocalDetail": "Alla prossima ripresa lavora sul Mac.",
  "main.controller.invalidWorkPlace":
    "Il luogo di lavoro deve essere Automatico, Sempre in locale o Cloud quando possibile.",
  "main.controller.cloudNoWorkingCopy":
    "Il lavoro della sessione cloud non ha una copia di lavoro sul Mac.",
  "main.controller.cloudWorkingCopyChanged":
    "La copia di lavoro è cambiata dopo il candidato: serve un nuovo candidato con nuove verifiche.",
  "main.controller.macChecksFailedDraft":
    "{problems} La pull request #{number} resta in bozza.",
  "main.controller.macChecksRepeatedFailed":
    "Trama ha ripetuto sul Mac i controlli di pubblicazione e non sono superati: {problems}",
  "main.controller.pullReadyTitle":
    "Pull request #{number} pronta per la revisione",
  "main.controller.pullReadyDetail":
    "Controlli sul Mac superati, bozza tolta: {url}",
  "main.cloud.startTimeout":
    "Claude Code non ha aperto la sessione cloud entro cinque minuti.",
  "main.cloud.exited": "claude --cloud è uscito con {code}.",
  "main.cloud.invalidBranch": "Nome di branch non valido: {problems}",
  "main.cloud.pullsNotListed":
    "GitHub non ha elencato le pull request: {error}",
  "main.cloud.pullNotUpdated":
    "GitHub non ha aggiornato la pull request: {error}",
  "main.cloud.draftNotRemoved": "GitHub non ha tolto la bozza: {error}",
  "main.cloud.secrets": "Segreti o file sensibili: {items}.",
  "main.cloud.sensitiveFiles": "File sensibili nel branch: {files}.",
  "main.cloud.diffCheck": "git diff --check non è pulito: {errors}.",
  "main.cloud.noCommits": "Il branch non ha commit oltre la base.",
  "main.cloud.invalidCommit":
    'Messaggio di commit non valido "{subject}": {problems}',
  "main.team.cloudWorking":
    "Al lavoro in una sessione cloud sul branch {branch}",
  "main.workspace.notTramaBranch":
    "Il branch {branch} non è un branch di Trama.",
  "main.workspace.fetchFailed":
    "git fetch del branch {branch} non riuscito: {error}",
  "main.workspace.noCommonBase":
    "Il branch {branch} non ha una base in comune con il progetto.",
  // MARK: Findings to work and semantic conflicts
  "main.findingWork.followUp.ticket": "una issue o una voce del backlog",
  "main.findingWork.followUp.assignment": "un incarico",
  "main.findingWork.followUp.pactCard": "una scheda del Patto",
  "main.findingWork.notDone":
    "L'esame non è concluso: aspetta il rapporto prima di agire sui rilievi.",
  "main.findingWork.notFound": "Rilievo non trovato in questo esame.",
  "main.findingWork.alreadyCreated": "Da questo rilievo hai già creato {what}.",
  "main.findingWork.noProof": "nessuna prova",
  "main.findingWork.quotedLine": "{label}, riga citata: {quote}",
  "main.findingWork.command": "il comando {command}",
  "main.findingWork.reproduction": "riproduzione:\n{steps}",
  "main.findingWork.moduleNamed": "modulo {name}",
  "main.findingWork.project": "progetto",
  "main.findingWork.candidateOf": "candidato di {author}",
  "main.findingWork.candidateReviewed": "candidato esaminato",
  "main.findingWork.markdown.title": "**Rilievo {source}:** {title}",
  "main.findingWork.markdown.titleSerious":
    "**Rilievo {source}, grave:** {title}",
  "main.findingWork.markdown.status": "**Stato:** {status}.",
  "main.findingWork.markdown.proof": "**Prova:** {proof}",
  "main.findingWork.markdown.observed": "Cosa ha letto Trama:",
  "main.findingWork.markdown.origin":
    "Viene dall'esame approfondito sul {candidate}, punto fisso {point}.",
  "main.findingWork.issueOpenedFrom":
    "La persona ha aperto questa issue da un rilievo dell'esame approfondito di Trama.",
  "main.findingWork.localTicket":
    "GitHub non è collegato: il rilievo resta nel backlog di Trama, senza issue.",
  "main.findingWork.evidenceLabel":
    "Rilievo dell'esame approfondito sul {candidate}, prova {proof}",
  "main.findingWork.hypothesis":
    "Il rilievo è un'ipotesi: la sua prova non ha retto. Aprine una issue o una scheda del Patto, non un incarico.",
  "main.findingWork.teamNotConfirmed":
    "La squadra non è ancora confermata: nessuno può ricevere l'incarico.",
  "main.findingWork.noModule":
    "Trama non sa a quale modulo appartiene il rilievo: chiedi la correzione al Coordinatore.",
  "main.findingWork.mandateMissing":
    "Non c'è un mandato: nessun incarico parte fuori dal mandato. Apri una issue, oppure concedi il mandato.",
  "main.findingWork.mandateRevoked":
    "Il mandato è revocato: nessun incarico parte fuori dal mandato. Apri una issue, oppure concedi un nuovo mandato.",
  "main.findingWork.outsideScope":
    "Il mandato non copre {modules}: nessun incarico parte fuori dal mandato. Apri una issue.",
  "main.findingWork.noWorktreeAction":
    "Il mandato non concede di lavorare nelle copie di lavoro: nessun incarico parte fuori dal mandato. Apri una issue.",
  "main.findingWork.busy":
    "Un altro incarico lavora ora su {modules}: riprova quando finisce.",
  "main.findingWork.occupied":
    "Qualcuno tocca ora questi moduli: {names}. Riprova più tardi.",
  "main.findingWork.noDeveloper":
    "Nessuno sviluppatore libero copre i moduli del rilievo: riprova quando uno finisce il suo lavoro.",
  "main.findingWork.noProvider": "Nessun provider collegato può lavorare ora.",
  "main.findingWork.objective": "Correggere il rilievo: {title}",
  "main.findingWork.modelReason":
    "Correzione di un rilievo dell'esame approfondito: lo stesso provider e modello del lavoro esaminato.",
  "main.findingWork.seam": "Il rilievo non si ripresenta: {proof}",
  "main.findingWork.notStarted": "L'incarico non è partito: {error}",
  "main.findingWork.pact.question":
    "Il rilievo «{title}» è un compromesso da accettare o va corretto?",
  "main.findingWork.pact.case":
    "Esame approfondito sul {candidate}, {source}.",
  "main.findingWork.pact.proof": "Prova: {proof}.",
  "main.findingWork.pact.acceptBehavior":
    "Accettare il compromesso: il codice resta com'è e il rilievo «{title}» non si corregge.",
  "main.findingWork.pact.acceptExample": "{proof} resta come nel candidato.",
  "main.findingWork.pact.acceptConsequence":
    "Il Patto registra il compromesso e nessun incarico parte.",
  "main.findingWork.pact.fixBehavior": "Correggere il rilievo «{title}».",
  "main.findingWork.pact.fixExample":
    "{proof} cambia finché il rilievo non si ripresenta.",
  "main.findingWork.pact.fixConsequence":
    "La correzione diventa un incarico nel mandato.",
  "main.findingWork.report.passed": "superata",
  "main.findingWork.report.failed": "non superata",
  "main.findingWork.report.serious": "**Grave.** ",
  "main.findingWork.report.item": "{serious}{title} ({status}; prova: {proof})",
  "main.findingWork.report.noSpec":
    "Nessuna spec disponibile: l'asse non è partito.",
  "main.findingWork.source.axisOf": "dell'asse {axis}",
  "main.findingWork.source.axis": "asse {axis}",
  "main.findingWork.source.lensOf": "della lente di Trama {lens}",
  "main.findingWork.source.lens": "lente di Trama {lens}",
  "main.findingWork.report.lensTitle": "### {lens} (lente di Trama)",
  "main.findingWork.report.lensFailed": "La lente non ha prodotto un rapporto.",
  "main.findingWork.report.noFindings": "Nessun rilievo.",
  "main.findingWork.report.title": "## Esame approfondito sul {candidate}",
  "main.findingWork.report.scope":
    "Punto fisso {point}, {files} file. Esame in sola lettura.",
  "main.findingWork.report.scope.one":
    "Punto fisso {point}, 1 file. Esame in sola lettura.",
  "main.findingWork.report.checks": "### Verifiche reali",
  "main.findingWork.report.noChecks": "Nessuna verifica eseguita.",
  "main.findingWork.report.summary": "**Sintesi:** {summary}",
  "main.findingWork.report.note":
    "Un rilievo è verificato solo quando Trama ha ricontrollato la sua prova; gli altri restano ipotesi.",
  "main.findingWork.publishNotDone":
    "L'esame non è concluso: si pubblica solo un rapporto finito.",
  "main.findingWork.alreadyPublished":
    "Hai già pubblicato questo rapporto su GitHub.",
  "main.semanticConflicts.pending":
    "Trama prova lo scenario sul candidato combinato: finché non dà un risultato, è solo un'ipotesi.",
  "main.semanticConflicts.passes":
    "Sul candidato combinato {check} passa: l'incompatibilità resta un'ipotesi.",
  "main.semanticConflicts.notRun":
    "Lo scenario non è partito ({reason}): l'incompatibilità resta un'ipotesi.",
  "main.semanticConflicts.unknownReason": "motivo sconosciuto",
  "main.semanticConflicts.incompatible":
    "Ognuno passa {check} da solo, ma sul candidato combinato fallisce: le due modifiche sono incompatibili.",
  "main.semanticConflicts.notProven":
    "Sul candidato combinato {check} fallisce, ma non è passato su entrambi da soli: il fallimento non prova l'incompatibilità.",
  "main.conflicts.textConflicts":
    "La fusione temporanea delle due copie di lavoro produce conflitti testuali.",
  "main.conflicts.combineFailed":
    "git merge-tree non ha completato la fusione: {error}",
  "main.controller.semanticOtherAssignment": "un altro incarico",
  "main.controller.semanticNotificationTitle":
    "Trama: due lavori non funzionano insieme",
  "main.controller.semanticNotificationBody":
    "Il lavoro di {first} e quello di {second} passano da soli, ma insieme una verifica fallisce.",
  "main.controller.semanticWorkingCopyGone":
    "Una delle due copie di lavoro non c'è più.",
  "main.controller.auditNotFound": "Esame non trovato.",
  "main.controller.findingIssueFailed": "La issue non è stata aperta: {error}",
  "main.controller.findingIssueOpenedTitle":
    "Issue #{number} aperta da un rilievo dell'esame approfondito",
  "main.controller.findingBacklogTitle":
    "Un rilievo dell'esame approfondito va nel backlog di Trama",
  "main.controller.findingAssignedTitle":
    "{name} riceve la correzione di un rilievo dell'esame approfondito",
  "main.controller.findingAssignedOrigin": "Viene dal {candidate}.",
  "main.controller.auditNoRepository":
    "Nessun repository GitHub collegato: il rapporto resta in Trama.",
  "main.controller.auditReportIssueTitle":
    "Rapporto dell'esame approfondito sul {candidate}",
  "main.controller.auditReportNotPublished":
    "Il rapporto non è stato pubblicato: {error}",
  // MARK: Redaction before publishing (issue #391)
  "main.redaction.token": "token rimosso",
  "main.redaction.iban": "IBAN rimosso",
  "main.redaction.pec": "PEC rimossa",
  "main.redaction.email": "email rimossa",
  "main.redaction.fiscalCode": "codice fiscale rimosso",
  "main.redaction.vatNumber": "partita IVA rimossa",
  "main.redaction.sdiCode": "codice SDI rimosso",
  "main.redaction.shopDomain": "dominio del negozio rimosso",
  "main.redaction.address": "indirizzo rimosso",
  "main.redaction.placeholderAt": "{what}, vedi {where}",
  // MARK: Squads by product area (A10)
  "main.squads.developerName": "Sviluppo {area}",
  "main.squads.developerCompetence": "Sviluppa l'area {area}.",
  "main.squads.developerReason": "Il Coordinatore l'ha aggiunto dentro il mandato: la squadra {area} non aveva uno sviluppatore.",
  "main.squads.leadName": "Capo {area}",
  "main.squads.leadReason": "Ogni squadra ha un capo squadra: questo è della squadra {area}.",
  "main.squads.qaReason": "Ogni squadra ha un QA dedicato: questo è della squadra {area}.",
  "main.squads.summarySquad": "Squadra {squad} con {lead} (capo squadra), {developers} ({role}) e {qa} (QA dedicato).",
  "main.squads.developers": "sviluppatori",
  "main.squads.developers.one": "sviluppatore",
  "main.squads.joins": "{developer} entra nella squadra {squad}.",
  "main.squads.hired": "Aggiunti dentro il mandato: {names}.",
  "main.slicePicking.squadsFull": "Le squadre al lavoro sono al loro limite: la fetta parte quando una si libera.",
} satisfies Record<string, string>;
