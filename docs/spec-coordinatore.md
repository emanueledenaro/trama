# Trama: Coordinatore generale, team di progetto e primo utilizzo

Stato: direzione di prodotto approvata da Emanuele dopo intervista e simulazione dell'esperienza. La specifica estende il prodotto esistente. L'accordo sui requisiti non prova che siano implementati.

## Problema

La persona deve poter dirigere più progetti senza seguire molte conversazioni e ricostruire da sola ciò che agenti, codice e GitHub stanno facendo. Al primo utilizzo deve capire come Trama aiuta a comprendere un progetto, modificarlo e verificarlo. Le funzioni già presenti devono mantenere comportamento, dati e verifiche durante l'estensione.

## Soluzione

Una sola chat principale ospita il Coordinatore generale. La selezione del progetto determina conversazione e team visibili; Tutti i progetti raccoglie stato, blocchi e decisioni richieste. I team conservano contesti separati anche mentre lavorano contemporaneamente. Il Product Owner sceglie obiettivi, priorità e compromessi. Il Coordinatore assegna specialisti in funzione dei bisogni reali, coordina verifiche e integrazione e riporta risultati nella chat.

Il primo avvio offre Configura e prova Trama oppure Apri un progetto. La guida verifica il componente Codex ufficiale, riusa l'accesso ChatGPT effettivamente utilizzabile e propone GitHub senza impedire l'esplorazione locale. AI Hero viene configurato nel progetto scelto preservando le personalizzazioni. Esercizi facoltativi, richiamabili e riprendibili usano copie locali dedicate: comprendere il progetto dalle fonti; modificare e verificare; prendere una decisione; confrontare lavori compatibili e incompatibili. Le dimostrazioni non simulano successi del modello o del verificatore.

## Storie utente

