# A11: la persona rinomina, unisce e divide le squadre (2026-09-28)

Controllo di #251 sul branch `feature/issue-251-rename-merge-split-squads-ev0re3`. Dalla specifica #239 (Q14, Q15, Q21, Q22, Q23, Q32) e dall'ADR 0017. Costruito dentro la vista Squadre (B04) e il pannello Attività (B08) di main.

## Cosa esisteva già

- Squadre per area formate dal Coordinatore dopo lo studio (A10, #306), con limiti per squadra e per progetto.
- La vista Squadre nella barra laterale (B04) e Attività nel pannello in basso (B08).
- Il Coordinatore sapeva solo leggere le squadre: la persona non poteva cambiarle.
- Nessuna memoria per squadra nel codice: la memoria è del Coordinatore (MEMORY.md) e non ha una chiave di squadra.

## Cosa cambia

- Regole condivise (`app/src/shared/squadChanges.ts`): la vista e il processo principale leggono le stesse regole, così la vista dice il motivo prima che la persona confermi e il processo principale rifiuta con lo stesso motivo. I motivi stanno nei cataloghi, in italiano e in inglese (`teams.change.problem.*`).
- Modifiche (`app/src/main/core/squadChanges.ts`):
  - Rinomina: cambia solo il nome. Identificativo, aree, persone e fette restano.
  - Unione: la squadra che resta tiene identificativo, nome, capo squadra e QA; aree e sviluppatori si sommano, e le fette seguono perché appartengono alla squadra della loro area. Capo squadra e QA dell'altra escono dal team con il motivo. Oltre tre sviluppatori Trama propone chi resta (prima chi lavora, poi chi conosce più moduli dell'area unita, poi chi ha finito più lavoro) e la persona conferma o cambia la scelta; chi esce resta nel team, fuori dalle squadre, con il suo lavoro. Rifiutata se chi lavora non resta, se lavorerebbero più di tre sviluppatori o più del limite per squadra, o se capo squadra o QA dell'altra hanno un lavoro aperto.
  - Divisione: la persona sceglie le aree e gli sviluppatori della squadra nuova (Trama propone chi conosce solo le aree spostate). La squadra nuova riceve un capo squadra e un QA propri e prende le fette delle sue aree. Gli incarichi in corso restano allo sviluppatore che li ha. Rifiutata se una delle due squadre resta senza aree o senza sviluppatori, o se le squadre al lavoro supererebbero il limite del progetto.
  - Annullamento: ogni modifica è registrata (`squadChanges` nel documento) con le squadre com'erano, le persone uscite e quelle aggiunte. Da Attività la persona la annulla: le squadre tornano com'erano e al loro posto, capo squadra e QA usciti rientrano, quelli aggiunti da una divisione escono (e spariscono se non hanno mai lavorato). Si annulla prima la modifica più recente delle stesse squadre.
- Il Coordinatore non tocca le scelte della persona: una squadra modificata dalla persona porta `touchedAt`; la formazione dopo lo studio non la ricrea (le sue aree restano coperte), non la rinomina e non ci mette sviluppatori da sola. `read_team` la segna con `changedByPerson`.
- Chiedendolo al Coordinatore (Q32, chat unica): strumenti `rename_squad`, `merge_squads`, `split_squad`, senza mandato e solo su richiesta della persona. Un'unione oltre tre sviluppatori chiesta in chat diventa una proposta in cima alla vista Squadre ("Unione da confermare"), con chi resta secondo il Coordinatore; la persona unisce o lascia com'è. Il Coordinatore non chiede la scelta in testo libero.
- Vista Squadre (`TeamView.tsx`, nuovo `SquadChanges.tsx`): un menu "Azioni della squadra" su ogni squadra con Rinomina, Unisci a un'altra squadra, Dividi per aree. Un'azione che non si può fare resta visibile, spenta, con il motivo sotto. Il modulo si apre sotto l'intestazione della squadra, con Annulla e l'azione a destra, l'azione per ultima.
- Attività (`ActivityPanel.tsx`, `shared/activity.ts`): righe "Squadra rinominata", "Squadre unite", "Squadra divisa", con chi l'ha chiesta (dalla vista Squadre o al Coordinatore), il dettaglio e il pulsante Annulla; una modifica annullata diventa "Annullata". Nuovo tipo del filtro: "Modifiche alle squadre".
- `CONTEXT.md`, voce Squadra: cosa cambia con rinomina, unione, divisione e annullamento.

## Verifiche

- Test di unità: `app/src/main/core/squadChanges.test.ts` (14 test: rinomina con identificativo e fette, nomi rifiutati, unione con aree, fette, capo squadra e QA, proposta di chi resta e conferma oltre tre sviluppatori, rifiuti per limiti e lavoro aperto, divisione con fette e incarichi in corso, rifiuti della divisione, il Coordinatore non ricrea né riempie una squadra toccata, unione chiesta al Coordinatore con proposta e conferma, annullamento di unione e divisione, ordine degli annullamenti, righe di Attività), `app/src/main/core/coordinatorTools.test.ts` (strumenti del Coordinatore, `changedByPerson` in `read_team`), `app/src/renderer/lib/activityPanel.test.ts` (tipo del filtro).
- ui-check, passi nuovi `51a`-`51j` su un progetto con due squadre: menu e motivo di un'azione spenta, rinomina con identificativo invariato, unione con la proposta di chi resta, riga in Attività e annullamento, divisione con la squadra nuova, proposta dell'unione chiesta al Coordinatore. Finestra stretta 1280x800 e larga 1680x1050, Codex e Claude, chiaro e scuro.
- Schermate in `docs/images/a11/`: `prima-*` con la build di main `48397bf` sullo stesso progetto di esempio, `dopo-*` con questo branch.

Non verificato: la memoria della squadra, che nel codice non esiste ancora (arriverà con la retrospettiva dello sprint); la struttura la lascia seguire la squadra perché unione e rinomina tengono l'identificativo della squadra che resta. Nessuna esecuzione reale di Codex.
