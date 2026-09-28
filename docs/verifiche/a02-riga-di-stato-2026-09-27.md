# A02: riga di stato del Coordinatore e mosse in Attività

Data: 27 settembre 2026. Issue #241, specifica #239 (Q6), note dall'audit #262 (problemi 2 e 10). Base: `origin/main` 36ef5f3.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 107 file, 942 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 230 schermate. Passi nuovi o cambiati: `15a-status-line-move` e `15b-activity` (chiaro e scuro), `17e-status-line-narrow` (finestra minima 720x640, chiaro e scuro), `18a2` e `18a3` (mossa non riuscita nella riga di stato), e lo stop delle mosse in corso dalla riga di stato.

## Comportamento

- La riga di stato sta nella barra di focus, fuori dal pannello del dialogo: resta visibile in ogni dialogo del progetto, anche senza task in focus.
- Trama la ricava dai dati, mai dal testo del modello: il turno in corso e la sua mossa, il piano in scrittura o in divisione, chi lavora su quale fetta, la mossa successiva del task in focus e le fette pronte. Esempi: "Sto verificando S1, poi assegno S2 e S3.", "Luca lavora su S1.", "Il prossimo passo è mio: assegno S1.".
- Senza lavoro in corso dice "Niente in corso.".
- Quando il lavoro aspetta la persona dice "Aspetto te per andare avanti." e la sua mossa è il pulsante primario, anche con il lavoro bloccato. La barra di focus mostra la mossa della persona anche nella fase bloccata.
- Quando il lavoro è fermo la riga dice perché in parole semplici, senza id, branch o file: per esempio "Il piano non è riuscito: va rifatto." o "Le fette S2 e S3 aspettano S1.". Il testo con gli id resta per il Coordinatore.
- Le mosse automatiche non sono più righe della chat: né la riga della mossa, né il gruppo di lavoro, né la riga "Turno interrotto" di una mossa fermata. In chat restano la risposta del Coordinatore, le schede e un eventuale errore con i suoi pulsanti di ripristino.
- La mossa che gira ha il pulsante Ferma nella riga di stato, prima della mossa della persona.
- Attività si apre dalla riga di stato ed elenca tutte le mosse automatiche del progetto, anche storiche, dalla più recente: nome, data e ora, durata, dialogo ed esito (in corso, fatta, non riuscita con il motivo, fermata, errore).
- Il lavoro del dialogo del progetto prende il titolo dell'obiettivo che i suoi incarichi servono; senza obiettivo resta il primo messaggio.
- Il pallino "libero" nel Team è un anello vuoto, non più verde, per non sembrare "al lavoro".

## Test

- `app/src/main/core/statusLine.test.ts`: progetto vuoto; mossa in corso e passo successivo; la riga che cambia con la mossa, con lo sviluppatore al lavoro e con un messaggio della persona; fette ferme dietro S1; mossa della persona con il lavoro bloccato; domanda aperta con il passo dichiarato; mossa non riuscita con il motivo; pulsante nel dialogo dell'obiettivo.
- `app/src/shared/activity.test.ts`: solo le mosse automatiche, dalla più recente, con i cinque esiti.
- `app/src/shared/timeline.test.ts`: la chat senza le righe delle mosse, con risposta ed errore.
- `app/src/main/core/focus.test.ts` e `workPhase.test.ts`: titolo dall'obiettivo, mossa della persona con il lavoro bloccato, motivo senza id.
- `app/src/main/controller.test.ts`: con il controller, la riga di stato nomina la mossa e il suo stop, e dopo lo stop la mossa è in Attività come fermata e non in chat.

## Limiti

- La barra di focus mostra ancora il titolo del primo messaggio quando il lavoro del dialogo del progetto non serve un obiettivo.
- Il motivo di una mossa non riuscita viene dal controllo esistente (#204) e cita ancora l'id dell'incarico.
- Il riepilogo a ogni traguardo (Q6) è un altro ticket.
