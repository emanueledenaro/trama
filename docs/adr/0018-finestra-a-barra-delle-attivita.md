# La finestra segue la disposizione di VS Code: barra delle attività, barra laterale, editor, pannello e barra di stato

Stato: accettata il 28 settembre 2026 dalla persona, issue #314 (alternativa B della proposta in `docs/design/schermate-2026-09-28/`). Sostituisce la parte dell'ADR 0007 sulla sidebar con le viste del progetto e sull'ispettore a destra. Il resto dell'ADR 0007 resta valido: una sola conversazione per progetto, nessuna lista di thread, schede come atti del metodo, identità e colori degli agenti.

L'audit del 28 settembre (commento sulla #314) ha trovato la stessa richiesta in dieci posti, tre fasce fisse sopra la chat, 11 voci nella barra laterale più l'ispettore con molte viste, tre pulsanti pieni insieme e 402 px di altezza per la conversazione su 800. La persona ha scritto: "non si capisce nulla". La proposta ha confrontato tre disposizioni con gli stessi principi (una domanda per zona, una sola cosa urgente, un solo posto per ciò che aspetta la persona) e la persona ha scelto quella che riprende VS Code.

Decisione:

- **Barra delle attività.** A sinistra, larga 48 px, una colonna di icone con tooltip: in cima Progetti, poi le cinque viste del progetto (Aspetta te, Lavoro, Squadre, Regole, Memoria), in fondo Impostazioni. Il solo badge è quello di Aspetta te. Cliccare l'icona della vista aperta chiude la barra laterale.
- **Barra laterale.** Accanto alla barra delle attività, attaccata e ridimensionabile con il separatore di VS Code (PR #234): mostra la vista scelta con testata, riepilogo, elenco e sezioni chiuse. Una vista alla volta.
- **Area dell'editor.** Al centro la Conversazione con il Coordinatore, sempre la prima scheda e non chiudibile. Un dettaglio (persona della squadra, candidato con l'Esame approfondito, Progetti, Impostazioni) si apre come scheda accanto alla Conversazione. Le schede compaiono solo quando ce n'è più di una. Quando la finestra è larga il dettaglio si affianca alla Conversazione in un editor diviso.
- **Pannello in basso.** Attività si apre in un pannello sotto l'area dell'editor, attaccato con un separatore orizzontale, e si chiude.
- **Barra di stato.** In fondo alla finestra, alta 24 px: branch, conflitto con il branch principale, riga di stato, obiettivo in primo piano, Attività e Pausa come icone. Sostituisce la riga del primo piano, la riga di stato sopra la chat e l'avviso di divergenza.
- **Barra del titolo.** Nome del progetto con il menu dei progetti, branch, ricerca al centro, interruttori di barra laterale, pannello e editor diviso.
- **Sopra il composer** resta una sola riga di Aspetta te con la prima voce, il conteggio e un solo pulsante pieno; sparisce quando la vista Aspetta te è aperta.
- **Viste che si fondono.** Obiettivi, Lavoro, Issue e la parte GitHub di Gruppo diventano Lavoro. Team, Specialista e Lavoro automatico diventano Squadre. Patto, Mandato, Standard del codice e Mappa (come sezione Moduli) diventano Regole. Memoria riceve "Come impara" da Impostazioni. Gruppo si scioglie; presenza e monitor stanno solo in Impostazioni.
- **Pulsanti.** Azioni secondarie e ripetute a icona con tooltip e nome accessibile; decisioni e azioni che non si annullano con testo, a destra, primaria per ultima (`.cta-row`). La tabella è in `docs/design/schermate-2026-09-28/principi.md`.

Alternative scartate:

- **A, albero del progetto** (le viste sotto il progetto nella barra laterale, dettaglio nell'ispettore a destra). Cambiava meno codice, ma teneva due colonne laterali e il dettaglio lontano dalla chat.
- **C, chat e pannello a schede** (niente barra laterale, un pannello a destra con cinque schede). Dava più altezza alla conversazione, ma toglieva l'elenco dei progetti e riduceva le schede a icone alla larghezza predefinita.

Conseguenze:

- A 1280x800 la conversazione passa da 402 a 586 px di altezza nei prototipi (452 px al 120%), con un solo pulsante pieno. Misure in `docs/design/schermate-2026-09-28/misure.json`.
- A 1280x800 un dettaglio aperto in una scheda copre la Conversazione; la riga sopra il composer e la barra di stato restano visibili. Da circa 1500 px il dettaglio si affianca.
- La barra laterale ad albero con le viste del progetto, l'ispettore e le fasce sopra la chat escono dal renderer. Il lavoro è diviso in fette verticali B01-B09 collegate alla #314; la prima costruisce l'impianto e tiene raggiungibili tutte le viste di oggi, così nessuna funzione si perde durante il passaggio.
- ui-check tiene tutti i passi di oggi, spostati sulle nuove superfici, e aggiunge schermate in chiaro e scuro, stretta e larga.
- Ogni testo visibile nuovo entra nei due cataloghi di `app/src/shared/messages` (italiano e inglese).
