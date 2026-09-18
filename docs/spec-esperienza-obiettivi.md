# Trama: esperienza centrata su obiettivi e risultati

Stato: direzione di prodotto e suddivisione UX00-UX08 approvate da Emanuele il 18 settembre 2026. L'implementazione è autorizzata per ticket; il layout di produzione richiede la validazione del prototipo UX00. Questo documento descrive requisiti, non funzionalità già dimostrate.

## Problema

La persona deve capire cosa sta succedendo nei progetti, chi lavora a ogni risultato, perché uno specialista appartiene al team, quale modello usa e su quali basi è stato scelto. Una conversazione centrale con attività sparse fra pannelli non rende necessariamente consultabili queste relazioni. Un agente terminato non dimostra che il risultato sia verificato, integrato o disponibile nell'app.

Il Coordinatore può comprendere obiettivi, progettare il lavoro e scegliere specialisti. Trama applica autorizzazioni e invarianti, registra gli eventi osservati e controlla le condizioni di integrazione. La persona decide obiettivi e compromessi di prodotto.

## Soluzione

L'ingresso è una panoramica dei progetti ordinata per ciò che richiede attenzione. La superficie del progetto parte dagli obiettivi e dai risultati. Ogni obiettivo conserva il risultato atteso, esempi di comportamento, un dialogo con il Coordinatore e collegamenti a decisioni, incarichi, specialisti, tentativi ed evidenze. Un dialogo di progetto raccoglie priorità e questioni trasversali.

Il Coordinatore mantiene la responsabilità del progetto anche con più dialoghi. Team e modelli vengono scelti entro il mandato, con motivazioni consultabili e possibilità di intervento umano. Lo stato deriva dalle fonti operative; una spiegazione del modello resta una valutazione attribuita al modello.

L'identità visiva è propria di Trama e nativa macOS. Le etichette quotidiane sono comprensibili: Obiettivi, Decisioni, Team, Lavori e Risultati. La semplificazione delle etichette conserva le distinzioni del dominio.

## Storie utente

1. Come persona responsabile, voglio vedere all'apertura quali progetti richiedono una decisione, sono bloccati o hanno un risultato disponibile, per decidere dove intervenire.
2. Voglio distinguere un dato aggiornato da uno storico o non disponibile, per non confondere mancanza di informazioni e assenza di problemi.
3. Voglio entrare in un obiettivo dalla panoramica senza perdere il contesto del progetto.
4. Voglio descrivere un risultato ed esempi verificabili prima che il Coordinatore lo deleghi.
5. Voglio conservare identità e criteri dell'obiettivo attraverso più incarichi e tentativi.
6. Voglio ritrovare gli obiettivi e le loro relazioni dopo un riavvio.
7. Voglio conversazioni separate per obiettivo, con un Coordinatore responsabile del progetto.
8. Voglio un dialogo di progetto per priorità e decisioni che riguardano più obiettivi.
9. Voglio sapere a quale progetto e obiettivo verrà inviato il messaggio prima di inviarlo.
10. Voglio ritrovare bozze, allegati e selezione quando cambio obiettivo.
11. Voglio che risposte, errori e richieste di autorizzazione tardive restino nel contesto di origine.
12. Voglio cambiare progetto senza interrompere gli incarichi già autorizzati né trasferire contenuti privati tra team.
13. Voglio trovare le decisioni aperte anche dopo molti messaggi, con alternative, raccomandazione e lavori dipendenti.
14. Voglio rispondere da una scheda o dal dialogo collegato senza registrare due decisioni diverse.
15. Voglio che cambiare una decisione sospenda soltanto il lavoro dipendente, conservi i risultati e richieda la rivalutazione delle prove.
16. Voglio distinguere una sospensione richiesta da una confermata.
17. Voglio che il Coordinatore componga il team entro il mandato senza chiedermi di approvare ogni assegnazione.
18. Voglio vedere responsabilità e motivo della presenza di ciascuno specialista, incarico corrente, collaborazioni, dipendenze e ultimo evento osservato.
19. Voglio vedere provider e modello effettivi di ciascuna esecuzione e la motivazione della scelta.
20. Voglio che la scelta del modello consideri prima la qualità richiesta e poi le risorse entro i limiti autorizzati; l'idoneità priva di evidenze resta dichiarata come tale.
21. Voglio aggiornamenti su passaggi significativi, senza percentuali inventate o messaggi ripetitivi di attività.
22. Voglio poter aprire attività e prove complete senza perdere obiettivo o bozza.
23. Voglio valutare il risultato confrontandolo con gli esempi concordati e con evidenze riferite alla versione precisa.
24. Voglio sapere come provare il comportamento e distinguere verifica, revisione, integrazione e disponibilità nell'app.
25. Voglio che aggiungere un repository mostri lo studio accessibile in sola lettura e permetta di formulare subito un primo obiettivo, senza configurare preventivamente tutto il team.
26. Voglio che dati e funzioni precedenti restino accessibili, compresi conversazioni, Mappa, Issue, decisioni, worktree e risultati.
27. Voglio svolgere il percorso anche con tastiera e VoiceOver, in finestra stretta, tema chiaro e scuro, con contrasto aumentato e trasparenza ridotta.

