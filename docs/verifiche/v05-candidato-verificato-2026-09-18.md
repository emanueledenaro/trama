# V05 — Candidato verificato in chat

Data: 18 settembre 2026. Ticket: [#68](https://github.com/emanueledenaro/trama/issues/68).
Ramo: `synara/project-team-worktree`, sopra il lavoro V04 (#67) non ancora in `main`.

## Esito

Implementato e coperto dai test automatici e da esecuzioni reali della sandbox. La prova
diretta nell'app del percorso completo non è stata eseguita: il Coordinatore che dichiara il
candidato e il revisore tecnico richiedono un turno Codex, e l'account ChatGPT ha esaurito il
limite di utilizzo fino al 19 settembre 2026 alle 14:59. Nessuna fixture è stata spacciata per
prova reale.

## Cosa è implementato

**1. Strumento che dichiara il candidato, soggetto al mandato.**
`declare_candidate` è un'azione (`act`) sull'azione `executeInWorktree` del mandato, con il
perimetro dell'incarico e il tipo di lavoro dell'incarico. Trama cattura il contenuto del
worktree (`WorkspaceSessionManager.review`) e crea un contratto (`PactLease`) con moduli
dell'incarico e verifiche richieste e un candidato del Patto legato a base, decisioni
pertinenti e suite. Le evidenze si registrano su quel candidato: `PactEngine.recordEvidence`
le indicizza per `(candidateID, checkID)` e `contentFingerprint` le include.

**2. Controlli in CheckSandbox sul candidato.**
`CandidateCheckRunner` avvolge il comando con lo `CheckSandbox` esistente, con radice di
scrittura il worktree del candidato e rete disattivata. `verify_candidate` è un controllo
(`check`), quindi non richiede mandato: gira il check richiesto, registra l'evidenza e
restituisce uscita e output originale. Un fallimento resta `CHECK_FAILED` e blocca il via
libera. Se il worktree si è mosso dopo la dichiarazione, `verify_candidate` rifiuta con
`candidate_changed`: la correzione è una nuova dichiarazione, con nuove evidenze.

**3. Revisione tecnica da un thread distinto.**
`TechnicalReview` non ha né un attore umano né un merge: la revisione non può essere letta
come revisione umana. `recordTechnicalReview` rifiuta il revisore uguale all'autore.
`review_candidate` avvia un thread Codex separato e in sola lettura; il parere è deterministico
e conservativo (`CandidateReviewBriefing.verdict`: approva solo il marcatore esplicito,
altrimenti chiede modifiche). Dopo una revisione il Patto chiede ancora
`HUMAN_APPROVAL_REQUIRED`, e nessun lavoro risulta approvato o unito.

**4. Scheda di candidato in chat.**
`ConversationCard.Candidate` porta candidato, evidenze, revisione, stato e blocchi. La scheda
mostra diff, evidenze (con l'output originale dei check falliti), revisione tecnica e stato
(deciso, in costruzione, verificato); il pulsante apre il dettaglio, che riusa la vista diff
esistente (`ReviewOutput`).

**5. Invalidazione del via libera precedente.**
Il via libera del Coordinatore (`CoordinatorClearance`) è legato all'impronta del contenuto.
Nuove evidenze o una decisione pertinente cambiata spostano l'impronta: la scheda mostra che
il via libera precedente non vale più e lo stato torna coerente. `clear_candidate` è un'azione
sull'azione `integrateCandidate` del mandato e richiede verifiche superate e revisione
favorevole.

## Prove eseguite

- `swift test`: 330 test Swift Testing in 39 suite più 112 XCTest, tutti verdi (erano 295 in 34
  suite più 112 su V04; nessuna regressione).
- Sandbox reale (`Codex seatbelt`): il check del candidato gira nel worktree, il checkout
  principale e il suo indice restano intatti; il controllo di spazi fallisce con l'output
  originale e passa dopo la correzione; `swift test` reale su un pacchetto nel worktree passa
  e, con un test rotto, riporta il fallimento con il nome del test.
- `swift build -c release`: completa.
- Prove manuali: nessuna prova diretta nell'app del percorso completo.

## Cosa resta non verificato

- Il turno Codex del Coordinatore che chiama `declare_candidate`, `review_candidate` e
  `clear_candidate` e mostra la scheda nella chat: bloccato dal limite dell'account.
- Il thread revisore reale (`reviewCandidate`): implementato e testato ai confini, mai eseguito
  con Codex.
- La prova di completamento del ticket (incarico piccolo, controllo fallito, correzione,
  candidato verificato con diff ed evidenze dalla chat, revisione collegata): richiede un
  incarico vero, quindi un turno Codex.
- La revisione Standards e Spec da un revisore distinto non è stata eseguita: i sub-agenti
  disponibili usano lo stesso account Codex bloccato.

## Limiti e note

- Documenti: schema 7 con i candidati in `ProjectDocument.candidates` (campo opzionale), così
  i documenti scritti fino allo schema 6 si aprono senza perdita. Le build precedenti rifiutano
  lo schema 7 invece di riscriverlo.
- V04 non è in `main`: questo lavoro costruisce sopra i suoi commit e tocca poche cose sue, da
  riallineare quando V04 entra: `CoordinatorTools.clipped` e `confirmedTeam` passano da
  `private` a interni, `specialistSummary` prende il documento per mostrare i candidati,
  `CoordinatorTool` ha i quattro strumenti nuovi e `CoordinatorToolHost` i quattro metodi nuovi.
- `CandidateCheckRunner.checkCommand` ripete i comandi Git e Swift di `ReadOnlyCheckRunner`,
  perché il candidato gira nel worktree senza scratch esterno. Si può unificare più avanti.
- Il via libera del Coordinatore non integra nulla: l'integrazione è fuori perimetro (#C09).
- Nessuna pull request è stata aperta: mancando la prova diretta, il ticket non è verificabile.
  Il ramo resta pushuato.
