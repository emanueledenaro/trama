# C11: ripresa del Coordinatore dopo limiti, chiusura e indisponibilità (2026-09-27)

Controllo di una parte dei criteri di #43 sull'app Electron, branch `feature/issue-43-resume-coordinator-m3vv5l`. Tutte le prove usano il Codex di prova in `app/test-fixtures/fake-codex.mjs`. Nessun modello reale è stato chiamato.

## Cosa c'era già

- P10 (#195): un errore del provider si legge come frase semplice, con le azioni di ripristino. Un limite temporaneo fa ripartire il turno del Coordinatore da solo, con un'attesa che raddoppia, fino a 5 tentativi. La persona può fermare i tentativi o riprovare subito.
- Esci blocca nuovi lavori e ferma gli specialisti in modo controllato. Un incarico fermato da un provider bloccato riprende da solo quando il provider torna disponibile, solo se il mandato lo copre ancora.
- Alla riapertura un turno rimasto in corso sul disco diventa interrotto, con la riga "Turno interrotto" al posto della risposta.

## Cosa è cambiato

- Quota esaurita: il turno del Coordinatore aspetta. Trama controlla l'account ogni 15 minuti, o all'orario di sblocco se arriva prima, e non avvia turni finché la quota è esaurita. Quando l'account torna usabile riprende il turno una volta, come riga di Trama, senza riscrivere il messaggio. La scheda dice "Trama controlla di nuovo la quota tra ... e riprende il turno da sola appena si sblocca", con Smetti di aspettare e Riprova ora.
- Provider o rete non raggiungibili: il turno riparte da solo con la stessa attesa crescente del limite temporaneo, fino a 5 tentativi.
- Dopo il risveglio del computer un'attesa per rete o quota viene controllata entro pochi secondi, invece che all'orario vecchio.
- Un'attesa vale solo se il turno fallito è ancora l'ultimo: un messaggio nuovo della persona, un cambio di progetto o Esci la annullano.
- Esci durante un turno lo chiude subito come interrotto, con il motivo "Trama è stato chiuso mentre il Coordinatore lavorava.", e rimette nella bozza i messaggi ancora in coda. Un turno trovato in corso sul disco senza Esci (crash o chiusura forzata) ha un motivo diverso: "Trama si è chiuso senza fermare il turno mentre il Coordinatore lavorava."
- Dopo Esci niente riparte da solo. La riga del turno interrotto ha il pulsante Riprendi; il turno ripreso compare come "Turno ripreso".
- Esito incerto: ogni turno ripetuto, a mano o da solo, riceve una sezione che chiede al Coordinatore di controllare conversazione e stato del progetto prima di ripetere un'azione con effetti.

## Prove eseguite

- `app/src/main/controller.test.ts`: rete assente con ripresa automatica e sezione di riconciliazione nel prompt; quota esaurita con soli controlli dell'account e ripresa quando torna; messaggio nuovo che annulla l'attesa; Esci durante un turno, riapertura, nessuna ripresa automatica, Riprendi.
- `app/src/main/core/document.test.ts`: motivi distinti per Esci e per un turno rimasto in corso.
- `app/src/shared/providerFailure.test.ts`: tipi di errore che Trama aspetta, attesa della quota, frasi mostrate.
- `app/scripts/ui-check.mjs`, schermate `23a`-`23f`: rete assente, quota esaurita e turno chiuso da Esci, nei temi chiaro e scuro di due provider, con le azioni a destra e la primaria per ultima.

## Limiti

- Nessuna prova con un limite reale di ChatGPT o con una rete davvero assente: le prove usano il fixture di trasporto dichiarato sopra.
- L'attesa vive solo mentre Trama resta aperto. Dopo una chiusura il turno fallito resta con le sue azioni e riparte solo su richiesta.
- Per i provider che non segnalano la quota nello stato dell'account, Trama ritenta il turno a ogni controllo, fino a 5 volte.
- La riconciliazione dipende dal Coordinatore, che riceve l'istruzione ma non un elenco delle azioni già registrate.
- Restano aperti gli altri criteri di #43: stati distinti per finestra chiusa, sospensione e offline con ultimo aggiornamento, coordinamento tra UI e helper, notifiche e suoni, revisione Standards e Spec.
