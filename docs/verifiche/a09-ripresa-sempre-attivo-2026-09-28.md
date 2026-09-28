# A09: il Coordinatore sempre attivo riprende dopo i limiti del provider e alla riapertura

Data: 28 settembre 2026. Issue #249, specifica #239 (Q7, Q13), ADR 0017. Costruita su C11 (#43) e A05 (#245).

Tutte le prove usano il Codex di prova in `app/test-fixtures/fake-codex.mjs`: il file `FAKE_CODEX_QUOTA_FILE` fa le veci della quota esaurita di ChatGPT, `[attesa]` tiene il turno in corso finché Trama non si chiude, `FAKE_CODEX_NO_WAIT` lo fa rispondere alla riapertura. Nessun modello reale è stato chiamato.

## Cosa c'era già

- C11: il turno del Coordinatore aspetta la fine di un limite, di una quota esaurita o di un'interruzione di rete mentre Trama resta aperta, e riparte da solo con l'istruzione di controllare prima cosa era già fatto. Dopo Esci niente ripartiva da solo: la persona premeva Riprendi.
- A05: giro periodico, Pausa salvata con il progetto. Con il provider bloccato nessuna mossa automatica partiva, ma il giro continuava a far partire il lavoro degli sviluppatori e dei ruoli fissi, e la riga di stato non diceva dell'attesa.

## Cosa è cambiato

- Un limite del provider del Coordinatore ferma mosse e giri del progetto finché dura: né una mossa, né un giro, né un turno nuovo partono. Vale per il turno che aspetta la ripresa e per l'account bloccato quando il progetto ha lavori aperti.
- La riga di stato lo dice, con un'icona propria: "Aspetto che la quota di ChatGPT si sblocchi alle 15:30.", "Aspetto la fine del limite di ChatGPT, prevista alle 15:30." o "Aspetto che ChatGPT torni raggiungibile.", con sotto "Fino ad allora non parte nessun turno. Poi riprendo da solo.". L'orario compare solo se il provider lo dà; altrimenti la riga dice che il provider non lo dice. La Pausa resta raggiungibile.
- A fine limite il turno riparte da solo e subito dopo gira il giro che il limite aveva fermato. Quando l'account del Coordinatore torna usabile gira il giro.
- Alla riapertura di Trama, per il progetto aperto con mandato concesso, lavoro continuo attivo e fuori pausa:
  - il turno del Coordinatore chiuso da Esci o da un crash riparte da solo, come riga "Turno ripreso alla riapertura", senza riscrivere il messaggio e con l'istruzione di riconciliare prima di ripetere un'azione con effetti;
  - un turno fallito per un limite aspetta di nuovo la fine del limite, con i soli controlli dell'account per la quota, poi riparte;
  - se il provider è ancora bloccato, anche il turno chiuso da Esci aspetta lo sblocco;
  - gli incarichi degli sviluppatori fermati da Esci o da un crash riprendono nel loro worktree, se il mandato li copre ancora. Lo sviluppatore riceve una riga che gli chiede di controllare nel worktree cosa è già fatto prima di ripetere un'azione con effetti.
- Un progetto in Pausa resta in Pausa dopo il riavvio: né il turno né gli incarichi ripartono. Senza mandato o con il lavoro continuo spento vale il comportamento di C11: la persona riprende a mano.

## Prove eseguite

- `app/src/main/core/resumeWork.test.ts`: cosa riprende alla riapertura (turno chiuso da Esci o da crash, solo l'ultimo; turno fermato dalla persona o lasciato; turno fallito per un limite con l'orario del provider; incarichi fermati dalla chiusura e non quelli fermati apposta; niente in Pausa, senza mandato o con il lavoro continuo spento); riga di riconciliazione per lo sviluppatore solo nel turno dopo la chiusura; frasi della riga di stato con e senza orario, orario passato, altro giorno; riga di stato in attesa con gli sviluppatori al lavoro e in Pausa.
- `app/src/main/controller.test.ts`: con la quota esaurita la mossa automatica fallisce, la riga di stato dice l'attesa, il giro non apre turni, e a quota tornata la mossa riparte da sola; Esci durante un turno con mandato e ripresa da sola alla riapertura con la sezione di riconciliazione nel prompt; lo stesso in Pausa non riparte; turno fallito per quota prima di Esci che alla riapertura aspetta e poi riparte.
- `app/src/main/team.integration.test.ts`: incarico fermato da Esci che riprende da solo alla riapertura; lo stesso in Pausa resta fermo.
- `app/scripts/ui-check.mjs`, schermate `27a`-`27e` nei temi chiaro e scuro di due provider: riga di stato in attesa della quota, attesa dopo la riapertura senza turni nuovi, ripresa a fine quota, turno chiuso da Esci ripreso da solo, progetto in Pausa dopo il riavvio.

## Limiti

- Il Coordinatore lavora sul progetto aperto. Alla riapertura Trama apre l'ultimo progetto e riprende quello; gli altri progetti con lavori aperti riprendono dal passo registrato quando la persona li apre.
- Un limite temporaneo o un'interruzione di rete si ritentano fino a 5 volte, come in P10. Solo la quota aspetta senza limite di tentativi.
- L'orario della fine del limite è quello che il provider scrive nel messaggio o nello stato dell'account. Un "riprova tra 20 minuti" letto alla riapertura conta da quel momento.
- La riconciliazione dipende dal Coordinatore e dallo sviluppatore, che ricevono l'istruzione ma non un elenco delle azioni già registrate.
- Nessuna prova con un limite reale di ChatGPT né con una chiusura e riapertura su un Mac: la prova diretta nell'app è la corsa di ui-check con Electron sotto xvfb su Linux.
