# T04: Preparare automaticamente il metodo AI Hero

Stato: pianificato, bozza per GitHub Issues.

Specifica: [Piano operativo](../../piano-operativo.md).

## Comportamento da costruire

Aprire un progetto e trovare il metodo di lavoro pronto, senza dover invocare comandi di setup delle skill.

## Dipendenze

[T01](./01-avvio-nativo.md), [T02](./02-collegare-codex.md)

## Criteri di accettazione

- [ ] Usare un insieme versionato delle skill Matt Pocock, con provenienza, licenza MIT, attribuzione e versione consultabili.
- [ ] Rilevare repository, tracker, etichette e documentazione esistenti; configurare solo ciò che manca con impostazioni di Trama dichiarate e reversibili.
- [ ] Il secondo avvio non duplica file o sezioni. Personalizzazioni preesistenti sono preservate; ogni aggiunta gestita è riconoscibile nel diff.
- [ ] Una configurazione incompatibile richiede una decisione mirata. Non sovrascrivere regole per riuscire a mostrare setup completato.
- [ ] Distinguere mappatura delle etichette dalla loro esistenza remota; creare etichette solo nel perimetro autorizzato del progetto.
- [ ] Con pacchetto locale disponibile il setup funziona offline; aggiornamento fallito conserva la versione funzionante e permette rollback.
- [ ] Confermare con il catalogo skill di Codex che le skill richieste siano caricate. Il setup automatico non esegue tutte le skill.

- [ ] Il setup locale si completa con GitHub non collegato; le sole operazioni remote restano in attesa senza segnare fallito il setup locale.

## Prova di completamento

Aprire due volte un repository con istruzioni personalizzate e mostrare un setup riuscito senza duplicazioni né perdita delle personalizzazioni.

## Regola di chiusura

La chiusura richiede evidenze sui comportamenti indicati e revisione indipendente di specifica e convenzioni. Riportare controlli non eseguiti e limiti. Un test simulato non sostituisce la prova reale del collegamento o del sistema operativo.
