# Trama: il Coordinatore vero, incremento verticale

Stato: direzione approvata da Emanuele il 16 settembre 2026 dopo l'intervista registrata negli ADR 0006 e 0007. Questa specifica sostituisce l'ordine C03, C04, C05 del [piano operativo](piano-operativo.md) con un solo incremento verticale. Le funzioni esistenti restano la base; la [specifica del Coordinatore](spec-coordinatore.md) resta valida per tutto ciò che qui non viene ridefinito.

Riferimenti: [ADR 0006](adr/0006-coordinatore-thread-persistente-con-strumenti.md), [ADR 0007](adr/0007-finestra-centrata-su-decisioni-team-e-verifiche.md), [riferimento visivo della app Codex](reference/design-app-codex.md), [riferimento funzionale Synara](reference/synara-funzioni.md), [glossario](../CONTEXT.md).

## Problema

Il Coordinatore attuale apre un thread Codex effimero a ogni messaggio, riceve soltanto la frase della persona e le decisioni del Patto, e può solo leggere file. Non ricorda la conversazione, non conosce mandato, ticket, cronologia ed eventi del monitor, non compone un team, non assegna incarichi. La chat mostra richieste con un JSON formattato dentro. Il Product Owner lo ha giudicato inutilizzabile: Trama così è un pianificatore di piani, non il modo diverso di lavorare con i modelli descritto dal Patto Vivo.

## Soluzione

Il Coordinatore di un progetto diventa un interlocutore persistente che conosce tutto ciò che circonda il progetto, apre lui la conversazione con il suo studio, propone un team motivato, riceve un mandato e da lì assegna incarichi a specialisti isolati, verifica i candidati e riporta tutto in una sola conversazione. La finestra di Trama mette al centro la conversazione e intorno le tre cose che nessun altro strumento mostra: decisioni, team al lavoro, lavoro verificato. L'aspetto è quieto e neutro come la app Codex; l'impianto è quello di Trama.

Il primo scenario che deve funzionare fino in fondo è Trama su Trama: aprire il repository di Trama, ricevere lo studio, confermare il team, concedere il mandato, chiedere una modifica piccola, vederla assegnata a uno specialista, ottenere un candidato verificato con diff ed evidenze dalla chat.

## Storie utente

