# C08: conflitti tra specialisti e collaboratori GitHub nella chat (2026-09-28)

Controllo di #40 sul branch `feature/issue-40-conflicts-in-chat`, costruito su main.

## Cosa c'era già su main

- Prova di fusione isolata (`app/src/main/core/conflicts.ts`): il candidato diventa un commit temporaneo in un clone separato e `git merge-tree` lo unisce con l'altra parte. Stesso file con fusione pulita resta "Stessi file", il conflitto si dichiara solo quando la fusione lo produce. Test in `conflicts.test.ts`.
- Confronto tra specialisti (`worktreeConflicts.ts`, W08) e con pull request e branch principale su GitHub (`Controller.assessRemoteConflicts`), con la divergenza del branch detta una volta sola (`branchDivergence.ts`, U02).
- Un confronto si fa una volta per coppia di snapshot (id `snapshot:sha` e `snapshot:worktree:snapshot`); uno snapshot nuovo rende obsoleta la scheda vecchia e rifà solo la coppia nuova. Un candidato sostituito non ha conflitti da risolvere.
- Il lavoro non pubblicato dei colleghi non si prova: `overlap.ts` usa solo i branch spinti sul remoto.
- Un conflitto riprodotto blocca il via libera (`inspectCandidate`, `REMOTE_CONFLICT` e `WORKTREE_CONFLICT`) e la scheda resta nella chat.

## Cosa aggiunge questo branch

- Ipotesi semantica (`app/src/main/core/semanticConflicts.ts`). Il Coordinatore segnala con `report_semantic_risk` che due candidati in file diversi possono non funzionare insieme. Trama la registra come ipotesi: un'interpretazione dell'AI che non blocca niente. Candidati negli stessi file vengono rifiutati, perché li confronta già la prova di fusione.
- Scenario sul candidato combinato (`combineWorktrees` in `conflicts.ts`, `Controller.assessSemanticScenarios`). Trama unisce i due candidati in una copia separata ed esegue lì una verifica richiesta da entrambi, nella sandbox. Solo se fallisce mentre ciascun candidato l'ha passata da solo l'ipotesi diventa evidenza ("Incompatibili") e blocca il via libera del candidato più recente (`SEMANTIC_CONFLICT`). Se passa, se non parte o se uno dei due non l'aveva passata da solo, resta un'ipotesi.
- Aggiornamenti: la stessa segnalazione sulla stessa coppia aggiorna la lettura senza un secondo avviso. Quando uno dei due candidati cambia, la lettura passa alla coppia nuova e si rifà solo lo scenario; la scheda vecchia risulta obsoleta.
- Provenienza nella scheda: progetto, incarichi con il nome di chi li ha fatti, base, copie confrontate e, per GitHub, la revisione letta. I tempi sono separati: lettura di GitHub (`remoteReadAt`), prova di fusione, analisi AI, scenario.
- Testi nuovi della scheda nel catalogo delle traduzioni (`app/src/shared/messages/it.ts` e `en.ts`).

## Verifiche

- Test: `app/src/main/core/semanticConflicts.test.ts` (ipotesi che non blocca, niente doppioni, rifiuti, fusione combinata su un repository Git vero senza toccare copie di lavoro e checkout, evidenza solo con fallimento sul combinato e successo da soli, rivalutazione della sola coppia nuova), `coordinatorTools.test.ts` (`report_semantic_risk`: una scheda, avvio dello scenario, rifiuti), `conflicts.test.ts` (tempo di lettura di GitHub separato da quello della prova).
- ui-check: sezione "Issue #40" con quattro schede (stessi file tra Bea e Ada, conflitto con la pull request #42, ipotesi, incompatibilità provata). Controlla progetto, incarichi, base, copie e tempi in ogni scheda, niente id grezzi né lineette, e che solo l'incompatibilità provata compaia fra i blocchi del candidato.
- Schermate in `docs/images/c08/`, in chiaro e in scuro. Prima (main 7e13d3f): `overlap-prima-*`, `conflict-prima-*`; lì il candidato di Ada sul totale degli ordini è "Candidato da guardare" in Aspetta te. Dopo: `overlap-dopo-*`, `conflict-dopo-*`, `hypothesis-dopo-*`, `semantic-dopo-*` e `blocked-dopo-*`, con lo stesso candidato fermo su "Incompatibile con un altro lavoro". Le schede di ipotesi e incompatibilità non esistevano prima.

## Limiti

- L'ipotesi viene dal Coordinatore; Trama non cerca da sola rischi semantici tra file diversi.
- Lo scenario usa una verifica già richiesta da entrambi i candidati. Un test scritto apposta per lo scenario non c'è ancora.
- Lo scenario confronta i candidati del team. Con il lavoro dei colleghi su GitHub resta la prova di fusione.
- Non verificato: un Coordinatore reale che usa `report_semantic_risk` e uno scenario eseguito da Codex vero. Il server di prova non è un modello; nessuna esecuzione reale di Codex.
