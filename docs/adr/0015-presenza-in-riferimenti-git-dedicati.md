# La presenza passa per riferimenti git dedicati sul remoto del progetto

Stato: proposta il 26 settembre 2026 per G01 (#174) della specifica #173 (decisioni 1, 2, 5, 6, 7 e 8). La prova su GitHub è stata eseguita il 26 settembre 2026 dal coordinatore: vedi "Verifica" più sotto.

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
- Prova su GitHub, eseguita dal coordinatore il 26 settembre 2026 dal Mac della persona su `emanueledenaro/trama` (PR #178): `refs/trama/presence/probe-test` viene accettato, si legge con `git ls-remote` e con l'API dei riferimenti, non compare tra i branch e si cancella con un push vuoto. Il riferimento di prova è stato rimosso subito dopo. Dall'ambiente di sviluppo di G01 la stessa prova non era possibile: il proxy della sessione rispondeva con HTTP 403.
- Per ripetere la prova:

  ```sh
  git push origin HEAD:refs/trama/presence/prova
  git ls-remote origin 'refs/trama/*'            # il riferimento c'è
  gh api repos/<owner>/<repo>/branches --paginate --jq '.[].name' | grep prova   # nessun risultato
  gh api repos/<owner>/<repo>/git/matching-refs/trama/presence   # il riferimento c'è
  git push origin :refs/trama/presence/prova
  ```

  Se GitHub cambiasse comportamento, Trama non si rompe: il rifiuto del push la porta alla sola lettura con il motivo visibile.
- CI: i workflow di questo repository partono solo su `main`, pull request e tag, quindi un push di presenza non avvia la CI. Un repository con un trigger `push` senza filtri va controllato a parte.

Alternative scartate: un branch dedicato come `trama/presence`, che comparirebbe tra i branch, nelle regole di protezione e nei trigger della CI; git notes, che si attaccano a commit e non a persone e si fondono male tra più autori; un file nel repository, che cambierebbe il lavoro della persona e finirebbe nelle pull request; un server o un servizio di terzi, esclusi dalla decisione 5.