1. Come Product Owner, voglio che all'apertura di un progetto il Coordinatore lo studi e mi dica cosa ha capito (stack, stato, rischi, cosa manca), così non devo spiegargli il progetto.
2. Come Product Owner, voglio che lo studio comprenda codice e moduli, README, CONTEXT, AGENTS e docs, issue e pull request GitHub, branch dei colleghi, decisioni del Patto, mandato, richieste e candidati precedenti, eventi del monitor, cronologia della chat, modelli disponibili e skill installate, così niente di ciò che Trama sa gli resta nascosto.
3. Come Product Owner, voglio che lo studio si aggiorni da solo quando cambiano commit, branch, issue o Patto, rileggendo solo la parte cambiata, così il Coordinatore non lavora su una fotografia vecchia.
4. Come Product Owner, voglio che il Coordinatore ricordi la conversazione tra un messaggio e l'altro e dopo un riavvio, così "sì, procedi" ha un significato.
5. Come Product Owner, voglio che il Coordinatore abbia una memoria propria per progetto che sopravvive alla compattazione della finestra di contesto, così lo studio non va perso quando il thread si accorcia.
6. Come Product Owner, voglio vedere quanto della finestra di contesto è usato e ricevere un avviso in chat sopra una soglia che imposto io, così so quando il Coordinatore sta per dimenticare.
7. Come Product Owner, voglio che il Coordinatore proponga il team alla fine dello studio, con un motivo per ogni specialista, e che io lo confermi o corregga una volta, così la squadra nasce dal progetto e non da un catalogo.
8. Come Product Owner, voglio che dopo la conferma il Coordinatore aggiunga o tolga specialisti da solo entro il mandato, dicendolo in chat, così non devo gestire la squadra a mano.
9. Come Product Owner, voglio che senza mandato il Coordinatore legga tutto, esegua controlli in sola lettura e proponga, senza scrivere nulla, così aprire una cartella non concede niente.
10. Come Product Owner, voglio concedere, correggere e revocare il mandato da una scheda in chat, così il Coordinatore sa cosa può avviare da solo.
11. Come Product Owner, voglio che con il mandato il Coordinatore assegni incarichi a specialisti in worktree separati e integri le modifiche ordinarie, e che non scriva mai nel checkout principale, così il mio lavoro locale resta intatto.
12. Come Product Owner, voglio vedere in chat una scheda di incarico con specialista, obiettivo, perimetro, modello e verifiche richieste, così so chi sta facendo cosa.
13. Come Product Owner, voglio che le attività tecniche di uno specialista restino raccolte e chiuse in una riga per turno, apribile, così la conversazione resta leggibile.
14. Come Product Owner, voglio una scheda di candidato con diff, evidenze delle verifiche e revisione tecnica, così giudico ciò che è stato verificato e non una promessa.
15. Come Product Owner, voglio che un test fallito blocchi il via libera e che una correzione richieda nuove prove, così il candidato che vedo è quello verificato.
16. Come Product Owner, voglio che quando serve una scelta di comportamento il Coordinatore mi mostri il caso concreto con alternative e risposta libera, e che la mia risposta diventi una decisione versionata nel Patto, così decido comportamenti e non righe di codice.
17. Come Product Owner, voglio che il Coordinatore chieda a me i casi distruttivi seri e le scelte di prodotto, e nient'altro, così non approvo passaggi tecnici.
18. Come Product Owner, voglio una sidebar con i progetti e, sotto quello attivo, Team, Patto e Lavoro con stato vivo, così vedo a colpo d'occhio chi lavora, cosa è deciso e cosa è verificato.
19. Come Product Owner, voglio una striscia in alto con decisioni in attesa, incarichi in corso e candidati verificati del progetto attivo, così lo stato del progetto è sempre visibile.
20. Come Product Owner, voglio un ispettore a destra che mostri ciò che tocco in chat: una decisione con i lavori dipendenti, un candidato con diff ed evidenze, uno specialista con worktree e attività, un modulo con la Mappa, così Mappa, Modifiche e Issue restano raggiungibili senza essere sezioni.
21. Come Product Owner, voglio un composer con selettore di modello e sforzo, menzioni con @ di moduli, file, issue e decisioni, comandi con / per le skill, allegati immagine e testo incollato, così do contesto al Coordinatore senza spiegarglielo.
22. Come Product Owner, voglio scegliere il modello del Coordinatore e vedere e cambiare quello proposto per ogni specialista, così ogni incarico ha un modello identificabile.
23. Come Product Owner, voglio fermare uno specialista, cambiarne la priorità o correggerne il perimetro dall'ispettore, così intervengo conservando il lavoro già prodotto.
24. Come Product Owner, voglio che il Coordinatore riceva gli eventi del monitor e dei colleghi GitHub come contesto e me li riporti solo quando contano, così non seguo due fonti.
25. Come Product Owner, voglio che lo stato di accesso al provider, i modelli e le capacità siano rilevati e mostrati con la stessa forma per ogni provider, così ogni provider di Synara si aggiunge senza cambiare l'interfaccia.
26. Come utente, voglio che l'interfaccia sia neutra e quieta come la app Codex, con font di sistema, tema chiaro e scuro, Riduci trasparenza e contrasto aumentato rispettati, così Trama resta un'app Apple.
27. Come utente, voglio tastiera e VoiceOver sulle schede, sull'ispettore e sul composer, così la nuova chat non è meno accessibile della vecchia.
28. Come utente con documenti precedenti, voglio ritrovare richieste, decisioni, approvazioni e worktree dopo l'aggiornamento, così nulla di verificato va perso.
29. Come sviluppatore di Trama, voglio usare Trama sul repository di Trama con gli stessi controlli, così l'incremento è provato sul caso reale.

## Decisioni di implementazione

