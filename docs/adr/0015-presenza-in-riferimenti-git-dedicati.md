# La presenza passa per riferimenti git dedicati sul remoto del progetto

Stato: proposta il 26 settembre 2026 per G01 (#174) della specifica #173 (decisioni 1, 2, 5, 6, 7 e 8). La prova diretta su GitHub resta da ripetere fuori dall'ambiente di sviluppo di G01: vedi "Verifica" più sotto.

La specifica #173 chiede che chi usa Trama condivida con il team la propria presenza: branch attivo, branch locali, percorsi dei file toccati, richiesta in corso e da quanto, insieme agli agenti di Trama. La decisione 5 esclude un server nuovo e chiede di passare per git, con qualunque remoto, e di verificare che GitHub accetti riferimenti come `refs/trama/presence/<utente>` senza mostrarli come branch.

Decisione:

- **Un riferimento per persona, fuori da `refs/heads`.** Ogni persona scrive `refs/trama/presence/<utente>`. `<utente>` è il login GitHub quando il remoto è su GitHub, altrimenti una forma normalizzata dell'e-mail di git (`ada@example.com` diventa `ada-at-example.com`). Il riferimento punta a un commit senza genitori con un solo file, `presence.json`. Ogni pubblicazione sostituisce il commit con un push forzato: il remoto conserva solo lo stato attuale.
- **Il record contiene solo nomi, branch e percorsi.** Branch attivo, "anche su", branch locali, percorsi dei file toccati, compito in corso con il titolo, da quando, ultima attività, battito e chiusura, e per ogni agente nome, colore, tag, branch, percorsi e compito. Mai il contenuto di un file. I percorsi che possono nominare un segreto (`.env`, `secret`, `credential`, `.pem`, `.key`, `.p12`) non escono nemmeno come percorso. Il record ha limiti di dimensione e di elementi.
- **Il repository della persona non cambia.** Trama costruisce e scarica i record in un repository bare nella propria cartella (`Presence/`), con `hash-object`, un indice temporaneo, `write-tree` e `commit-tree`. Il checkout del progetto viene solo letto.
- **Le credenziali sono quelle già presenti.** Su GitHub il trasporto usa `gh auth git-credential`, come la prova di unione di `conflicts.ts`. Su un altro remoto valgono gli helper e le chiavi SSH che la persona ha già configurato per git, senza prompt. Senza remoto `origin` la presenza resta locale e mostra solo la persona e i suoi agenti.
- **Chi ha il push condivide, chi ha la lettura vede.** Con il permesso di push noto e assente (GitHub), o quando il remoto rifiuta il push, Trama passa alla sola lettura e lo dice. La lettura dei colleghi non richiede il consenso, perché legge solo ciò che loro hanno scelto di condividere.
- **Niente condivisione senza consenso, per progetto.** Il consenso sta nel documento del progetto (`presence`). Trama lo propone in chat la prima volta che apre un progetto con altri collaboratori (altri autori nei commit o altri record sul remoto), con "Non ora" e "Condividi" a destra. Dopo un "Non ora" lo ripropone una sola volta, al primo conflitto o sovrapposizione trovati con la prova di unione. Interruttore e pausa stanno in Impostazioni e in Gruppo. La pausa lascia sul remoto un record chiuso, senza branch, file o compito; smettere di condividere cancella il riferimento.
- **Freschezza.** Un aggiornamento ogni 45 secondi e subito dopo un cambio di `HEAD`. Un record senza modifiche da 10 minuti è "inattivo da N min"; un record chiuso, o senza battito da tre intervalli, è "visto l'ultima volta"; dopo 7 giorni sparisce dal quadro. I branch GitHub restano nella vista Gruppo come prima.
- **Branch attivo.** È il branch del lavoro in focus in Trama, cioè il worktree dell'incarico più recente del task in focus; altrimenti il branch cambiato per ultimo. Gli altri branch cambiati negli ultimi 7 giorni sono "anche su".
- **La presenza è un'informazione, non un'evidenza.** Chiunque abbia il push può scrivere un riferimento con un altro nome. Trama tratta ogni record dei colleghi come dato non fidato: lo valida, lo tronca, scarta percorsi assoluti o con `..`, e non lo usa per decidere verifiche o unioni.

## Verifica

- Test di integrazione con un remoto bare locale (`app/src/main/core/presence.test.ts`): senza consenso nulla arriva al remoto; con il consenso il record contiene branch e percorsi e non il contenuto; un clone e un fetch ordinari non vedono il riferimento come branch; chi ha solo la lettura vede senza scrivere; pausa, chiusura e revoca funzionano; un remoto che rifiuta il namespace (`receive.hideRefs`, lo stesso meccanismo con cui GitHub protegge `refs/pull`) porta alla sola lettura.
- Passo `16-presence-*` di `npm run ui-check`: proposta in chat, pubblicazione dopo "Condividi" su un remoto bare, nessun branch nuovo, quadro in Gruppo con tema chiaro e scuro, pausa in Impostazioni.
- Prova su GitHub non eseguita. Dall'ambiente di sviluppo di G01 il push di `refs/trama/presence/probe-test` verso `emanueledenaro/trama` è stato respinto con HTTP 403 dal proxy della sessione, mentre il push del branch `feature/g01-presence` è riuscito: il rifiuto viene dalla politica della sessione e non dice nulla su GitHub. Anche la documentazione di GitHub non era raggiungibile dalla sessione. Resta quindi da confermare con un account reale:

  ```sh
  git push origin HEAD:refs/trama/presence/prova
  git ls-remote origin 'refs/trama/*'            # il riferimento c'è
  gh api repos/<owner>/<repo>/branches --paginate --jq '.[].name' | grep prova   # nessun risultato
  gh api repos/<owner>/<repo>/git/matching-refs/trama/presence   # il riferimento c'è
  git push origin :refs/trama/presence/prova
  ```

  Ci aspettiamo che GitHub accetti il push, perché l'API "Create a reference" accetta qualunque nome completo che inizia con `refs` e ha almeno due barre, e che non lo mostri tra i branch, perché la lista dei branch legge solo `refs/heads`. Se la prova smentisce l'attesa, Trama non si rompe: il rifiuto del push la porta alla sola lettura con il motivo visibile, e questo ADR va sostituito con l'alternativa scelta.

Alternative scartate: un branch dedicato come `trama/presence`, che comparirebbe tra i branch, nelle regole di protezione e nei trigger della CI; git notes, che si attaccano a commit e non a persone e si fondono male tra più autori; un file nel repository, che cambierebbe il lavoro della persona e finirebbe nelle pull request; un server o un servizio di terzi, esclusi dalla decisione 5.

Rischio aperto: non è verificato se un push fuori da `refs/heads` e `refs/tags` avvii i workflow di GitHub Actions con un trigger `push` senza filtri. Da controllare insieme alla prova su GitHub.
