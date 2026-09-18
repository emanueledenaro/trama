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

Team di progetto: l'insieme degli specialisti appartenenti a un singolo progetto. La composizione dipende dalle necessità del progetto e può cambiare nel tempo.

Specialista: un agente con una competenza e un incarico motivato all'interno di un team di progetto. Il ruolo è distinto dal modello AI usato per svolgerlo e non conferisce autorità sulle decisioni del Product Owner.

Provider: il programma esterno con cui Trama parla per far lavorare un agente, per esempio Codex o Claude Agent. È distinto dal modello, che è una scelta interna al provider, e dal ruolo dello specialista, che non dipende da nessuno dei due. Un provider è collegato quando la persona ha reso disponibile il suo account.

Incarico: un lavoro assegnato dal Coordinatore a uno specialista, con obiettivo, perimetro, dipendenze e verifiche richieste. Un incarico produce candidati; la delega è il legame tra quell'incarico, le decisioni applicabili e il mandato.

Studio del progetto: la conoscenza che il Coordinatore ha del progetto attivo prima di dialogare: codice e moduli, documenti, issue e pull request, decisioni, mandato, incarichi e candidati, eventi del monitor e cronologia della chat. Lo studio avviene all'apertura del progetto e si aggiorna quando il progetto cambia.

Memoria del Coordinatore: le note che il Coordinatore conserva per un progetto oltre la durata della sua finestra di contesto. È distinta dallo studio, che Trama ricava dai dati, e dalla cronologia, che è la conversazione stessa.

Scheda: un atto del metodo mostrato nella conversazione: studio, proposta di team, mandato, incarico, decisione, candidato, conflitto, avviso di contesto. Una scheda non è un log di strumenti né un messaggio libero.

Ispettore: la superficie che mostra il dettaglio di ciò che la persona tocca nella conversazione o nella sidebar: decisione, candidato, specialista, modulo, issue, gruppo. Non è una sezione da visitare a sé.

Progetto attivo: il progetto cui si riferisce il dialogo corrente con il Coordinatore. È distinto dai progetti che hanno lavoro in corso.

Mandato di progetto: l'autorizzazione persistente del Product Owner a perseguire obiettivi entro limiti definiti per un progetto. La delega di un singolo incarico deve rientrare nel mandato e nelle decisioni applicabili.

Panoramica globale: il riepilogo di avanzamento, blocchi e decisioni richieste dei progetti registrati. È distinta dalle conversazioni e dai contenuti privati dei singoli progetti.

Revisione tecnica: la valutazione di un candidato da parte di un revisore distinto dall'autore, riferita ai requisiti e alle verifiche di quel lavoro. Non è una decisione di prodotto né una revisione umana.

Via libera del Coordinatore: l'autorizzazione all'integrazione di un candidato verificato entro il mandato del Product Owner. È distinta dal via libera umano; i casi distruttivi seri richiedono l'intervento della persona.

Miglioramento del team: un cambiamento della composizione o del metodo di lavoro degli specialisti, motivato dai risultati osservati e verificabile rispetto al metodo precedente. Comprende ruoli, istruzioni, modelli disponibili e procedure; conserva le decisioni e i controlli del progetto.