- Il Coordinatore è un thread Codex persistente per progetto, non effimero, ripreso a ogni apertura e dopo un riavvio con la ripresa del protocollo. L'identificativo del thread vive nel documento del progetto. Se il thread non è più recuperabile, il Coordinatore ne apre uno nuovo e lo alimenta con studio e memoria, dichiarandolo in chat.
- Trama ospita un server MCP locale su HTTP con token per sessione e lo registra nella configurazione del thread. Gli strumenti del Coordinatore sono l'unico modo in cui agisce sul mondo di Trama. Ogni strumento applica il mandato prima di eseguire e risponde con autorizzato, mandato assente, revocato, richiesta alla persona, fuori perimetro. Il rifiuto è una risposta, non un errore di trasporto.
- Strumenti minimi del verticale: leggi studio, leggi Patto, leggi mandato, leggi issue e pull request, leggi cronologia, scrivi memoria, proponi team, crea specialista, assegna incarico, ferma specialista, esegui controllo in sola lettura, richiedi decisione, richiedi mandato, dichiara candidato. Nessuno strumento scrive nel checkout principale.
- Lo studio del progetto è un documento strutturato prodotto da Trama dai dati che già possiede (scanner, catalogo, GitHub, Patto, mandato, richieste, monitor, cronologia) più i file di istruzione del repository. Viene iniettato all'avvio del thread e a ogni ripresa; si ricalcola per parti sui cambiamenti di commit, branch, issue e Patto. Non contiene segreti e file binari, già esclusi dallo scanner.
- La memoria del Coordinatore è testo per progetto con tetto di dimensione, scritta solo tramite strumento, persistita nel documento e reiniettata a ogni ripresa. La compattazione della finestra resta del provider; Trama la osserva dagli eventi di uso token e calcola il misuratore.
- Uno specialista è un'entità persistita del progetto con identità, competenza, motivo, obiettivo, ticket o esercizio, perimetro di moduli, dipendenze, modello, strumenti, worktree, verifiche richieste, stato e ultimo aggiornamento. Il suo runtime è un thread Codex avviato e posseduto da Trama, con cwd nel worktree, sandbox a scrittura nel solo worktree e rete disattivata, istruzioni scritte dal Coordinatore. Un incarico di sola lettura dichiara worktree non necessario.
- Il Coordinatore governa gli specialisti tramite gli strumenti, non tramite la delega multi-agente nativa di Codex, che resta disattivata nel runtime ristretto.
- La conversazione è una timeline di eventi identificabili e ordinati: messaggio della persona, testo del Coordinatore in streaming, attività tecnica, e le schede che sono gli atti del metodo: studio, proposta di team, mandato, incarico, decisione, candidato, conflitto, avviso di contesto. Le richieste e gli stati esistenti diventano eventi della timeline; i documenti precedenti si migrano con campi versionati e restano leggibili.
- La risposta del Coordinatore non è più vincolata a un solo oggetto JSON. La prosa è libera; le schede nascono dalle chiamate agli strumenti. La proposta di piano esistente diventa il contenuto della scheda di incarico o di candidato, con la stessa validazione delle fonti.
- L'impianto della finestra segue l'ADR 0007: sidebar con progetti e, sotto quello attivo, Team, Patto e Lavoro; colonna centrale con la conversazione e il composer; ispettore a destra per decisione, candidato, specialista, modulo, issue e gruppo; striscia di stato con i tre numeri in alto. Mappa, Modifiche, Decisioni, Gruppo e Issue si riusano come viste dell'ispettore.
- I token visivi vengono dal riferimento della app Codex: grigi neutri, font di sistema, raggi continui, ombre leggere, pulsante primario pieno, blu solo informativo. Il codice colore dei tre stati (deciso, in costruzione, verificato) è l'unico colore di identità. Da Synara si portano i comportamenti: bolla della persona senza bordo, risposta senza bolla, gruppo di attività collassato per turno, ispettore dell'attività, misuratore di contesto ad anello, chip e menzioni, selettore modello e sforzo, stato vuoto.
- Il collegamento ai provider assume la forma di Synara: un adattatore con capacità dichiarate, stato di accesso rilevato, catalogo modelli e opzioni per provider, eventi normalizzati in un solo formato consumato dalla timeline. V08 porta Codex nella forma comune; i ticket P01-P09 portano gli altri otto provider di Synara (Claude Agent, Cursor, Antigravity, Grok, Droid, OpenCode, Pi, Devin), riscritti in Swift senza Node dentro Trama, come deciso nell'[ADR 0008](adr/0008-provider-di-synara-in-swift.md). Cursor, Grok, Droid e Devin condividono un solo client ACP. Codex resta collegato direttamente all'app-server.
- Il monitor esistente continua a produrre i suoi eventi; il Coordinatore li riceve come contesto tramite lo studio e la cronologia. Le automazioni programmate alla Synara non entrano nel verticale.
- Le PR #56 e #62 sono la base su cui si costruisce; i ticket #57, #58, #59, #60 e #61 vengono chiusi come assorbiti o superati quando il verticale li copre.

