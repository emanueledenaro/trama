# A05: Coordinatore sempre attivo con giro periodico e Pausa

Data: 28 settembre 2026. Issue #245, specifica #239 (Q2, Q4, Q7, Q13), ADR 0017. Base: `origin/main` 0c56130.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 115 file, 1033 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0, 257 schermate. Passo nuovo: `15c-status-line-paused` (chiaro e scuro). Passo cambiato: `17e-status-line-narrow` controlla che le azioni stiano su una riga e che l'ultima tocchi il bordo destro.

## Comportamento

- Il limite di cinque mosse automatiche di fila non c'è più. Nessun freno sul consumo: lo fermano la Pausa o i limiti del provider.
- Senza un mandato concesso nessuna mossa automatica parte.
- Oltre alla fine di turni, piani e incarichi, pesano la mossa del Coordinatore una verifica rossa (sul candidato o nei controlli di una pull request), un conflitto tra worktree, una issue nuova e un commento o una revisione su una pull request senza nuovo push. Se il Coordinatore è occupato, l'evento aspetta la fine del turno.
- Dopo una verifica rossa, un conflitto o nel giro, il Coordinatore prova da solo a sbloccare un lavoro fermo quando la mossa è sua. Gli altri eventi non toccano un lavoro fermo.
- Il giro gira ogni 5 minuti sul progetto aperto con lavori aperti: riprende il lavoro con la risposta, fa prendere le fette pronte agli sviluppatori liberi, avvia il lavoro automatico dei ruoli fissi e la mossa del Coordinatore quando è sua. Senza lavori aperti non gira. Un giro senza niente da fare non apre turni del provider e non lascia tracce. Il giro non ripete la mossa che l'ultimo turno automatico del dialogo ha già fatto o tentato: la ripete un nuovo evento.
- All'apertura di un progetto, e dopo un riavvio, un giro parte appena il Coordinatore è pronto. Dopo Esci resta la regola esistente: un turno interrotto non riparte da solo.
- La Pausa è sempre nella riga di stato. In pausa non partono mosse automatiche, giri, lavoro automatico dei ruoli fissi, fette prese in autonomia, riprese dopo una risposta o dopo il limite del provider. I turni in corso finiscono. Un nuovo tentativo in attesa di una mossa automatica viene annullato. La riga dice "In pausa: i turni in corso finiscono, poi non parte niente finché non riprendi." e Riprendi prende il posto di Pausa.
- La pausa è salvata nel documento del progetto e resta dopo un riavvio. Riprendi fa partire subito un giro.
- In Attività ogni mossa automatica dice cosa l'ha avviata (per esempio "Nel giro periodico" o "Dopo una verifica rossa"). I giri con un esito compaiono come "Giro del Coordinatore" con quello che hanno fatto. Trama tiene gli ultimi 50 giri.

## Test

- `app/src/main/core/continuousWork.test.ts`: più di cinque mosse di fila dentro il mandato; nessuna mossa in pausa o senza mandato; mossa dopo verifica rossa, conflitto, issue nuova, commento e nel giro; niente quando il passo è della persona, in pausa o con il Coordinatore occupato; blocchi sbloccati solo dopo verifica rossa, conflitto o nel giro; il giro non ripete la mossa appena tentata; task in pausa esclusi; lavori aperti; Pausa e giri salvati; eventi letti da due letture di GitHub.
- `app/src/main/core/statusLine.test.ts`: riga in pausa con chi lavora ancora e senza lavoro.
- `app/src/shared/activity.test.ts`: giri accanto alle mosse, con l'origine della mossa.
- `app/src/main/controller.test.ts`: con il controller, in pausa nessuna mossa parte; la pausa resta dopo un riavvio; Riprendi avvia la mossa con un giro, registrato in Attività; il giro seguente non ripete la mossa e non chiama il provider; nessun giro senza lavori aperti.

## Schermate

- `a05-coordinatore-sempre-attivo/01-pausa-chiaro.png`, `02-pausa-scuro.png`: riga di stato in pausa con Riprendi.
- `a05-coordinatore-sempre-attivo/03-attivita-chiaro.png`, `04-attivita-scuro.png`: Attività.

## Limiti

- I giri e le mosse del Coordinatore girano solo sul progetto aperto. Il Coordinatore ha un solo runtime, legato al progetto selezionato: un progetto in secondo piano tiene al lavoro i suoi specialisti già avviati, ma le mosse del Coordinatore e i giri riprendono quando la persona lo riapre. Far girare il Coordinatore su più progetti insieme richiede un runtime per progetto: serve un ticket a parte.
- La frequenza del giro è fissa (5 minuti) e non ha ancora un'impostazione.
- Un commento su una pull request si riconosce dal cambio di data senza nuovo push o da una nuova revisione: anche una modifica di etichette o titolo conta come commento.
