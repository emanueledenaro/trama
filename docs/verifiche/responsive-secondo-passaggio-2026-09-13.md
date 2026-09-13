# Secondo passaggio responsive

Incremento del ticket #21, basato su `main` al commit `2ccda15`. Il ticket resta aperto.

## Problemi corretti

Le intestazioni potevano comprimere titolo e sottotitolo quando un’azione lunga occupava la stessa riga. Ora usano la disposizione orizzontale finché c’è spazio e spostano le azioni sotto il testo nella finestra stretta.

Lo stesso criterio si applica al contesto della richiesta, al collegamento GitHub, alle azioni delle pull request e ai comandi della revisione. L’autorizzazione richiesta da Codex non impone più una larghezza di 620 punti al contenuto centrale. La ricerca della mappa mantiene sempre visibile il numero di file senza sottrarre spazio al campo.

Le finestre Collegamenti, Nuova issue e Pubblica una pull request tengono intestazione e azioni fuori dalle aree scorrevoli. Gli editor e il diff gestiscono direttamente il proprio contenuto; non sono annidati in un secondo scorrimento verticale. Errori lunghi hanno un riquadro limitato e selezionabile. Fine, Annulla e Pubblica restano fermi. Il diff della pubblicazione usa lo stesso visualizzatore nativo già adottato dalla revisione.

## Prova diretta nell’app

La build `build/Trama.app` è stata ricreata e aperta sul progetto di esempio. Le prove hanno usato gli stessi dati e la stessa selezione del modulo Catalog.

| Dimensione | Sezioni percorse | Esito osservato |
| --- | --- | --- |
| 720×640 | Modifiche, Mappa, Gruppo, Issue, Collegamenti | La sidebar si chiude automaticamente e può essere riaperta. Elenco e dettaglio delle modifiche sono sovrapposti. La mappa passa a una colonna. Titoli, selettori, campo della richiesta e azioni restano raggiungibili. |
| 1040×700 | Issue, Mappa | La sidebar torna affiancata. Il dettaglio del modulo resta chiuso e il comando nella toolbar è disponibile. |
| 1280×800 | Mappa e inspector | L’inspector si apre a destra. La mappa riduce il numero di colonne senza sovrapporre le schede. Catalog resta selezionato. |
| 1040×700 dopo 1280×800 | Mappa e inspector compatto | Riducendo la finestra, l’inspector laterale si chiude. Il comando Dettagli lo riapre come pannello e conserva Catalog, scheda e azioni. |
| Schermo intero sul monitor disponibile | Mappa | La mappa amplia le colonne, resta verticale e conserva ricerca, selezione e compositore. |

È stata aperta anche la finestra Collegamenti alla dimensione minima. Titolo, stato Codex, errore GitHub e pulsante Fine sono rimasti visibili. L’errore vive nell’area scorrevole, mentre Fine e la nota sulle credenziali restano fermi.

Il repository pubblico `emanueledenaro/trama` è stato caricato nella sezione Gruppo. I branch `codex/compact-review`, `codex/design-foundations`, `codex/responsive-workspace` e gli SHA abbreviati sono rimasti leggibili a 720×640, con l’azione Attività presente per ogni riga. La sezione Issue ha mostrato 21 ticket reali con lista e dettaglio sovrapposti. La finestra Nuova issue conserva intestazione, editor scorrevole, Annulla e Pubblica issue; Esc ha chiuso la bozza senza pubblicare nulla.

La prova da tastiera nella finestra Nuova issue ha confermato il passaggio dal campo Titolo all’editor e la chiusura con Esc. L’editor intercetta Tab come testo, quindi il percorso completo verso le azioni richiede ancora la verifica con Accesso completo da tastiera di macOS attivo.

La capsula centrale del vecchio progetto di esempio non compare nella toolbar della build verificata.

## Limiti ancora aperti

Il monitor usato per la prova non consente di confermare con misure indipendenti le dimensioni 1440×900 e 1920×1080 punti. Lo schermo intero osservato dimostra soltanto l’adattamento allo spazio disponibile. Restano inoltre la pubblicazione di una PR con dati lunghi nella finestra minima, il percorso completo con Accesso completo da tastiera e VoiceOver, gli stati di caricamento durante un’operazione reale e una raccolta esportabile delle schermate prima e dopo.

Queste mancanze impediscono la chiusura di #21.
