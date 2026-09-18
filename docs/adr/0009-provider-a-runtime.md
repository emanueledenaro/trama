# Trama sceglie e cambia provider senza mai farlo di nascosto

Stato: accettata il 18 settembre 2026 da Emanuele. Implementazione da fare nei ticket P02-P09 e V09.

L'ADR 0008 ha deciso quali provider Trama collega. Restava aperto come si sceglie un provider e cosa succede quando cambia o si blocca. Il 18 settembre 2026 Codex si è bloccato per il limite di utilizzo dell'account e l'intero incremento si è fermato per un giorno: la politica va scritta, non improvvisata al prossimo blocco.

Decisione: il cambio di provider è sempre una decisione della persona, mai di Trama.

- **Il thread del Coordinatore sopravvive al cambio.** Il nuovo provider apre una sessione nuova, perché la sessione di un provider non si trasferisce, e Trama gli passa trascrizione, memoria e studio. La conversazione non si perde.
- **Il provider di uno specialista è modificabile dalla persona in qualunque momento.** Incarico e worktree restano; riparte la sessione, non il lavoro.
- **Un provider bloccato non viene mai sostituito da solo.** Trama si ferma, dice il motivo con la data di sblocco quando esiste, e propone il cambio. Vale anche alla riapertura dell'app: si riprende con il provider dell'ultimo turno, e se non è disponibile ci si ferma.
- **Quando il provider si blocca, lo specialista si ferma e l'incarico resta in corso, in attesa.** Worktree e risultati restano intatti: chiudere l'incarico butterebbe via il contesto proprio quando serve riprenderlo.
- **L'avviso è una scheda nella conversazione più la striscia di stato**, con il motivo e l'azione proposta. Non un avviso di sistema e non solo la schermata dei collegamenti, che nessuno guarda mentre lavora.
- **L'incarico registra il provider all'assegnazione e ogni turno registra con quale provider è stato prodotto.** Se un incarico comincia su un provider e finisce su un altro, la cronologia deve dirlo, altrimenti le evidenze dichiarano un motore che non le ha prodotte.
- **Per uno specialista, collegato significa autenticato.** Uno stato sconosciuto non è una risposta: Trama fa il controllo di accesso prima di offrire il provider, non dopo. Un incarico assegnato a un provider che non può girare è lavoro sprecato.
- **Modello predefinito:** il Coordinatore parte dal predefinito del provider, gli specialisti dal più economico, ed entrambi sono modificabili e ricordati per provider. Il Coordinatore produce il ragionamento che regge il resto, e lì risparmiare è un falso risparmio.

Alternative scartate: il cambio automatico al primo provider disponibile, perché fa sembrare che il lavoro l'abbia fatto un provider quando l'ha fatto un altro e falsa la tracciabilità delle evidenze; il riavvio automatico più tardi, che è lo stesso cambio automatico mascherato da pazienza; la chiusura dell'incarico come interrotto, che butta via il contesto nel momento in cui serve; un thread nuovo del Coordinatore a ogni cambio di provider, che fa evitare i cambi proprio quando servono.

Conseguenze: il documento del progetto guadagna il provider per incarico e per turno, quindi cambia schema. La prova finale di V09 copre ogni provider autenticato su questa macchina, e i provider senza account restano fuori con il limite scritto invece di contare come caselle spuntate. I ticket P02-P09 devono prevedere il caso del provider bloccato come stato normale, non come errore.