1. Come nuovo utente, voglio scegliere tra guida e apertura diretta, così il tutorial non diventa un requisito per ogni avvio.
2. Come nuovo utente, voglio riconoscere i componenti disponibili e i prerequisiti mancanti, così posso completare la configurazione senza credenziali API separate.
3. Come titolare di un account ChatGPT, voglio il riconoscimento o l'accesso ufficiale, così Trama non copia né gestisce i miei token.
4. Come utente, voglio verificare le capacità GitHub disponibili, così un semplice collegamento non viene confuso con il permesso di leggere o pubblicare.
5. Come utente, voglio usare il progetto di esempio senza GitHub, così posso esplorare e fare esercizi locali.
6. Come utente con configurazioni esistenti, voglio AI Hero automatico e conservativo, così non perdo istruzioni e personalizzazioni.
7. Come utente, voglio una spiegazione con fonti e collegamenti alla Mappa, così posso verificarla sui file rilevati.
8. Come utente, voglio modificare davvero la copia di esercizio e vedere un test fallire e poi riuscire, così comprendo la differenza fra promessa e verifica.
9. Come Product Owner, voglio un caso concreto con alternative e risposta libera quando cambia un comportamento, così la decisione resta mia.
10. Come Product Owner, voglio vedere la versione della decisione e i lavori dipendenti, così quelli indipendenti continuano.
11. Come utente, voglio un esercizio di conflitto etichettato come tale, così non scambio un branch di prova per un collaboratore reale.
12. Come Product Owner, voglio aprire o creare un progetto dal Coordinatore, così il passaggio dal tutorial al mio lavoro conserva lo stesso percorso.
13. Come Product Owner, voglio una chat in streaming con piani, autorizzazioni, agenti, eventi e risultati, così dirigo il lavoro da un solo punto.
14. Come Product Owner, voglio un mandato persistente per progetto, così il Coordinatore sa quali attività può avviare autonomamente.
15. Come Product Owner, voglio specialisti con ruoli liberi e motivati, così la squadra si adatta al dominio e alla fase del progetto.
16. Come Product Owner, voglio che il Coordinatore aumenti il parallelismo quando accelera il task, così non crea agenti inutili né applica un limite fisso di due.
17. Come Product Owner, voglio scegliere il modello della chat principale e vedere quelli scelti per gli specialisti, così ogni incarico ha un modello identificabile.
18. Come utente, voglio aprire Team o il dettaglio di un agente dalla chat, così posso vedere ruolo, ticket, perimetro, dipendenze, modello, strumenti, worktree, verifiche e ultimo aggiornamento.
19. Come Product Owner, voglio fermare un agente, correggere il perimetro o cambiare priorità, così posso intervenire conservando il lavoro già prodotto.
20. Come utente, voglio distinguere arresto richiesto e confermato, così un comando già iniziato non viene dichiarato annullato senza prova.
21. Come Product Owner, voglio che il cambio progetto lasci proseguire gli incarichi già autorizzati, così posso seguire un'altra attività senza interromperli.
22. Come utente, voglio cronologie, bozze, team e Patto separati fra cartelle, così lo stesso remote non fonde automaticamente progetti e approvazioni.
23. Come Product Owner, voglio riepiloghi globali e confronti dettagliati solo su richiesta, così i contenuti privati restano nel proprio contesto.
24. Come utente, voglio vedere file, diff, test e revisioni del candidato preciso dalla chat, così un risultato obsoleto non autorizza un'integrazione.
25. Come Product Owner, voglio che il Coordinatore mergi le modifiche ordinarie previste dal mandato dopo le verifiche, così non devo confermare ogni passaggio tecnico.
26. Come Product Owner, voglio essere coinvolto prima di operazioni distruttive serie, così il Coordinatore non decide al mio posto su effetti gravi.
27. Come collaboratore, voglio distinguere sovrapposizioni, conflitti Git riprodotti e possibili incompatibilità, così ogni avviso esprime il livello reale della prova.
28. Come utente, voglio eventi GitHub e monitor con fonti, versioni e tempi distinti dall'analisi AI, così dati vecchi non sembrano attuali.
29. Come Product Owner, voglio ticket aggiornati quando cambiano prove e avanzamento, così completato, pubblicato, integrato e verificato non vengono confusi.
30. Come utente, voglio chiudere la finestra lasciando lavorare Trama e usare Esci per fermare gli agenti, così posso controllare la continuità locale.
31. Come utente, voglio riprendere dopo stop o uscita senza perdere artefatti, così il recupero rispetta ciò che è realmente accaduto.
32. Come utente, voglio attesa e ripresa automatica dopo i limiti Codex mentre Trama è in esecuzione, così il lavoro autorizzato non richiede un nuovo prompt; Stop ed Esci mantengono invece la ripresa esplicita.
33. Come utente, voglio recuperare gli eventi dopo offline o sospensione senza duplicati, così non mi vengono promesse attività avvenute con il Mac indisponibile.
34. Come Product Owner, voglio team che migliorano metodi e composizione con evidenze e rollback, così le ottimizzazioni sono valutabili e non rimuovono controlli.
35. Come Product Owner, voglio proporre metodi generali ad altri team senza trasferire dati riservati, così il miglioramento rispetta l'isolamento.
36. Come sviluppatore di Trama, voglio usare Trama funzionante sul proprio repository con gli stessi controlli, così l'app può essere migliorata senza sostituire silenziosamente quella in uso.
37. Come utente, voglio UI Apple adattabile, tastiera, VoiceOver e suoni facoltativi per gli avvisi utili, così la chat non rende meno accessibili le funzioni esistenti.
38. Come sviluppatore esterno, voglio riprodurre il percorso da un clone pulito con requisiti e limiti documentati, così la beta non dipende dal Mac dell'autore.

## Decisioni di implementazione

