# Dominio di Trama

Trama è un'app macOS per esplorare un repository e collegare una richiesta ai moduli, alle decisioni e alle verifiche che la riguardano.

Un progetto è una cartella locale. Un modulo raggruppa file rilevati in una directory; il raggruppamento non prova una responsabilità architetturale. Una richiesta conserva il modulo selezionato. Un piano descrive modifiche proposte e resta distinguibile dal codice esistente.

Una decisione registra un comportamento, un esempio e una motivazione. Ogni modifica della decisione incrementa la sua versione. Una delega collega il lavoro alle versioni delle decisioni e al perimetro ammesso. Un candidato identifica la versione concreta del lavoro. Un'evidenza appartiene a un candidato e a una specifica versione delle verifiche. Una revisione umana riguarda esattamente quel candidato; nuove evidenze o decisioni pertinenti invalidano il via libera.

Il Patto Vivo è questo legame operativo tra decisioni, deleghe e verifiche. Non è una sandbox. I risultati del progetto di esempio verificano esclusivamente i suoi casi locali.

## Ruoli e coordinamento

Product Owner: la persona che decide obiettivi, priorità, comportamenti del prodotto e compromessi. La responsabilità di queste decisioni resta umana.

Coordinatore generale: l'interlocutore principale della persona per tutti i progetti registrati in Trama. Riunisce lavoro e risultati dei team, mantenendo distinti progetti e decisioni.

Team di progetto: l'insieme degli specialisti appartenenti a un singolo progetto. La composizione dipende dalle necessità del progetto e può cambiare nel tempo.

Specialista: un agente con una competenza e un incarico motivato all'interno di un team di progetto. Il ruolo è distinto dal modello AI usato per svolgerlo e non conferisce autorità sulle decisioni del Product Owner.

Progetto attivo: il progetto cui si riferisce il dialogo corrente con il Coordinatore. È distinto dai progetti che hanno lavoro in corso.

Mandato di progetto: l'autorizzazione persistente del Product Owner a perseguire obiettivi entro limiti definiti per un progetto. La delega di un singolo incarico deve rientrare nel mandato e nelle decisioni applicabili.

Panoramica globale: il riepilogo di avanzamento, blocchi e decisioni richieste dei progetti registrati. È distinta dalle conversazioni e dai contenuti privati dei singoli progetti.

Revisione tecnica: la valutazione di un candidato da parte di un revisore distinto dall'autore, riferita ai requisiti e alle verifiche di quel lavoro. Non è una decisione di prodotto né una revisione umana.

Via libera del Coordinatore: l'autorizzazione all'integrazione di un candidato verificato entro il mandato del Product Owner. È distinta dal via libera umano; i casi distruttivi seri richiedono l'intervento della persona.

Miglioramento del team: un cambiamento della composizione o del metodo di lavoro degli specialisti, motivato dai risultati osservati e verificabile rispetto al metodo precedente. Comprende ruoli, istruzioni, modelli disponibili e procedure; conserva le decisioni e i controlli del progetto.
