# La finestra è centrata su decisioni, team e verifiche, non su thread e diff

Stato: accettata il 16 settembre 2026, intervista sull'incremento verticale (Q16).

Gli strumenti AI per il codice condividono un impianto: lista di thread a sinistra, chat al centro, diff a destra. Il Product Owner ha rifiutato di copiarlo, anche dalla app Codex scelta come riferimento visivo, perché quell'impianto esprime il modello "un task, una chat, un diff da approvare" che Trama vuole superare.

Decisione: un progetto ha una sola conversazione con il Coordinatore e non esiste una lista di thread. La sidebar mostra i progetti e, sotto quello attivo, tre cose vive: Team (specialisti con stato e passo corrente), Patto (decisioni in vigore e in attesa), Lavoro (candidati con stato deciso, in costruzione, verificato). La colonna centrale è la conversazione, con la prosa del Coordinatore e le schede che sono gli atti del metodo: decisione, mandato, incarico, candidato, conflitto. Le attività tecniche restano raccolte e chiuse. L'ispettore a destra mostra ciò che si tocca: una decisione con i lavori dipendenti, un candidato con diff ed evidenze, uno specialista con worktree e attività, un modulo con la Mappa. Mappa, Modifiche, Decisioni, Gruppo e Issue smettono di essere sezioni e diventano viste dell'ispettore. In alto una striscia con decisioni in attesa, incarichi in corso e candidati verificati; il codice colore dei tre stati è l'unico colore oltre il grigio.

Il composer serve a decidere e a dare intenzioni. Le azioni principali della persona sono rispondere alle schede di decisione e concedere il mandato; il diff si consulta, non si approva riga per riga.

Eccezione del 25 settembre 2026 (D-6AE0F263, W15): ogni agente ha un proprio colore, preso da una palette fissa lontana dai colori di stato (verde, ambra, rosso). Il colore sta solo sulla sua identità: l'avatar con l'iniziale e il tag del ruolo, per esempio `Giulia [Interfaccia]`. Badge, schede, puntini di stato e la striscia in alto usano solo i colori di stato. Trama assegna alla creazione un colore libero e la persona può cambiarlo dalla vista Team. Ogni tinta resta leggibile in chiaro e in scuro con tutti i temi dei provider, e `app/src/shared/identity.test.ts` lo verifica.

Conseguenze: la app Codex resta il livello di qualità visiva (grigi neutri, font di sistema, quiete), non la pianta. Le viste esistenti si riusano dentro l'ispettore. L'ADR 0005 resta valido: il Coordinatore è l'unico interlocutore e le altre superfici sono di lettura e verifica.
