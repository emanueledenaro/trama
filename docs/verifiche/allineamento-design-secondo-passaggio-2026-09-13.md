# Secondo passaggio di allineamento visivo

Incremento del ticket #22, basato su `main` al commit `ad38e76`. Il ticket resta aperto.

## Percorso osservato prima delle correzioni

La build integrata è stata aperta sul progetto di esempio. Le schermate sono state osservate nella stessa sessione, prima in una finestra ristretta e poi in una finestra ampia. I riferimenti a 720×640 indicano il minimo dichiarato dall'app e il ridimensionamento manuale: non sostituiscono una misura indipendente di ciascuna area di contenuto.

1. Issue, finestra stretta: lista e dettaglio erano leggibili; intestazione e azioni seguivano la guida sinistra.
2. Mappa, finestra stretta: la testata compatta si centrava mentre ricerca e contenuto partivano da sinistra. Il modulo Root mostrava il solo carattere `.`.
3. Modifiche, finestra stretta: richiesta, stato e risposta avevano una gerarchia chiara; il testo di supporto del compositore era piccolo.
4. Patto Vivo, finestra stretta: i valori di Esempio e Motivo risultavano centrati e difficili da seguire su più righe.
5. Gruppo, finestra stretta: lo stato vuoto era una riga isolata. Modello, account e limite del lavoro osservabile erano compressi in fondo alla pagina.
6. Impostazioni, tema scuro: le spiegazioni lunghe usavano `caption` e apparivano dense.
7. Impostazioni, tema chiaro: le stesse spiegazioni erano troppo piccole e poco evidenti rispetto alle etichette dei controlli.
8. Gruppo, tema chiaro: il limite relativo al lavoro non pubblicato era presente ma poco leggibile.
9. Gruppo, finestra ampia: lo stato vuoto lasciava una grande area senza una spiegazione visiva riconoscibile.
10. Mappa, finestra ampia: gerarchia e colonne erano coerenti; il percorso `.` del modulo Root restava ambiguo.
11. Patto Vivo, finestra ampia: le righe Esempio e Motivo funzionavano meglio, ma cambiavano struttura rispetto alla finestra stretta.
12. Modifiche, finestra ampia: lista e dettaglio erano equilibrati e non richiedevano una nuova composizione.
13. Issue, finestra ampia: Markdown, lista e azioni restavano leggibili con contenuto reale di GitHub.

Le immagini sono state catturate e ispezionate durante l’audit nel client Codex. Non sono state esportate nel repository, quindi non valgono ancora come raccolta permanente prima e dopo richiesta dal ticket.

## Modifiche

- `TramaScreenHeader` e `TramaAdaptiveActions` occupano tutta la guida disponibile e mantengono l’allineamento a sinistra anche quando cambiano disposizione.
- `TramaRadius` definisce 8 punti per controlli e riquadri tecnici e 12 punti per le schede.
- Le spiegazioni persistenti usano `TramaSupportingText` con stile `callout`; `caption` resta per ora, versione, modello e SHA.
- Le decisioni mostrano Esempio e Motivo come blocchi verticali con etichetta e valore, in entrambe le dimensioni.
- Gli stati vuoti di Gruppo hanno simbolo, titolo e spiegazione specifici per pull request, branch, novità, impatto e conflitti.
- Il riepilogo dell’analisi del gruppo è raccolto in un contenitore distinto con modello, account GitHub e limite del lavoro osservabile.
- Il modulo Root mostra `Radice del progetto`.
- La barra inferiore della Mappa e il compositore proteggono i metadati dalla troncatura quando la finestra si restringe.
- Le misure isolate usate come spaziatura nelle viste sono state sostituite con la scala documentata. Le dimensioni della mappa, dei diff e delle finestre restano misure funzionali distinte.
- Impostazioni usa una dimensione adattabile e il titolo italiano `Impostazioni di Trama`.
- I campi di Decisione, risposta personale, Nuovo progetto, Nuova issue, pubblicazione PR, chiarimento e confronto branch mantengono un’etichetta visibile anche quando contengono un valore.
- Lo stato del monitor usa verde quando è attivo, arancione quando richiede autorizzazione e il colore secondario quando è fermo, sempre insieme a simbolo e testo.
- Le schede Gruppo sono rappresentate da un enum esaustivo. La stessa diramazione decide contenuto e stato vuoto, evitando rinomine parziali basate su stringhe.
- Le righe Issue mostrano stato GitHub, numero, autore e un riepilogo delle etichette. Il dettaglio ripete stato e autore e dispone le etichette in verticale con testo multilinea; l’assenza viene indicata come `Nessuna etichetta`.

