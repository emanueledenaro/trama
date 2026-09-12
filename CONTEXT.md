# Dominio di Trama

Trama è un'app macOS per esplorare un repository e collegare una richiesta ai moduli, alle decisioni e alle verifiche che la riguardano.

Un progetto è una cartella locale. Un modulo raggruppa file rilevati in una directory; il raggruppamento non prova una responsabilità architetturale. Una richiesta conserva il modulo selezionato. Un piano descrive modifiche proposte e resta distinguibile dal codice esistente.

Una decisione registra un comportamento, un esempio e una motivazione. Ogni modifica della decisione incrementa la sua versione. Una delega collega il lavoro alle versioni delle decisioni e al perimetro ammesso. Un candidato identifica la versione concreta del lavoro. Un'evidenza appartiene a un candidato e a una specifica versione delle verifiche. Una revisione umana riguarda esattamente quel candidato; nuove evidenze o decisioni pertinenti invalidano il via libera.

Il Patto Vivo è questo legame operativo tra decisioni, deleghe e verifiche. Non è una sandbox. I risultati del progetto di esempio verificano esclusivamente i suoi casi locali.