- Conservare i moduli esistenti per catalogo progetti, scanner, Codex, Patto Vivo, sessioni, verifiche, pubblicazione e monitor. La chat aggiunge collegamenti e proiezioni dei loro eventi; non reimplementa quei motori.
- Separare selezione della UI, contesto persistente del progetto e runtime degli incarichi. Il Coordinatore è unico nel prodotto; gli specialisti appartengono al progetto e gli eventi non possono cambiare destinazione al cambio selezione.
- Espandere i dati persistiti con campi versionati e migrazioni compatibili. Copie legacy, approvazioni e worktree restano leggibili e conservati; una migrazione incompleta non concede nuove autorizzazioni.
- Usare eventi identificabili per messaggi, streaming, assegnazioni, autorizzazioni, prove e monitor. Conservare ordine, progetto, origine e correlazione con la richiesta; replay e riconnessione non duplicano azioni remote.
- Verificare sulla versione supportata di Codex le capacità di conversazione e ripresa. Il registro dell'app conserva i risultati confermati; una risposta del modello non è l'esito di un comando.
- Ogni specialista riceve identità, competenza, motivo, progetto, obiettivo, ticket, perimetro, dipendenze, modello OpenAI, strumenti, branch/worktree, verifiche, criteri, stato e ultimo aggiornamento. Un incarico di sola lettura dichiara worktree non necessario; un incarico di scrittura deve avere isolamento effettivo prima dell'avvio.
- Il Coordinatore può comporre e sostituire ruoli senza un catalogo chiuso. Deve motivare il parallelismo e rispettare risorse, capacità e priorità; il numero di agenti non dimostra da solo un guadagno di velocità.
- Test e revisione tecnica distinta dall'autore precedono il via libera delegato. Tale via libera non si registra come revisione umana, non amplia il mandato e non si attribuisce ai dati precedenti. Ogni modifica pertinente invalida soltanto le prove dipendenti.
- Merge autonomo significa operazione compresa nel mandato, su candidato e base ancora validi. Fallimenti, prove mancanti e conflitti bloccano l'integrazione; i casi distruttivi seri coinvolgono la persona. Deployment, distribuzione e sostituzione dell'app in uso restano autorizzazioni separate.
- Chiudere la finestra lascia attivi i lavori autorizzati; Esci arresta gli agenti in modo controllato. Il monitor separato, se abilitato, raccoglie eventi e checkpoint senza riavviare modifiche. Al ritorno si riconciliano stato effettivo e versioni prima di proseguire.
- Attesa per limiti Codex può riprendere automaticamente solo incarichi ancora autorizzati in un runtime rimasto attivo. Stop, Esci, crash o esiti incerti richiedono riconciliazione e non autorizzano la ripetizione cieca di operazioni con effetti.
- Il tutorial usa una copia locale marcata come esercizio. Non scrive su repository reali né pubblica con la sola partecipazione; un eventuale percorso remoto richiede la destinazione di prova autorizzata. Avanzamento degli esercizi deriva da eventi e verifiche, non da timer o risposte preconfezionate.
- Le pratiche condivise contengono solo metodi generali, verificati dal team destinatario prima dell'adozione. Credenziali, permessi, prove obbligatorie e decisioni di prodotto non sono oggetto di ottimizzazione autonoma.

## Decisioni di verifica

Verificare comportamenti ai confini pubblici, preferendo quelli esistenti: apertura e ripristino progetto; richiesta ed eventi Codex; delega, candidato e verificatore; pubblicazione GitHub; checkpoint monitor. Per i nuovi percorsi osservare chat e Team attraverso lo stesso stato persistente usato dall'app, senza verificare solo proprietà private o costanti del layout.

Il percorso di regressione parte da copie dei documenti precedenti e confronta richieste, piani, decisioni, approvazioni, modelli e riferimenti ai worktree prima e dopo. Prove con due progetti verificano che una risposta tardiva, un'approvazione o un evento non attraversino il confine. I test del protocollo affiancano, senza sostituire, chiamate reali al componente ufficiale e prove UI.

Per ogni incremento usare red-green sui comportamenti nuovi, suite pertinente, revisione Standards e Spec, prova diretta delle schermate coinvolte e CI del commit. La sola presenza di codice o un test con trasporto simulato non prova accesso GitHub, login, notifiche, isolamento del processo o comportamento del sistema operativo.

Ogni criterio mantiene riferimenti a prove, candidato/commit e parti mancanti. A completamento effettivo aggiornare la checklist e lo stato GitHub. La fine dell'agente non chiude un ticket; una riapertura conserva la storia dei controlli precedenti. La beta richiede tutte le verifiche della roadmap, interfaccia compresa, e un percorso da clone pulito.

## Fuori perimetro

Cloud 24/7, provider alternativi, credenziali API separate, modifica dei pesi dei modelli, accesso al lavoro non pubblicato dei collaboratori senza canale esplicito e cattura continua delle schermate non autorizzata. Queste esclusioni non rimuovono alcuna funzionalità precedente.

## Note di consegna

Prima stabilizzare e verificare l'incremento di design locale, poi costruire un percorso verticale completo della chat con un incarico isolato; ampliare ai team e ai progetti concorrenti. La riproducibilità locale resta distinta dalla beta scaricabile: quest'ultima richiede firma Developer ID, notarizzazione e installazione verificata su un secondo Mac.
