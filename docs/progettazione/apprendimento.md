# Apprendimento del Coordinatore

Stato: richiesta di prodotto approvata il 20 settembre 2026; porting in TypeScript fatto il 24 settembre 2026 secondo l'[ADR 0014](../adr/0014-apprendimento-del-coordinatore.md). La parità è verificata con test automatici sul comportamento; la prova con un provider reale resta da fare.

La persona chiede un sistema di apprendimento che riprenda la logica di un progetto esterno open source, usando il suo codice come riferimento e riusando le parti compatibili. Prima di portare codice occorre fissare revisione, percorsi, licenza e test pertinenti. Le dipendenze opzionali devono essere distinte dalle funzioni del sistema locale.

Il porting parte dalla versione del 24 settembre 2026, più recente di quella usata nella prima analisi. La licenza è MIT: attribuzione, copyright e avviso stanno in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Risultato richiesto

Il Coordinatore conserva conoscenze utili tra conversazioni, recupera esperienze precedenti e ricava procedure riutilizzabili dal lavoro. L'analisi deve coprire memoria della persona e del progetto, ricerca delle sessioni, creazione e aggiornamento delle skill, trigger della revisione dell'esperienza e limiti delle autovalutazioni. Il comportamento va ricavato dal sorgente: non si presume un miglioramento misurabile a ogni messaggio.

Dal 23 settembre 2026 Trama è un'app Electron (ADR 0011), quindi il porting è in TypeScript nel processo principale. Gli adattamenti rispetto al progetto di origine sono dichiarati nell'ADR 0014, con motivazione. Account esterni e servizi opzionali non diventano prerequisiti impliciti.

## Collegamento al lavoro esistente

C15 (#47) possiede il miglioramento delle pratiche e dei team. La memoria attuale del Coordinatore è testo di progetto sostituito tramite write_memory e reinserito all'apertura o ripresa: la sua presenza non dimostra il ciclo di apprendimento richiesto.

Il piano già approvato resta P02 con selettore coerente, UX00 con approvazione del layout, UX01-UX08 con i relativi prerequisiti, poi P03-P09. L'estensione sull'apprendimento richiede una mappa delle dipendenze verso C15 prima di assegnare l'implementazione; non è parte implicita della correzione del composer P02.

## Esecuzione

L'attribuzione dei file ripresi è in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). In breve: memoria `MEMORY.md` e `USER.md` con i limiti e i controlli originali; ricerca nei dialoghi con ranking BM25 riprodotto senza SQLite; skill con batch atomici e modifica fuzzy; revisione dell'esperienza separata con i prompt originali; manutenzione settimanale delle skill. La vista Memoria mostra e corregge tutto.

Dal 29 settembre 2026 una sezione piena al 90% offre Riordina: parte una revisione di quella sezione, con le sue note e la lingua della persona. La revisione gira come quelle automatiche: ciò che cambia o toglie diventa una proposta in Aspetta te, e le note restano come sono finché la persona non la applica. Una nota scritta in un'altra lingua rispetto a quella della persona porta la scritta «In inglese» o «In italiano» e non viene toccata.

## Mappa iniziale del sorgente

Analisi delegata a gpt-5.6-luna con ragionamento medium, sulla versione fissata. L'analisi è statica e non costituisce una prova di esecuzione. Comportamenti da portare e verificare:

- ciclo di vita della memoria: inizializzazione, recupero anticipato, sincronizzazione del turno, fine sessione, cambio sessione e compattazione;
- coordinamento del provider locale e di un eventuale provider esterno: recupero limitato nel tempo, cache, sincronizzazione serializzata in background;
- apprendimento da fonti o procedure correnti, controllo delle skill esistenti e scrittura tramite skill_manage;
- vista delle conoscenze derivate da skill e sezioni di MEMORY.md/USER.md. I collegamenti lessicali non dimostrano rapporti causali;
- modifica delle conoscenze e archiviazione recuperabile delle skill, protezione delle skill fissate e invalidazione della cache;
- manutenzione periodica a sistema inattivo: inizializzazione differita, gestione delle skill obsolete e protezioni per quelle fissate o usate da cron;
- consolidamento LLM opzionale, disattivato per impostazione predefinita, con istantanea precedente e rapporto;
- modellazione della persona e rappresentazione dell'agente tramite Honcho, integrazione opzionale con dipendenza propria.

Il progetto di origine non esegue necessariamente una costosa revisione LLM a ogni messaggio: distingue sincronizzazione dei turni, recupero anticipato, estrazione ai confini della sessione e manutenzione periodica. Le impostazioni e i trigger devono essere preservati o documentati come differenze.

Il porting riusa i confini di memoria e strumenti di Trama: gli strumenti passano dal server MCP del Coordinatore e i dati stanno nella cartella di Trama. Nessun runtime Python o servizio Honcho è stato aggiunto. Riprodurre localmente una funzione di Honcho non autorizza a dichiararla equivalente senza prove.

Deposito della memoria, ricerca storica, skill, manutenzione e test originali sono stati letti per intero sulla versione fissata. I casi limite asseriti da quei test sono ripresi nei test di `app/src/main/core/learning`.

L'implementatore richiesto è gpt-5.6-luna con ragionamento medium. Il Coordinatore verifica aderenza al ticket, diff, regressioni e risultati osservabili e richiede correzioni quando necessario. L'analisi del sorgente precede la suddivisione del porting in incarichi verificabili.

Ogni capacità portata deve dichiarare fonte e revisione, comportamento equivalente, differenze, test e prova nel runtime di Trama. Le pratiche apprese conservano provenienza e storia; i confini di progetto e mandato già stabiliti restano applicabili.
