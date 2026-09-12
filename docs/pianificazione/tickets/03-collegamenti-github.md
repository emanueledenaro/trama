# T03: Riconoscere GitHub e verificare le operazioni disponibili

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Vedere GitHub tra i collegamenti consigliati, riutilizzare quello esposto da Codex e scegliere un repository accessibile.

## Dipendenze

[T02](./02-collegare-codex.md)

## Criteri di accettazione

- [ ] Scoprire collegamenti installati, accessibili, abilitati e utilizzabili; non dedurre questi stati dal login di gh o da un remote Git.
- [ ] Aprire il collegamento ufficiale restituito dal componente, poi rileggere lo stato al ritorno dal browser; cancellazione e riconnessione restano recuperabili.
- [ ] Verificare su un repository di prova lettura di branch, commit, diff, PR, review, issue e check; documentare per ogni operazione quale interfaccia la espone.
- [ ] Se il collegamento non espone i dati strutturati necessari al monitoraggio, completare un adapter GitHub autorizzato oppure dichiarare quella capacità non disponibile. Il solo login non chiude il ticket.
- [ ] Repository privato non accessibile, SSO richiesto, API limitata e connessione revocata non vengono interpretati come repository eliminato.
- [ ] I servizi aggiuntivi vengono consigliati solo quando pertinenti al progetto e con il beneficio spiegato.

## Prova di completamento

Dal primo avvio collegare o riconoscere GitHub e leggere una PR reale con il relativo diff.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