## Verifica dopo le correzioni

La Mappa è stata controllata in finestra ampia e a 720×640. Titolo, sottotitolo e selettore ora partono dalla stessa guida della ricerca. Root è comprensibile senza conoscere la convenzione Git.

Patto Vivo è stato controllato a 720×640 con una decisione reale in versione 2. Esempio e Motivo sono allineati a sinistra, mantengono la dimensione del corpo e vengono esposti come elementi combinati nell’albero di accessibilità.

Gruppo è stato ricaricato dal repository pubblico `emanueledenaro/trama`. Lo stato senza pull request mostra un simbolo, un titolo e il rimando ai branch. Il riepilogo distingue azione Codex, modello, account GitHub e limite del lavoro osservabile. Una prima variante ha spinto il riepilogo fuori dalla finestra; è stata rifiutata e sostituita prima della verifica finale.

Impostazioni è stato osservato in tema scuro e chiaro con lo stesso contenuto. Le spiegazioni su aspetto, monitor, suoni e salvataggio locale usano ora `callout`; il monitor mostra anche un simbolo insieme allo stato. Al termine è stato ripristinato il tema Sistema.

In Impostazioni di Sistema, Accessibilità, Schermo, `Aumenta contrasto` e `Riduci la trasparenza` erano inizialmente disattivati. È stato attivato temporaneamente Aumenta contrasto, che su questa versione di macOS abilita anche Riduci la trasparenza. Trama ha mantenuto testi, selezione, contorni dei controlli, schede della Mappa e stato vuoto del gruppo leggibili. I materiali sono diventati opachi e i bordi più netti. Al termine entrambe le preferenze sono state riportate su disattivato e il loro stato è stato riletto nell’interfaccia di sistema.

Durante la prova di Trama sul proprio repository, una richiesta reale ha evidenziato che nella sezione Issue mancavano stato GitHub ed etichette. Codex ha prodotto un piano, ma non è stata avviata alcuna modifica dall’app. Il rilievo è stato incorporato in questo incremento e va verificato nella build aggiornata con ticket aperti, chiusi, con più etichette e senza etichette.

La build aggiornata è stata poi aperta sul repository Trama. In finestra ampia e stretta, le righe hanno mostrato `Aperta`, numero, autore e le etichette reali `documentation`, `ready-for-agent`, `accessibility` ed `enhancement`. Il dettaglio della specifica #1 ha ripetuto lo stato e mostrato `documentation` sotto l’intestazione Etichette. L’albero di accessibilità espone `Stato: Aperta` e `Etichetta: documentation`. Il repository non contieneva un ticket chiuso o senza etichette adatto alla prova, quindi questi due stati restano non verificati nell’app reale.

## Controllo finale dopo l'aggiornamento della roadmap

Sulla base `fc1af56`, con le modifiche UI ancora isolate nel branch di sviluppo, è stata rieseguita la suite completa: 80 test XCTest e 86 Swift Testing, tutti superati. Questa prova locale riguarda anche le modifiche UI non ancora integrate, mentre la CI della PR documentale #49 riguardava solo il codice precedentemente pubblicato.

La build locale è stata riavviata dopo aver verificato che non vi fossero attività Codex in corso. Ha mostrato la specifica #1 aggiornata e i nuovi ticket #33-#48 con stato ed etichette reali. Il compositore compilato ha mantenuto visibile `Richiesta a Codex` ed esposto il nome accessibile `Richiesta a Codex per il modulo selezionato`. La bozza è stata poi svuotata senza inviarla.

Nella finestra Nuova issue, Titolo e Descrizione sono rimasti visibili e presenti nei nomi accessibili con entrambi i campi compilati. Annulla e Pubblica sono rimasti visibili; Esc ha annullato la bozza. Nessuna issue è stata pubblicata durante la prova UI.

La sezione Gruppo è stata ricontrollata nella stessa build: Repository GitHub ha un'etichetta permanente e accessibile, lo stato vuoto è distinto dal riepilogo dell'analisi e le due frasi sul lavoro osservabile restano leggibili. Azione Codex, modello, account e compositore sono visibili. Il riesame mirato Standards e Spec non ha rilevato problemi residui nel diff; le verifiche globali del ticket restano aperte.

## Limiti

Le immagini e l'albero di accessibilità non provano il percorso completo con VoiceOver o Accesso completo da tastiera. Non sono state ricontrollate tutte le finestre modali dopo questo incremento e manca una raccolta esportata con immagini prima e dopo. Restano la prova di tag GitHub particolarmente lunghi, issue chiuse o senza etichette e la verifica sistematica di tutti gli stati disabilitati. Questi punti impediscono la chiusura di #22.