## Decisioni di verifica

Le cuciture su cui si prova il comportamento, dalla più alta:

1. Strumenti del Coordinatore. Ogni strumento è una funzione da richiesta a risposta sul documento del progetto e sul mandato, provabile senza Codex: mandato assente, revocato, fuori perimetro, azione riservata alla persona, autorizzata. È la cucitura principale e nuova; la sua ampiezza fa sì che i test del mandato, degli specialisti e delle schede passino tutti di qui.
2. Timeline. Dagli eventi alla lista di righe e schede della conversazione, comprese la raccolta delle attività per turno e la migrazione delle richieste precedenti. Funzione pura, provabile con documenti di esempio e con copie dei documenti legacy come già fatto per C01.
3. Studio del progetto. Da un progetto scansionato più le fonti disponibili al documento di studio, e dall'elenco dei cambiamenti alla parte da ricalcolare. Provabile con il progetto di esempio.
4. Protocollo Codex. Il trasporto simulato esistente in CodexClient copre thread persistente, ripresa, configurazione MCP, override per turno, eventi di uso token e interruzione. Non prova il componente reale.
5. Prova nell'app con il componente reale e account ChatGPT sul repository di Trama: studio, team, mandato, incarico piccolo, controllo fallito e corretto, candidato con diff ed evidenze in chat, riavvio con ripresa della conversazione. Documentata in docs/verifiche con esiti e limiti.

Un buon test osserva il comportamento ai confini sopra, non le proprietà private delle viste. I test di regressione delle funzioni esistenti (scanner, Patto, worktree, GitHub, monitor) restano e devono restare verdi. Per ogni comportamento nuovo red-green prima del codice, revisione Standards e Spec, CI del commit. La chiusura richiede tutte le prove, compresa quella reale, e la documentazione dei limiti.

## Fuori perimetro

- Provider che Synara non supporta.
- Automazioni programmate, battito e politica di completamento alla Synara; il monitor esistente resta com'è.
- Tutorial ed esercizi guidati (C12-C14), ricalcolo selettivo degli incarichi (C06), cambio progetto con team che continuano (C07), conflitti fra specialisti e collaboratori (C08), integrazione tramite mandato (C09), aggiornamento ticket (C10), ripresa dopo limiti (C11), miglioramento del team (C15), Trama su Trama come processo continuo (C16). Restano ticket successivi, riformulati sopra questo incremento.
- Temi configurabili, font a scelta e voce nel composer.
- Firma Developer ID, notarizzazione e distribuzione.

## Note di consegna

L'incremento si costruisce per fette verticali, ognuna dimostrabile: la prima porta lo studio e la memoria in un thread persistente con la nuova timeline; la seconda gli strumenti e il mandato; la terza team e specialisti con un incarico che produce un candidato verificato; la quarta l'impianto della finestra e l'ispettore; la quinta il composer, il misuratore di contesto e la forma dell'adattatore provider; la sesta gli altri otto provider di Synara, prima di V09. La suddivisione precisa e le dipendenze sono nei ticket.
