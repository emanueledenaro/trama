# Dominio di Trama

Trama è un'app macOS per esplorare un repository e collegare una richiesta ai moduli, alle decisioni e alle verifiche che la riguardano.

Un progetto è una cartella locale. Un modulo raggruppa file rilevati in una directory; il raggruppamento non prova una responsabilità architetturale. Una richiesta conserva il modulo selezionato. Un piano descrive modifiche proposte e resta distinguibile dal codice esistente.

Una decisione registra un comportamento, un esempio e una motivazione. Ogni modifica della decisione incrementa la sua versione. Una delega collega il lavoro alle versioni delle decisioni e al perimetro ammesso. Un candidato identifica la versione concreta del lavoro. Un'evidenza appartiene a un candidato e a una specifica versione delle verifiche. Una revisione umana riguarda esattamente quel candidato; nuove evidenze o decisioni pertinenti invalidano il via libera.

Il Patto Vivo è questo legame operativo tra decisioni, deleghe e verifiche. Non è una sandbox. I risultati del progetto di esempio verificano esclusivamente i suoi casi locali.

## Lingua

Il codice sorgente e i commit sono in inglese. Le parole rivolte alla persona, inclusi interfaccia, documentazione di prodotto, issue e pull request, sono in italiano. I contenuti persistiti e le fonti esistenti mantengono la loro lingua per non alterare il loro significato.

## Ruoli e coordinamento

Product Owner: la persona che decide obiettivi, priorità, comportamenti del prodotto e compromessi. La responsabilità di queste decisioni resta umana.

Coordinatore generale: l'interlocutore principale della persona per tutti i progetti registrati in Trama. Riunisce lavoro e risultati dei team, mantenendo distinti progetti e decisioni.

Team di progetto: l'insieme degli specialisti appartenenti a un singolo progetto. È sempre completo: ha tutti i ruoli fissi e gli sviluppatori scelti per il progetto. Solo gli sviluppatori dipendono dalle necessità del progetto e cambiano nel tempo.

Specialista: un agente con una competenza e un incarico motivato all'interno di un team di progetto. Il ruolo è distinto dal modello AI usato per svolgerlo e non conferisce autorità sulle decisioni del Product Owner.

Ruolo fisso: una figura che ogni team di progetto ha sempre, qualunque sia il progetto: QA, UX, ricerca, documentazione e dominio, bug triage e debugger, revisore della spec, Clean Code, guardiano delle regressioni, sicurezza, prestazioni, DevOps. Ha una competenza, le skill di AI Hero su cui si basa e i suoi momenti. Sicurezza e prestazioni sono aggiunte di Trama e non hanno una skill. Trama crea i ruoli fissi con il progetto e li aggiunge ai progetti esistenti; nessuno li toglie dal team. Non contano nel limite degli sviluppatori in parallelo.

Sviluppatore: uno specialista scelto per il progetto, che realizza le fette con `implement` e `tdd`. Il Coordinatore propone gli sviluppatori alla fine dello studio e solo la risposta della persona li crea; poi il Coordinatore li cambia entro il mandato.

Momento: il punto del flusso in cui una figura del team interviene: chiarimento e spec, fette, candidato, in sottofondo. In ogni momento la figura ha un compito e le skill che usa lì; una figura può avere più momenti. Il momento dice quando una figura lavora, non che stia lavorando.

Provider: il programma esterno con cui Trama parla per far lavorare un agente, per esempio Codex o Claude Agent. È distinto dal modello, che è una scelta interna al provider, e dal ruolo dello specialista, che non dipende da nessuno dei due. Un provider è collegato quando la persona ha reso disponibile il suo account.

Selezione del composer: il provider, il modello e le opzioni del provider scelti per i prossimi turni di un dialogo. Resta associata alla bozza e al dialogo, conserva preferenze separate per provider e viene fotografata quando un turno entra in coda.

Attribuzione del turno: il provider e il modello che hanno effettivamente eseguito un turno. È distinta dalla selezione mostrata nel composer; una differenza viene conservata e resa visibile.

Stato di accesso: la condizione di un provider rispetto all'account della persona: autenticato, non autenticato o sconosciuto. È distinto dall'essere collegato, perché un provider collegato può essere non autenticato, per esempio dopo la scadenza di un token.

