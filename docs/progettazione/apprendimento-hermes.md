# Apprendimento di Trama dal sistema Hermes

Stato: richiesta di prodotto approvata nella conversazione del 20 settembre 2026; analisi del sorgente in corso. Nessuna parità funzionale ancora dimostrata.

La persona chiede il sistema di apprendimento di Hermes Agent, usando il codice ufficiale come riferimento e riusando le parti compatibili. Il riferimento è https://github.com/NousResearch/hermes-agent. Prima di portare codice occorre fissare revisione, percorsi, licenza e test pertinenti. Le dipendenze opzionali devono essere distinte dalle funzioni del sistema locale.

Revisione rilevata tramite API GitHub: `c1488ac947c9bc33fd65ec464548dc9d8edd6122`. La [licenza della revisione](https://github.com/NousResearch/hermes-agent/blob/c1488ac947c9bc33fd65ec464548dc9d8edd6122/LICENSE) è MIT, copyright 2025 Nous Research. Il porting deve conservare copyright e avviso di licenza nelle copie o porzioni sostanziali derivate. In questa fase non è stato incorporato codice Hermes.

## Risultato richiesto

Il Coordinatore conserva conoscenze utili tra conversazioni, recupera esperienze precedenti e ricava procedure riutilizzabili dal lavoro. L'analisi deve coprire memoria della persona e del progetto, ricerca delle sessioni, creazione e aggiornamento delle skill, trigger della revisione dell'esperienza e limiti delle autovalutazioni. Il comportamento va ricavato dal sorgente: non si presume un miglioramento misurabile a ogni messaggio.

Trama resta un'app nativa Swift. Eventuali adattamenti rispetto a Hermes devono essere dichiarati, con motivazione e prove. Account esterni e servizi opzionali non diventano prerequisiti impliciti.

## Collegamento al lavoro esistente

C15 (#47) possiede il miglioramento delle pratiche e dei team. La memoria attuale del Coordinatore è testo di progetto sostituito tramite write_memory e reinserito all'apertura o ripresa: la sua presenza non dimostra il ciclo di apprendimento richiesto.

Il piano già approvato resta P02 con selettore coerente, UX00 con approvazione del layout, UX01-UX08 con i relativi prerequisiti, poi P03-P09. L'estensione Hermes richiede una mappa delle dipendenze verso C15 prima di assegnare l'implementazione; non è parte implicita della correzione del composer P02.

## Esecuzione

## Mappa iniziale del sorgente

Analisi delegata a gpt-5.6-luna con ragionamento medium, sulla revisione fissata. I percorsi seguenti sono relativi al repository ufficiale Hermes; l'analisi è statica e non costituisce una prova di esecuzione.

| Sorgente | Comportamento da portare e verificare |
| --- | --- |
| `agent/memory_provider.py:75` | Ciclo di vita della memoria: inizializzazione, recupero anticipato, sincronizzazione del turno, fine sessione, cambio sessione e compattazione. |
| `agent/memory_manager.py:283` | Coordinamento del provider locale e di un eventuale provider esterno; recupero limitato nel tempo, cache, sincronizzazione serializzata in background. |
| `agent/learn_prompt.py:136` | Apprendimento da fonti o procedure correnti, controllo delle skill esistenti e scrittura tramite skill_manage. |
| `agent/learning_graph.py:169` | Vista delle conoscenze derivate da skill e sezioni di MEMORY.md/USER.md. I collegamenti lessicali non dimostrano rapporti causali. |
| `agent/learning_mutations.py:1` | Modifica delle conoscenze e archiviazione recuperabile delle skill, protezione delle skill fissate e invalidazione della cache. |
| `agent/curator.py:188` | Manutenzione periodica a sistema inattivo; inizializzazione differita, gestione delle skill obsolete e protezioni per quelle fissate o usate da cron. |
| `agent/curator.py:895` | Consolidamento LLM opzionale, disattivato per impostazione predefinita, con istantanea precedente e rapporto. |
| `optional-skills/autonomous-ai-agents/honcho/SKILL.md:17` | Modellazione della persona e rappresentazione dell'agente tramite Honcho, integrazione opzionale con dipendenza propria. |

Hermes non esegue necessariamente una costosa revisione LLM a ogni messaggio: distingue sincronizzazione dei turni, recupero anticipato, estrazione ai confini della sessione e manutenzione periodica. Le impostazioni e i trigger devono essere preservati o documentati come differenze.

Il porting Swift deve riusare i confini di memoria e strumenti di Trama. La scelta della persistenza e i test di equivalenza restano da definire sul diff implementativo. Nessun runtime Python o servizio Honcho è stato aggiunto. Riprodurre localmente una funzione di Honcho non autorizza a dichiararla equivalente senza prove.

Restano da ispezionare in dettaglio il deposito della memoria integrata, la ricerca storica e i test upstream; la tabella non è ancora una specifica completa di parità.

L'implementatore richiesto è gpt-5.6-luna con ragionamento medium. Il Coordinatore verifica aderenza al ticket, diff, regressioni e risultati osservabili e richiede correzioni quando necessario. L'analisi del sorgente precede la suddivisione del porting in incarichi verificabili.

Ogni capacità portata deve dichiarare fonte e revisione, comportamento equivalente, differenze, test e prova nel runtime di Trama. Le pratiche apprese conservano provenienza e storia; i confini di progetto e mandato già stabiliti restano applicabili.
