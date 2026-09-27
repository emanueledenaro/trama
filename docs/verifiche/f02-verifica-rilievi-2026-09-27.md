# F02: verifica dei rilievi della focus mode con prove

Data: 27 settembre 2026. Issue #126, specifica #124. Base: `origin/main` 2257d52.

## Cosa è stato verificato

Tutte le prove usano il Codex finto (`app/test-fixtures/fake-codex.mjs`). Nessuna esecuzione reale di Codex.

- `npx tsc --noEmit -p .`: nessun errore.
- `npx vitest run`: 104 file, 928 test superati, 3 saltati.
- `npm run build`: riuscito.
- `xvfb-run -a node scripts/ui-check.mjs`: una corsa completa, uscita 0. Passi nuovi: `20e-focus-audit-findings` (chiaro) e `20f-focus-audit-findings-dark` (scuro).

## Comportamento

- Ogni rilievo di un asse ha una prova: `file:riga` con il testo citato, un comando o una riproduzione. Senza prova il rilievo resta un'ipotesi.
- Trama ricontrolla le prove che può eseguire. Per `file:riga` legge la riga nel worktree del candidato, con le stesse regole delle letture del repository: niente segreti, niente collegamenti simbolici, niente percorsi fuori dal worktree. Per un comando guarda se è una delle verifiche di Trama in quell'esame e se è fallita davvero. Trama non esegue comandi o riproduzioni scritti da un modello.
- Un rilievo grave che Trama non può ricontrollare passa al modello del Coordinatore, in una sessione in sola lettura, quando è diverso dal modello più leggero usato dagli assi. Senza un modello più forte, o se la conferma fallisce, il rilievo resta un'ipotesi.
- Stati: "Verificato da Trama", "Confermato da un secondo modello", "Ipotesi". Un rilievo in attesa di verifica compare come "Da verificare"; se l'esame si interrompe diventa un'ipotesi.

## Test

- `app/src/main/core/auditFindings.test.ts`: rilettura di una riga con e senza testo citato, riga o file inesistenti, segreti, collegamenti simbolici e percorsi esterni non letti; un comando regge solo se è una verifica di Trama fallita; i tre stati su un esame con sette rilievi; un rilievo grave senza prova non va alla conferma; rifiuto, errore e assenza del secondo modello lasciano un'ipotesi; nessun rilievo verificato senza prova.
- `app/src/main/core/audit.test.ts`: lettura della risposta degli assi con l'elenco dei rilievi.
- `app/src/main/focusAudit.integration.test.ts`: con il controller e un catalogo con un modello leggero, gli assi girano su `gpt-5.5-mini`; il rilievo Standards con `file:riga` è verificato; il rilievo Spec grave con una riproduzione è confermato da `gpt-5.5` in una sessione effimera nel worktree; il rilievo minore con un comando esterno alle verifiche resta un'ipotesi.
- ui-check: gli stessi tre stati nella vista, la prova di ogni rilievo, la riga "Stato dei rilievi" nella sintesi, in chiaro e in scuro.

## Limiti

- La vista resta nell'ispettore; la vista a tutto schermo con la prova a destra è un altro ticket.
- "Verificato da Trama" dice che la prova regge (la riga esiste e dice ciò che l'asse ha citato, o la verifica è fallita davvero), non che il giudizio dell'asse sia giusto.
- Nell'ambiente Linux della prova `swift` non è installato, quindi `swift_build` e `swift_test` risultano non superate nella focus mode. Per questo il rilievo minore del Codex finto usa un comando esterno alle verifiche di Trama.
