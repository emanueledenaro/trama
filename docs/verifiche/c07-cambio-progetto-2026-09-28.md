# C07: cambiare progetto mentre i team autorizzati continuano

Data: 28 settembre 2026. Issue #39. Base: `origin/main` d9d1e04.

## Cosa c'era già su main

La PR #110 aveva già portato la parte principale del ticket:

- `parkSelectedProject` (`app/src/main/controller.ts`) ferma solo il Coordinatore del progetto lasciato. Gli specialisti già autorizzati continuano e scrivono nella cronologia del loro progetto.
- La barra laterale mostra i progetti che lavorano in secondo piano ("N al lavoro").
- La Panoramica dei progetti (`app/src/main/core/overview.ts`, `OverviewView.tsx`) riassume decisioni, lavoro fermo, risultati da approvare, lavoro in corso e ultimo aggiornamento, solo con conteggi e titoli.
- Test: `team.integration.test.ts`, "switching project (C07)"; `controller.test.ts`, turno lasciato in un progetto e fine tardiva ignorata (C02).

## Cosa aggiunge questa modifica

- **Capacità condivisa.** Gli sviluppatori di tutti i progetti aperti prendono il posto da un'unica riserva. Il limite condiviso vale sei, si sceglie da 1 a 12 in Impostazioni, Metodo di lavoro, accanto al limite del progetto. I ruoli fissi non contano. Un incarico autorizzato che trova la riserva piena resta in preparazione, con la riga "In attesa di uno sviluppatore libero" nella sua cronologia. Quando un posto si libera parte nel suo progetto, anche se la persona ne ha aperto un altro.
- **Priorità del Product Owner.** La Panoramica ha la sezione "Ordine dei progetti" con frecce per spostare un progetto. Il posto libero va al primo progetto della lista con lavoro in attesa, poi al lavoro che aspetta da più tempo. I progetti mai ordinati seguono per nome. Aprire un progetto non cambia l'ordine: l'ordine dei recenti non entra nel calcolo e `settings:update` ignora `projectPriority`. Un progetto in Pausa tiene il suo posto nella fila e riparte con Riprendi. Un incarico che il mandato non copre più non parte.
- **Panoramica.** Ogni progetto dice la CI delle pull request aperte dall'ultima lettura GitHub salvata, senza aprire una nuova connessione, e quanti incarichi aspettano uno sviluppatore libero. La sezione dell'ordine dice quanti sviluppatori lavorano in tutti i progetti.
- **Bozza.** Il salvataggio della bozza porta l'id del progetto. Se la persona cambia progetto prima del salvataggio, la bozza va nel progetto dove è stata scritta, anche se quel progetto è già stato chiuso. Il compositore salva subito la bozza in sospeso quando il progetto cambia.
- **Risultati tardivi.** Un conflitto tra worktree trovato per un progetto in secondo piano resta nella sua cronologia invece di sparire. L'avviso di provider bloccato nomina lo sviluppatore e il progetto invece dell'id dell'incarico.
- **Progetto di esempio.** Riaprire il progetto di esempio dalla barra laterale o dalla Panoramica, che passano solo la cartella, lo trasformava in un progetto qualunque di nome "Negozio". Ora resta il progetto di esempio. L'ha trovato il passo nuovo del ui-check.
- **Letture della Panoramica.** Quando più letture si sovrappongono, conta solo l'ultima: una lettura vecchia che finisce dopo non rimette dati superati.
- **Stesso remote.** Due cartelle con lo stesso `origin` restano due progetti con id, documento e bozza propri. L'identità viene dalla cartella. Trama non ha un collegamento tra cartelle, quindi niente fonde o elimina dati e approvazioni.
- I testi nuovi dell'interfaccia sono nel catalogo delle traduzioni (`app/src/shared/messages/it.ts` e `en.ts`). Le righe di attività scritte dal processo principale restano in italiano come le altre.

## Verifiche eseguite

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 140 file, 1308 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 377 schermate. Passi nuovi: `39a-overview-priority` e `39b-shared-developers`, in chiaro e scuro. Il passo sposta un progetto con la freccia, controlla che aprire un altro progetto non cambi l'ordine e sceglie il limite condiviso.

## Test

- `app/src/main/core/sharedCapacity.test.ts`: ordine salvato e poi per nome, indipendente dall'ordine dei recenti; spostamento di un posto; fila per priorità e poi per arrivo; limite condiviso nel suo intervallo.
- `app/src/main/team.integration.test.ts`, "switching project with shared capacity (issue #39)":
  - con limite 1 il secondo progetto aspetta, resta in memoria in secondo piano e parte nel suo progetto quando il primo libera il posto, senza eventi nel progetto aperto;
  - con tre progetti il posto va a quello messo per primo dalla persona, anche se è stato aperto prima; riaprire progetti e `settings:update` non cambiano l'ordine; alzare il limite fa partire il resto della fila;
  - limite condiviso e ordine restano dopo un riavvio;
  - una bozza tardiva va nel progetto dove è stata scritta, anche dopo la sua chiusura;
  - il progetto di esempio riaperto dalla sua cartella resta il progetto di esempio (il test fallisce senza la correzione);
  - due cartelle con lo stesso remote restano due progetti.
- `app/src/main/core/goals.test.ts`, "projects overview (UX03)": CI delle pull request aperte, incarichi in attesa, posizione nell'ordine.

## Schermate

Prima: build di `origin/main` 7e13d3f, prima della scelta della lingua. Dopo: questa modifica. Stesso script con due progetti di prova.

- `c07-cambio-progetto/01-panoramica-prima-chiaro.png`, `02-panoramica-prima-scuro.png`
- `c07-cambio-progetto/03-panoramica-dopo-chiaro.png`, `04-panoramica-dopo-scuro.png`: sezione "Ordine dei progetti" con la capacità condivisa.
- `c07-cambio-progetto/05-impostazioni-prima-chiaro.png`, `06-impostazioni-prima-scuro.png`
- `c07-cambio-progetto/07-impostazioni-dopo-chiaro.png`, `08-impostazioni-dopo-scuro.png`: riga "Al massimo in tutti i progetti".
- `c07-cambio-progetto/09-panoramica-dopo-inglese-scuro.png`: i testi nuovi in inglese.

## Limiti

- Il Coordinatore ha ancora un solo runtime, legato al progetto aperto. In un progetto in secondo piano partono solo gli incarichi già autorizzati e messi in fila. Le mosse del Coordinatore, i giri, la ripresa dopo una risposta o dopo il limite del provider aspettano che la persona riapra il progetto (vedi `a05-coordinatore-sempre-attivo-2026-09-28.md`).
- Le azioni della persona (approvare, rispondere, fermare) non portano l'id del progetto: valgono sul progetto aperto. Gli id di incarichi, decisioni e candidati sono casuali, quindi un'azione arrivata dopo un cambio non trova l'oggetto invece di toccarne uno di un altro progetto.
- La CI viene dall'ultima lettura GitHub salvata. Un progetto mai aperto con GitHub raggiungibile non ha CI da mostrare.
- Il resto della Panoramica non è ancora nel catalogo delle traduzioni: in inglese solo i testi nuovi cambiano lingua.
- Nessuna prova con un provider reale né revisione Standards e Spec registrata: il ticket chiede entrambe prima della chiusura.
