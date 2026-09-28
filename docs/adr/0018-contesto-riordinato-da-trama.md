# Il contesto degli agenti lo gestisce Trama

Stato: accettata il 28 settembre 2026 per la issue #313 (decisioni Q1-Q7). Sostituisce la regola di `docs/spec-coordinatore-verticale.md` secondo cui "la compattazione della finestra resta del provider". La misura del contesto per ogni provider è corretta dalla issue #305.

Fino a qui ogni provider compattava il contesto a modo suo, quando voleva e senza che Trama sapesse cosa restava. Trama mostrava un misuratore e una scheda "Contesto oltre la soglia", ma non decideva niente. La persona vuole che il contesto lo gestisca Trama, uguale per ogni provider ("il contesto non lo deve fare Codex").

Decisione:

- **La soglia resta per progetto, predefinita 80%.** Si sceglie dal misuratore, da 5% a 95%. Oltre la soglia Trama riordina il contesto.
- **Il riordino avviene a fine turno, mai a metà.** Una lettura oltre la soglia durante un turno segna il riordino come dovuto. Alla fine del turno, prima dei messaggi in coda, Trama scrive un riepilogo di contesto dai suoi dati: obiettivi e fuoco, decisioni del Patto, mandato, piano e candidati, incarichi in corso, richieste che aspettano la persona con i loro riferimenti, fase del lavoro, percorso di Ask Trama e grilling in corso, ultimi scambi alla lettera e una riga per ogni messaggio precedente della persona. Il modello non lo scrive.
- **Il riepilogo va in Attività e nella sessione nuova.** Trama lo salva in Attività come "Riepilogo del contesto" e apre una sessione nuova per la strada del passaggio di consegne già usata da /compact, /handoff e dal cambio di provider: studio, memoria e riepilogo al posto della trascrizione grezza. La conversazione precedente resta raggiungibile con `session_search` e `read_history`.
- **Il thread vecchio si lascia solo quando il nuovo è pronto.** Trama conserva il thread vecchio con quello che aveva ricevuto (studio, memoria, regole, pratiche, riferimenti). Se la sessione nuova non si apre, il Coordinatore torna al thread vecchio. I messaggi in coda passano alla sessione nuova, dopo il suo studio.
- **La compattazione del provider è solo un ripiego.** Se la sessione nuova non si apre, Trama chiede al provider di compattare il thread vecchio con il metodo facoltativo `compact` di `AgentRuntime`: Codex con `thread/compact/start`, OpenCode con `session.summarize`. Se il provider non lo offre o fallisce, il riordino resta dovuto e Trama riprova al messaggio successivo. La compattazione automatica di Codex parte a metà strada tra la soglia di Trama e la finestra piena (`model_auto_compact_token_limit`), così agisce solo dentro un turno lunghissimo. Una compattazione del provider annulla un riordino dovuto.
- **Il misuratore mostra solo la percentuale.** "Contesto del Coordinatore: 62%", con i token al passaggio del mouse e mai oltre la finestra. Nessun nome di provider nei testi. Il comando "Riordina ora" riordina subito tra un turno e l'altro, o a fine turno se un turno è in corso.
- **In chat una riga "Contesto riordinato".** La riga si apre sul riepilogo. Se il riordino non riesce, una scheda "Contesto quasi pieno" dice se il Coordinatore continua nella sessione compattata o se Trama riprova al prossimo messaggio.
- **Gli specialisti si riordinano alla ripresa.** Trama salva in ogni turno dello specialista la lettura più alta. Un turno di specialista è indivisibile. Alla ripresa, se l'ultimo turno ha superato la soglia, Trama apre un thread nuovo con un riepilogo del worktree (obiettivo, branch, commit rispetto alla base, file cambiati, ultimo aggiornamento) invece di riprendere il thread vecchio. L'attività "Nuovo thread dello specialista" dice perché.
- **La memoria tiene i limiti dell'ADR 0014.** Una memoria sopra il limite diventa una proposta di consolidamento da approvare (issue #305).

Alternative scartate:

- **Lasciare la compattazione al provider.** Ogni provider decide da solo cosa tenere e quando: il Coordinatore può perdere decisioni, mandato e richieste in attesa senza che Trama lo sappia.
- **Un riepilogo scritto dal modello.** Costa un turno e può omettere quello che conta. I dati di Trama (Patto, mandato, incarichi, richieste) sono già la fonte di verità.
- **Riordinare a metà turno.** Interromperebbe un lavoro in corso e perderebbe lo stato del turno. A fine turno il Coordinatore ha già chiuso le sue mosse.
- **Spegnere del tutto la compattazione del provider.** Un turno lunghissimo fallirebbe. Come ripiego sopra la soglia di Trama non toglie il controllo a Trama.

Conseguenze:

- La scheda "Contesto oltre la soglia" non compare più. Le schede già salvate restano nella storia.
- `CoordinatorState` ha `pendingRollover` (riordino dovuto) e `contextWindow` (ultima finestra nota, per il limite della compattazione del provider). `pendingHandover` porta il riepilogo e il thread da recuperare.
- Claude, Pi e i provider ACP non offrono ancora `compact` in Trama. Le loro compattazioni automatiche non sono spostate sopra la soglia: per Claude e OpenCode servono prove con un account reale prima di cambiarle, per Pi un gestore di impostazioni solo in memoria che non tocchi quelle globali della persona.
- Le sessioni cloud (#260, #263) non hanno ancora codice. Quando arriveranno, riceveranno un riepilogo limitato nella nuova attività, senza misuratore.
- La prova reale con Codex e il modello gpt-6-luna va registrata in `docs/verifiche/` quando si fa con un account.
