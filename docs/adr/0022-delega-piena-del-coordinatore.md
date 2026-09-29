# Delega piena: con "fai tutto tu" il Coordinatore lavora da solo, anche di notte

Stato: accettata il 29 settembre 2026 per la issue #423. Estende il lavoro continuo dell'ADR 0017 e si appoggia all'ADR 0021 (la richiesta scritta della persona sblocca ogni azione, le cancellazioni con conferma).

Con l'ADR 0017 il Coordinatore fa da solo tutto il ciclo dentro il mandato, ma si ferma sulle scelte della persona: decisioni di prodotto, candidati di interfaccia, lavoro nuovo. La persona vuole potergli dire "fai tutto tu" prima di andare a dormire e trovare il lavoro fatto al mattino, come fa con il coordinatore dello sviluppo di Trama: decide, unisce, riallinea, controlla e chiede solo le cancellazioni. Vuole anche che, con "fai tutti i ticket", prenda le issue scritte bene e le porti fino all'unione, e che i dubbi non lo fermino ma le vengano detti quando torna.

Decisione:

- **La delega piena nasce dalle parole della persona.** Quando la persona scrive nel composer "fai tutto tu", o parole con lo stesso senso, il Coordinatore la registra citando la sua frase; Trama controlla che la frase venga da un messaggio della persona in quel progetto, come per la richiesta scritta (ADR 0021). La delega resta finché la persona non la ritira, scrivendolo in chat o dalla vista Mandato.
- **Con la delega il Coordinatore decide anche quello che aspetta la persona.** Risponde alle domande di prodotto con la risposta che consiglierebbe, registrata nel Patto come "decisa dal Coordinatore con la tua delega"; approva i candidati che aspettano l'ok della persona dopo le schermate prima e dopo; apre il lavoro nuovo che serve all'obiettivo. Ogni scelta resta registrata con il suo dubbio e la persona la rivede.
- **La delega porta il mandato pieno.** Se il mandato in vigore non copre tutti i moduli e tutte le azioni delegabili, Trama ne registra una nuova versione che li copre. Ritirare la delega non tocca il mandato: la persona lo cambia dalla vista Mandato.
- **Non si stacca mai.** Con la delega Trama avvia da sola la mossa "Decidi con la delega" quando il lavoro aspetta una scelta della persona, prima delle altre mosse, e il Coordinatore non chiude un turno fermo se esiste un'altra mossa. I limiti del provider si aspettano e poi il lavoro riprende, come oggi. In "Aspetta te" restano da risolvere per la persona solo le conferme di cancellazione, che non fermano il resto del lavoro.
- **"Fai tutti i ticket".** Con la delega e questa richiesta, quando il progetto non ha lavoro aperto Trama avvia la mossa "Prendi la prossima issue": la issue aperta più vecchia con l'etichetta `ready-for-agent` su cui nessuno lavora. Il Coordinatore la porta fino all'unione e poi passa alla successiva.
- **Anche di notte.** Finché la delega è in vigore, il progetto ha lavoro aperto e non è in Pausa, Trama chiede al sistema di non andare in stop. Senza lavoro aperto torna il comportamento normale. Alla ripresa dopo uno stop parte subito un giro, che riprende dal punto registrato.
- **I dubbi non fermano il lavoro.** Il Coordinatore sceglie la strada che consiglierebbe e scrive il dubbio accanto alla scelta. Quando la persona torna nella finestra dopo un'assenza, Trama scrive il riepilogo "Mentre non c'eri" con cosa ha fatto e cosa ha deciso con la delega, con i dubbi, ciascuno da rivedere.

Aggiunte del 29 settembre 2026, dalla prova della delega e del ritorno della persona:

- **Il mandato segue il progetto.** Finché la delega è in vigore, i moduli che il progetto acquista dopo, come una cartella nuova creata dal lavoro, entrano in una versione nuova del mandato, prima di ogni turno del Coordinatore e nel giro, scritta in Attività. Quello che la persona ha tolto dalla vista Mandato dopo la delega resta fuori, e un mandato revocato resta revocato. Una richiesta di mandato che il mandato in vigore copre già è concessa con quella versione e non resta in "Aspetta te".
- **Gli obiettivi proposti prima si aprono.** Quando la persona dà la delega, gli obiettivi che il Coordinatore aveva proposto si aprono come quelli proposti dopo, ciascuno registrato tra le scelte da rivedere.
- **Un errore non ferma la notte.** Con la delega il giro riprende il lavoro anche dopo un turno della persona finito con un errore. Lo Stop resta della persona, ed è registrato nei dati con chi l'ha chiesto, non riconosciuto dal nome mostrato.
- **Sveglio anche fra due issue.** Con "fai tutti i ticket" il computer non va in stop finché resta una issue da prendere, anche quando il lavoro della precedente è unito.
- **Il ritorno vale anche alla riapertura.** Trama registra quando la persona lascia il progetto, perché Trama si chiude o perché apre un altro progetto. Quando lo riapre dopo un'assenza lunga, scrive il riepilogo "Mentre non c'eri". Il riepilogo del ritorno conta anche i disaccordi decisi con `settle_review` (ADR 0023).
- **La riga di stato dice cosa fa il Coordinatore.** Con la delega, per una domanda o un candidato che aspettano l'ok o per una richiesta di mandato, la riga di stato non dice "Aspetto te" ma la mossa del Coordinatore, per esempio "decido con la tua delega". Il pulsante della persona resta sulla scheda.

Alternative scartate:

- **Riconoscere "fai tutto tu" con una regola sul testo.** Una frase come "non fare tutto tu" o una richiesta con parole diverse sfuggirebbe o sbaglierebbe. Il Coordinatore capisce il senso e Trama controlla solo che le parole citate siano della persona.
- **La delega come impostazione.** Varrebbe anche quando la persona non l'ha chiesta. Nasce da un suo messaggio e si ritira allo stesso modo.
- **Fermarsi sul primo dubbio.** Al mattino la persona troverebbe il lavoro fermo dalla sera. Il dubbio scritto accanto alla scelta le lascia la decisione finale senza fermare la notte.
- **Tenere sveglio il computer sempre, anche senza lavoro aperto.** Consumerebbe batteria senza motivo. Il blocco dello stop dura solo finché c'è lavoro.
- **Prendere tutte le issue aperte.** Una issue senza criteri chiari porterebbe a lavoro sbagliato. Solo le issue con l'etichetta `ready-for-agent` sono abbastanza descritte per lavorare senza la persona.

Conseguenze:

- Il Coordinatore ha gli strumenti `grant_full_delegation`, `revoke_full_delegation`, `decide_with_delegation`, `approve_with_delegation` e `note_doubt`. Con la delega `propose_goal` apre l'obiettivo invece di proporlo.
- Il lavoro continuo ha due mosse nuove, "Decidi con la delega" e "Prendi la prossima issue", che partono solo con la delega in vigore.
- Il riepilogo ha una parte "Cosa ho deciso con la tua delega" e un motivo nuovo, il ritorno della persona.
- La vista Mandato mostra la delega, la frase che l'ha data, le scelte da rivedere e il pulsante per ritirarla.
