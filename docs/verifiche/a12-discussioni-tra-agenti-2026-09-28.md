# A12: discussioni tra agenti con tempo massimo e decisione registrata (2026-09-28)

Controllo di #252 sul branch `feature/issue-252-timed-agent-discussions-e96min`. Dalla specifica #239 (Q16, Q17, Q23 e la chat unica Q32) e dall'ADR 0017.

## Cosa esisteva già

- Thread visibili tra agenti di W07 (#144): domanda al Coordinatore, revisione del candidato, regressione. Si leggevano dalla scheda dell'agente, in sola lettura.
- Squadre per area con capo squadra, sviluppatori e QA (A10, #306) e la vista Squadre nella barra laterale (B04, #386).
- "Aspetta te" come unico elenco di ciò che aspetta la persona, le schede del Patto e il giro periodico del Coordinatore (A05).
- Un modello leggero per il lavoro automatico dei ruoli fissi (`dutyModel` in `app/src/main/core/duties.ts`).

## Cosa cambia

- Discussione tra agenti (`app/src/main/core/discussions.ts`, `app/src/shared/discussions.ts`): un thread di W07 di tipo `discussion` con motivo, partecipanti, chi la presiede, tempo massimo, stato ed esito. Il motivo è uno di quattro: stima e divisione del lavoro, blocco o dipendenza tra squadre, revisione del candidato, conflitto. Tempo massimo predefinito 15 minuti per la stima e 20 per gli altri, da 5 a 60.
- Chi chiude: il capo squadra quando tutti i partecipanti sono nella sua squadra (entra nella discussione se non era nominato), il Coordinatore quando la discussione attraversa le squadre.
- Strumenti del Coordinatore: `open_discussion`, `read_discussions`, `decide_discussion`, e `blocksDiscussionID` in `request_decision`. Una nuova regola dice al Coordinatore di far parlare gli agenti invece di decidere da solo quando devono accordarsi.
- Turni: Trama fa parlare ogni partecipante una volta, in sola lettura, poi chi presiede chiude con una decisione o scrive la domanda di prodotto. Ogni messaggio registra provider e modello.
- Modello (Q17): il più leggero del provider del Coordinatore, riconosciuto dal nome come per il lavoro automatico; senza un modello leggero nel catalogo si usa quello del ruolo. L'impostazione del progetto "Modello delle discussioni" (Impostazioni, Metodo di lavoro) sceglie tra "Il più leggero" e "Del ruolo".
- Scadenza: a ogni giro periodico Trama chiude le discussioni oltre il tempo massimo con l'ultima proposta, o con la decisione di ripiego del motivo se nessuno ne ha fatta una. È una regola di Trama senza turni del modello: vale anche in pausa e nel progetto di esempio. La chiusura va in Attività.
- Scelta di prodotto: non si chiude tra agenti. Diventa una scheda del Patto in "Aspetta te" con l'etichetta "Discussione tra agenti"; la discussione aspetta la risposta anche oltre il tempo massimo. La risposta o il ritiro della persona chiudono la discussione. La scheda dice da quale discussione viene e la apre.
- La persona scrive nella discussione finché non è chiusa (Q32): il Coordinatore inoltra il messaggio, che resta nel thread come "Tu, tramite il Coordinatore"; se i turni erano finiti senza decisione, chi presiede lo legge e chiude.
- Interfaccia: nella vista Squadre ogni squadra elenca le sue discussioni (le aperte prima, al massimo tre) con i minuti che restano o lo stato; le discussioni tra squadre hanno una sezione loro. La vista della discussione mostra motivo, stato, tempo massimo, partecipanti con chi chiude, esito, i messaggi con il modello di ogni turno e le proposte, e il campo per scrivere. Tutti i testi nuovi, e quelli della vista del thread, sono nei cataloghi italiano e inglese.

## Verifiche

- Test: `app/src/main/core/discussions.test.ts` (apertura con capo squadra, discussione tra squadre, limiti del tempo massimo, rifiuti, scadenza con l'ultima proposta e con il ripiego, decisione prima della scadenza, domanda di prodotto in "Aspetta te" che non scade, risposta e ritiro della persona, messaggio della persona letto dagli agenti, ordine delle discussioni, scelta del modello, lettura delle risposte dei turni, strumenti del Coordinatore).
- ui-check, passi nuovi `41a` (vista Squadre con le due discussioni), `41b` (discussione che aspetta la persona, con il messaggio della persona), `41c` (la domanda in "Aspetta te"), `41d` (discussione chiusa dalla risposta), `41e` (discussione chiusa dal capo squadra, con le proposte), `41f` (impostazione del modello). `41a`, `41b` e `41e` in finestra stretta 1280x800 e larga 1680x1050, con i temi di Codex e Claude, in chiaro e scuro; `41c`, `41d` e `41f` in chiaro e scuro.
- Schermate in `docs/images/a12/`: prima con la build di main `48397bf`, dopo con questo branch sulla stessa main.
- Risultati su Linux nel container (xvfb), su main `48397bf`: `tsc` senza errori, `vitest` 164 file e 1548 test passati (3 saltati), `npm run build` ok, `ui-check` completato con 570 schermate (540 su main). Il passo delle discussioni sta alla fine del percorso del progetto di esempio: prima, i suoi turni in più del Coordinatore facevano partire una revisione automatica della memoria e cambiavano i passi successivi.

Non verificato: nessuna esecuzione reale di Codex. Nel catalogo del server di prova di ui-check al momento del passo non c'è un modello leggero, quindi i turni mostrano il modello del ruolo; la scelta del modello leggero è coperta dai test di unità. La scadenza reale al giro periodico (ogni cinque minuti) non è provata in ui-check, che non aspetta il tempo massimo: la coprono i test di unità.
