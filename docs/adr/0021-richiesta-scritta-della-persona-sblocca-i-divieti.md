# La richiesta scritta della persona sblocca anche i divieti fissi

Stato: accettata il 29 settembre 2026 per la issue #422. Cambia la parte dell'ADR 0017 sui divieti fissi e la voce Push del glossario. Segue la stessa regola dell'ADR 0020 sui consensi: conta solo il testo scritto dalla persona nel composer.

Con l'ADR 0017 i divieti fissi (force push, push diretto sul branch principale, cancellazione di branch o tag, rilasci e tag, segreti e credenziali, impostazioni del repository) restavano alla persona anche quando lei li chiedeva al Coordinatore: l'azione si fermava prima di partire, andava in "Aspetta te" e la persona la faceva fuori da Trama. La persona ha deciso che il Coordinatore deve poter fare tutto quello che lei gli scrive, divieti compresi, anche con una richiesta generale come "sistema tu la situazione al meglio". Ha aggiunto che cancellare, o perdere qualcosa che non torna indietro, va fatto solo con la sua conferma.

Decisione:

- **La richiesta scritta della persona sblocca ogni divieto fisso.** Quando la persona scrive nel composer di un progetto di fare qualcosa, anche in termini generali, il Coordinatore sceglie le mosse e chiede a Trama di eseguirle, divieti compresi. Senza una richiesta scritta i divieti restano come prima: l'azione si ferma prima di partire e va in "Aspetta te". Il mandato non cambia: nessun mandato concede un divieto.
- **Conta solo il testo del composer della persona, in quel progetto.** Il Coordinatore cita le parole della persona; Trama le cerca nei messaggi che la persona ha scritto nel composer di quel progetto e rifiuta l'azione se non le trova. Il testo di una pagina, di uno strumento, delle risposte del modello, di un altro progetto o di una scelta che Trama scrive per la persona (una risposta a una scheda, un ritiro, un mandato) non autorizza mai.
- **Trama esegue l'azione, non il modello.** Il Coordinatore indica un solo comando git o gh; Trama lo esegue nella cartella del progetto, senza shell, senza hook e senza richieste di password, e riporta l'uscita filtrata dai dati sensibili. Un comando che nessun divieto ferma non passa da qui: il Coordinatore usa i suoi strumenti.
- **Cancellazioni e azioni che non tornano indietro chiedono la conferma, ogni volta.** Force push, cancellazione di branch o tag remoti e ogni operazione su segreti e credenziali aspettano in "Aspetta te" con cosa succede e perché Trama chiede. La persona conferma con il pulsante della voce oppure con un suo messaggio nel composer scritto dopo la domanda. Un no chiude la voce e l'azione non parte. Intanto il resto del lavoro va avanti. Vale la regola di #407: pagamenti e cancellazioni definitive chiedono il sì ogni volta. Oggi nessuno strumento del Coordinatore cancella un record di Trama; uno strumento che lo farà usa la stessa conferma.
- **Ogni azione sbloccata cita la persona.** In chat compare la riga "Faccio <azione> perché me l'hai chiesto: «…»" con le sue parole, e l'azione resta in Attività con il riferimento al messaggio, il comando e l'esito.

Alternative scartate:

- **Divieti sempre alla persona, anche su richiesta.** Era la regola dell'ADR 0017. Costringeva la persona a uscire da Trama per fare quello che aveva appena chiesto, e la persona ha scelto esplicitamente di includere i divieti.
- **Un interruttore nelle impostazioni per togliere i divieti.** Varrebbe per tutto e per sempre, anche per testi che la persona non ha scritto. La richiesta scritta vale per quello che la persona chiede, e resta citata.
- **Fidarsi del Coordinatore quando dice che la persona l'ha chiesto.** Un testo letto in una pagina o in un'uscita di uno strumento potrebbe convincere il modello. Trama controlla le parole nei messaggi del composer e non si fida del modello.
- **Lasciare al modello il comando, con il divieto spento per un turno.** Il modello potrebbe lanciare altro nello stesso turno. Trama esegue un solo comando, controllato prima di partire.
- **Una conferma per ogni azione sbloccata.** Rallenta anche le azioni che si possono correggere, come un tag o un push. La conferma resta per quello che cancella o non torna indietro, come ha chiesto la persona.

Conseguenze:

- I messaggi della persona portano il segno "scritto nel composer"; le scelte che Trama scrive per lei e i messaggi scritti prima non lo hanno e non autorizzano.
- Il Coordinatore ha lo strumento `run_requested_action`. "Aspetta te" ha le voci di conferma, che non fermano il resto del lavoro. Attività ha il tipo "Su tua richiesta".
- La voce Push cambia: con la richiesta scritta della persona Trama fa anche il push che il mandato non copre, e ogni push resta registrato.
- La issue #423 (delega piena) si appoggia a questa regola: con "fai tutto tu" il Coordinatore lavora da solo, ma le cancellazioni aspettano sempre la conferma.