Chiarimento (grilling): i turni di domande con cui il Coordinatore chiarisce una richiesta prima che diventi un piano o un incarico, secondo la skill `grilling` di AI Hero. Ogni turno pone la frontiera, cioè le sole decisioni che si possono già chiedere, come schede di decisione numerate con la risposta consigliata. I fatti il Coordinatore li cerca da solo. Il piano parte quando nessuna domanda del chiarimento è aperta e la persona ha confermato la comprensione condivisa; una domanda ritirata non è aperta. Una domanda informativa non passa dal chiarimento.

Domanda ritirata: una domanda di decisione, anche di un turno di chiarimento, che la persona chiude senza rispondere e con un motivo. Resta nella cronologia, non diventa una decisione e non blocca più il turno successivo né il piano. Il Coordinatore riceve il ritiro e il motivo come messaggio della persona, nel dialogo in cui aveva posto la domanda. Una domanda con risposta non si ritira: la decisione presa resta e si rivede con una decisione nuova.

Incarico: un lavoro assegnato dal Coordinatore a uno specialista, con obiettivo, perimetro, dipendenze e verifiche richieste. Un incarico produce candidati; la delega è il legame tra quell'incarico, le decisioni applicabili e il mandato.

Fase del lavoro: il punto in cui si trova il lavoro di una richiesta, ricavato da Trama dai dati e mai dal modello: chiarimento, spec, fette, esecuzione, verifica, candidato, unito, oppure bloccata con il motivo. Il lavoro di una richiesta comprende i messaggi dello stesso dialogo dal chiarimento che l'ha aperto, o dall'inizio del dialogo, fino a quella richiesta. Finché le fette non hanno dati propri, la fase fette è il piano pronto da dividere in incarichi.

Prossimo passo: la sola mossa, tra quelle che la fase consente, con cui il Coordinatore chiude un turno sul lavoro, con una riga di motivo. La mossa spetta alla persona (rispondere alle domande, confermare la comprensione, concedere il mandato, confermare il team, rivedere il piano, verificare il candidato, unire la pull request) o al Coordinatore (preparare il piano, assegnare il lavoro, eseguire le verifiche). Trama rifiuta una mossa non consentita e mostra il passo come un pulsante a destra sotto l'ultima risposta, finché resta consentito. Dopo un saluto o una domanda informativa non c'è un prossimo passo.

Studio del progetto: la conoscenza che il Coordinatore ha del progetto attivo prima di dialogare: codice e moduli, documenti, issue e pull request, decisioni, mandato, incarichi e candidati, eventi del monitor e cronologia della chat. Lo studio avviene all'apertura del progetto e si aggiorna quando il progetto cambia.

Memoria del Coordinatore: le note che il Coordinatore conserva per un progetto oltre la durata della sua finestra di contesto. È distinta dallo studio, che Trama ricava dai dati, e dalla cronologia, che è la conversazione stessa. Ha due parti con un limite di caratteri: le note sul progetto (`MEMORY.md`) e il profilo della persona (`USER.md`), comune ai suoi progetti. Sono note del Coordinatore, non decisioni: non sostituiscono il Patto né il mandato (ADR 0014).

Skill appresa: una procedura che il Coordinatore ha ricavato dal lavoro di un progetto e carica quando serve. Resta nella cartella di Trama, nella libreria di quel progetto. È distinta dalle skill del repository, come quelle di AI Hero, e da una pratica, che è un metodo generale condiviso fra progetti solo con l'adozione della persona. Una skill creata dalla revisione dell'esperienza è curata dal manutentore; una skill nata in un turno con la persona resta sua, salvo che lei la affidi.

Revisione dell'esperienza: la sessione separata e non presidiata che, dopo abbastanza messaggi o azioni, rilegge la conversazione e aggiorna memoria e skill. Può solo aggiungere alla memoria: cambiare o togliere una voce diventa una proposta per la persona. Ogni revisione è registrata con motivo di avvio, esito, chiamate e token.

Manutenzione delle skill: il controllo settimanale che rende inattive e poi archivia le skill create dalla revisione e non usate. Non tocca le skill fissate né quelle della persona; un'archiviazione si annulla con un ripristino.

Scheda: un atto del metodo mostrato nella conversazione: studio, proposta di team, mandato, incarico, decisione, candidato, conflitto, avviso di contesto. Una scheda non è un log di strumenti né un messaggio libero.

Ispettore: la superficie che mostra il dettaglio di ciò che la persona tocca nella conversazione o nella sidebar: decisione, candidato, specialista, modulo, issue, gruppo. Non è una sezione da visitare a sé.

