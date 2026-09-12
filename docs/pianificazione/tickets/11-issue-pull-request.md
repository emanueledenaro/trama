# T11: Collegare una issue al lavoro e pubblicare una PR revisionata

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Aprire una GitHub Issue dentro Trama, pianificarla nel suo contesto e arrivare a una pull request dopo la revisione.

## Dipendenze

[T03](./03-collegamenti-github.md), [T09](./09-verifiche-revisione.md)

## Criteri di accettazione

- [ ] Titolo, descrizione, stato e discussione provengono da GitHub; modulo, decisioni e sessioni sono collegamenti di Trama.
- [ ] L’utente vede destinatario, branch, diff e testo della PR prima della pubblicazione.
- [ ] Login del connettore e permesso di push Git sono verificati separatamente; mancanza di uno non viene mascherata dall’altro.
- [ ] Retry dopo timeout riconcilia l’eventuale PR già creata, senza duplicarla.
- [ ] Fine dell’agente non chiude l’issue; pubblicazione, CI remota, merge e chiusura restano stati distinti.
- [ ] Una modifica tra revisione e pubblicazione richiede nuova verifica del candidato.

## Prova di completamento

Seguire una issue di prova fino a una PR autentica sul repository di prova senza merge automatico.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
