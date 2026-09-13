# Dipendenze selettive delle decisioni

Verifica del 13 settembre 2026 per i ticket #8 e #10.

## Problema

`saveDecision` impostava `Da rivalutare` su tutte le richieste, anche quando la decisione modificata non faceva parte del loro lavoro. Inoltre i piani registravano la versione di ogni decisione esistente, senza distinguere quelle necessarie.

## Correzione

Le nuove proposte contengono `requiredDecisionIDs`, validato rispetto agli identificativi esistenti. Il modello può indicare soltanto decisioni note e deve omettere quelle estranee. Trama registra le versioni di queste dipendenze e delle eventuali decisioni riviste dalle domande.

Quando la persona conferma il comportamento del piano, la decisione creata o aggiornata viene aggiunta alle dipendenze della richiesta. `DecisionImpact` confronta la nuova versione soltanto con le dipendenze registrate. Una decisione estranea lascia invariati stato e approvazione della richiesta.

I piani salvati prima del nuovo campo decodificano `requiredDecisionIDs` come elenco vuoto. Le richieste già esistenti conservano le versioni registrate in precedenza e rimangono quindi conservative.

## Prova nell’app

La build QA è stata avviata dopo aver terminato tutte le altre copie di Trama. Il progetto originale è stato ripristinato senza usare il recupero e senza modificare il file di stato fuori dall’app.

Nel progetto Negozio:

1. la spiegazione del modulo Catalog è stata rielaborata con la nuova versione e ha registrato dipendenze vuote;
2. la decisione `D-C7BA367F` è passata da v1 a v2, mantenendo la cronologia;
3. il piano Orders che dipendeva dalla decisione è diventato `Da rivalutare`;
4. la spiegazione Catalog è rimasta `Risposta disponibile`;
5. i lavori creati con la versione precedente, che registravano tutte le decisioni, sono rimasti conservativamente `Da rivalutare`.

## Test

I test coprono dipendenza modificata, decisione estranea, versione invariata, decisione di comportamento senza snapshot precedente, dipendenze note e rifiuto di un identificativo inventato. Un test di migrazione decodifica un piano persistito senza `requiredDecisionIDs`.

La prova non chiude gli altri criteri di #8 e #10, compresi il percorso completo delle alternative libere e il ricontrollo immediato di ogni operazione che usa una revisione.