## Decisioni di implementazione

- Il prototipo è isolato dalla produzione, usa dati dichiaratamente simulati e nessun account o repository reale. Confronta disposizioni alternative del dialogo, dello stato e dei dettagli. L'approvazione riguarda percorsi osservabili, non una promessa di perfezione estetica.
- Un obiettivo è un risultato di progetto con identità stabile ed esempi di accettazione. È distinto da un messaggio, un incarico e un tentativo. Le relazioni verso incarichi, decisioni e risultati sono esplicite.
- L'incremento dello schema si basa sulla versione effettivamente integrata di P02. Le migrazioni preservano i dati precedenti; non attribuiscono automaticamente conversazioni storiche a obiettivi indovinati. I dati storici non associati restano consultabili nel contesto del progetto.
- Il destinatario di un'operazione viene fissato prima dell'invio. Identità di progetto, obiettivo, incarico e tentativo restano associate agli eventi pertinenti; la selezione della UI non determina la destinazione di una risposta in viaggio.
- Più dialoghi non autorizzano più Coordinatori indipendenti a modificare decisioni comuni. Mandato, decisioni versionate e strumenti mantengono un'autorità di progetto; la scelta delle sessioni tecniche deve dimostrare isolamento e coerenza prima di essere integrata.
- Le superfici di stato sono proiezioni delle entità esistenti e dei loro eventi. Non introducono un secondo elenco modificabile di esiti. Assenza, errore, stallo e dato storico restano distinguibili.
- La panoramica globale usa riepiloghi e timestamp senza incorporare automaticamente conversazioni private nel contesto di altri progetti. Visualizzare un progetto non ne cambia la priorità operativa.
- Le decisioni condivise restano uniche e versionate. Risposta dalla scheda e risposta dal dialogo usano la stessa azione validata. Eventi duplicati o risposte obsolete non producono due modifiche.
- C06 (#38), C07 (#39) e C09 (#41) restano proprietari rispettivamente del ricalcolo selettivo, della continuità multiprogetto e dell'integrazione tramite mandato. Si mantengono le loro dipendenze remote, incluso C08 (#40) per C09. I ticket UX ne realizzano le superfici e i collegamenti, senza duplicare i motori.
- La scelta del modello di uno specialista è motivata rispetto all'incarico, alle capacità e ai limiti autorizzati. Prima si valuta l'adeguatezza richiesta, poi il consumo fra alternative adeguate. Una valutazione AI non è una misura di qualità; quando mancano dati si dichiara il limite. Non vengono introdotti benchmark automatici o nuovi consumi non autorizzati.
- Restano in vigore le regole del cambio provider esplicito: nessun fallback automatico, nessuna perdita di conversazione o worktree. Provider e modello effettivi restano tracciati per turno. La nuova euristica per i modelli degli specialisti sostituisce soltanto il criterio del più economico dell'ADR 0009, quando UX05 sarà implementato e verificato.
- L'apertura di un repository autorizza lo studio previsto in sola lettura, non modifiche al repository o l'avvio di specialisti. Team e permessi vengono proposti quando servono al lavoro.
- Le prove di un risultato appartengono alla sua versione precisa. Il termine dell'agente, i test superati, la revisione, il merge e la disponibilità nell'app rimangono fatti separati.
- La posizione dei pannelli viene fissata da UX00. Sono criteri obbligatori contesto di invio visibile, azioni vicine al loro oggetto, dettagli apribili senza perdere lo stato e adattamento della finestra senza quattro pannelli obbligatori.
- Ogni ticket mantiene uno stato dimostrabile autonomamente. Le nuove superfici non presentano come operativa una capacità ancora bloccata dalle dipendenze.

## Relazione con le decisioni precedenti

Questa direzione cambia la conversazione unica per progetto degli ADR 0005, 0006 e 0007 e il ruolo permanente della chat al centro della finestra. Conserva il Coordinatore come interlocutore, i confini fra progetti, l'app nativa e il controllo programmato delle autorizzazioni. L'aggiornamento puntuale del glossario e degli ADR avviene nei ticket che introducono i nuovi comportamenti, citando questa approvazione e la validazione del prototipo. Fino a quel passaggio, P02 prosegue secondo il suo incarico esistente.

## Decisioni di verifica

1. Confine principale: azioni pubbliche sul documento di progetto e strumenti del Coordinatore. Testare creazione e riapertura degli obiettivi, routing delle conversazioni, decisioni condivise, autorizzazioni e rifiuto degli esiti obsoleti. Riutilizzare il modello dei test esistenti di autorizzazione, team e candidati.
2. Persistenza: round trip, migrazione da documenti precedenti e riapertura senza perdita di cronologia, bozze, riferimenti, versioni o evidenze. Metadati assenti non vengono inventati.
3. Presentazione: test delle proiezioni di stato e navigazione secondo il precedente dei test di panoramica e timeline. Stessi dati devono produrre stati coerenti in obiettivo, panoramica, scheda e dettaglio.
4. Runtime: usare i trasporti simulati ai confini esistenti per eventi tardivi, ordine e duplicati, interruzione richiesta/confermata e limiti dei provider; aggiungere prove reali sui percorsi integrati. Una fixture non prova un'integrazione con un provider reale.
5. UI: primo avvio, due obiettivi nello stesso progetto, due progetti in esecuzione, decisione bloccante, cambio di direzione e consegna. Ogni prova identifica build, commit e dati usati, con esito e limiti. Tastiera, VoiceOver e adattamento della finestra sono verifiche di ciascuna superficie, non soltanto del ticket finale.
6. Produzione: test di regressione prima del fix quando applicabile, build e suite completa, review Standards e Spec, CI del candidato finale. Il prototipo dimostra interazioni e leggibilità; non sostituisce queste verifiche.

## Sequenza approvata

Specifica pubblicata come #97 in `emanueledenaro/trama`. I ticket e le loro dipendenze native vivono su GitHub; i file locali ne conservano il brief approvato.

| Ticket | Consegna | Dipendenze |
| --- | --- | --- |
| UX00 #98 | Prototipo nativo dei flussi | Nessuna dipendenza di codice; unico implementatore disponibile |
| UX01 #99 | Obiettivi persistenti ed esempi | UX00 #98 con layout approvato |
| UX02 #100 | Dialoghi per obiettivo | UX01 #99, P02 #81 |
| UX03 #101 | Panoramica per attenzione | UX01 #99, C07 #39 |
| UX04 #102 | Decisioni persistenti e impatti | UX02 #100, C06 #38 |
| UX05 #103 | Team e modelli spiegabili | UX02 #100 |
| UX06 #104 | Risultati verificabili | UX02 #100, C09 #41 |
| UX07 #105 | Studio e primo obiettivo | UX02 #100, UX05 #103 |
| UX08 #106 | Verifica complessiva | UX03 #101, UX04 #102, UX05 #103, UX06 #104, UX07 #105 |

## Fuori perimetro

Nuovi provider oltre al piano P01-P09, cambi automatici di provider, benchmark generalisti dei modelli, cloud sempre attivo, deployment e distribuzione impliciti, editor completo, configurazione libera di ogni pannello e riscrittura del motore di controllo. L'implementazione conserva SwiftUI e i controlli Apple. La raccolta delle prove usa progetti di prova, senza modificare dati reali dell'utente.

## Note di esecuzione

GPT-6 Astra coordina e verifica. Un solo implementatore SWE-2 è attivo alla volta, in un thread nuovo per ticket. UX00 può iniziare quando P02 è fermo al checkpoint, in un worktree separato; il codice di produzione segue le dipendenze e il prototipo approvato. La revisione non confonde codice locale, commit, push, merge e prove nell'app.

Il lungo materiale di riferimento incollato durante l'intervista è arrivato parzialmente troncato. Questa specifica usa le risposte esplicite e le decisioni confermate; non attribuisce requisiti né citazioni bibliografiche alla porzione non letta. Il layout e le questioni emerse dal prototipo restano da validare prima dei ticket dipendenti.