Progetto attivo: il progetto cui si riferisce il dialogo corrente con il Coordinatore. È distinto dai progetti che hanno lavoro in corso.

Obiettivo: un risultato di progetto con identità stabile, un titolo, il risultato atteso ed esempi verificabili, accettati (deve succedere) o rifiutati (non deve succedere). È distinto da un messaggio, da un incarico e da un candidato: incarichi, candidati e decisioni vi si collegano con identificativi espliciti, mai per deduzione. Lo stato è proposto, aperto, raggiunto o abbandonato; un obiettivo proposto dal Coordinatore resta tale finché la persona non lo conferma. Creare o confermare un obiettivo non concede un mandato e non avvia specialisti.

Obiettivo archiviato: un obiettivo che la persona ha tolto dagli obiettivi di lavoro, cioè dalla barra laterale e dalla panoramica. Archiviare non è uno stato: l'obiettivo conserva lo stato che aveva, gli esempi, le decisioni collegate e il dialogo, che resta consultabile. È distinto da abbandonato, che dice che il risultato non si persegue più; un obiettivo raggiunto si può archiviare e resta raggiunto. Il ripristino lo rimette tra gli obiettivi di lavoro com'era. Un obiettivo con lavoro in corso non si archivia.

Eliminazione: si elimina solo ciò che non ha storia. Un dialogo di obiettivo vuoto, senza messaggi, domande, decisioni, incarichi, candidati né schede in altri dialoghi oltre a quella con cui la persona l'ha creato, si elimina insieme al suo obiettivo; un dialogo con storia si archivia. Un messaggio in coda si elimina finché non è partito, salvo quando riferisce al Coordinatore una scelta già registrata, come una risposta, un ritiro o un mandato. Decisioni prese e cronologia non si eliminano.

Osservazione di un esempio: la persona segna un esempio dell'obiettivo come osservato o non osservato su un candidato preciso. Vale solo per quella versione del candidato e per quel testo dell'esempio; un'altra versione o un testo cambiato la rendono storica. Non è un'evidenza delle verifiche.

Dialogo del progetto: la conversazione con il Coordinatore dedicata a priorità e questioni che riguardano più obiettivi. Conserva anche la conversazione storica cui non è stato attribuito un obiettivo.

Dialogo di obiettivo: la conversazione con il Coordinatore dedicata a un singolo obiettivo, con bozza e selezione del composer proprie. Condivide con gli altri dialoghi l'autorità, il mandato, le decisioni e la memoria del progetto. Nell'app Electron il dialogo è una vista della cronologia del progetto: ogni messaggio porta l'obiettivo di origine, fissato all'invio, e gli eventi, le domande e gli incarichi nati da quel turno lo ereditano. La sessione tecnica del Coordinatore resta una per progetto: ogni turno di un dialogo di obiettivo riceve titolo, risultato atteso ed esempi dell'obiettivo. Così resta un solo Coordinatore responsabile e le decisioni comuni non vengono aggiornate da sessioni concorrenti (ADR 0013).

Mandato di progetto: l'autorizzazione persistente del Product Owner a perseguire obiettivi entro limiti definiti per un progetto. La delega di un singolo incarico deve rientrare nel mandato e nelle decisioni applicabili.

Panoramica globale: il riepilogo di avanzamento, blocchi e decisioni richieste dei progetti registrati. È distinta dalle conversazioni e dai contenuti privati dei singoli progetti. Ordina i progetti per attenzione: decisioni richieste, lavoro fermo o fallito, risultati da approvare, lavoro in corso. Distingue i dati aggiornati dei progetti in memoria dai dati dell'ultimo salvataggio e dagli stati non leggibili, e non apre sessioni AI per aggiornarsi.

Revisione tecnica: la valutazione di un candidato da parte di un revisore distinto dall'autore, riferita ai requisiti e alle verifiche di quel lavoro. Non è una decisione di prodotto né una revisione umana.

Via libera del Coordinatore: l'autorizzazione all'integrazione di un candidato verificato entro il mandato del Product Owner. È distinta dal via libera umano; i casi distruttivi seri richiedono l'intervento della persona.

Miglioramento del team: un cambiamento della composizione o del metodo di lavoro degli specialisti, motivato dai risultati osservati e verificabile rispetto al metodo precedente. Comprende ruoli, istruzioni, modelli disponibili e procedure; conserva le decisioni e i controlli del progetto.
