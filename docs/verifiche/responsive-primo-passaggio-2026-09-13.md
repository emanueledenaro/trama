# Primo passaggio responsive

Incremento del ticket #21, basato su main `167e9a2`. Il ticket resta aperto.

## Modifiche

La finestra principale dichiara un minimo di 720×640 punti di contenuto. Sotto 900 punti la sidebar si chiude e il comando nativo permette di riaprirla; tornando a una larghezza maggiore viene recuperata la visibilità precedente. La selezione del modulo rimane nel modello del progetto.

Sotto 1100 punti il dettaglio del modulo usa un pannello con un pulsante Fine. Le fonti si aprono sopra questo pannello: la prima prova aveva rilevato che la presentazione esterna rimaneva in attesa finché il dettaglio non veniva chiuso. La presentazione annidata corregge quel percorso.

La mappa ricava le colonne dallo spazio disponibile e scorre verticalmente. Richieste e issue passano da colonne affiancate a elenco sopra il dettaglio quando lo spazio centrale scende sotto 760 punti. AnyLayout conserva l’identità delle viste durante il passaggio.

Piano, anteprima dei file e attività GitHub hanno dimensioni minime e ideali compatibili con finestre più piccole. Il selettore delle attività del gruppo usa un menu nativo, evitando una barra segmentata larga 440 punti.

## Prove nell’app

La Release precedente impediva di scendere sotto il minimo 1040×700 dichiarato nel codice. Nella build QA aggiornata il trascinamento fino al limite produce una finestra di 720 punti di larghezza, con due colonne nella mappa e senza scorrimento orizzontale della mappa.

Verificati direttamente con mouse e tastiera:

- apertura di TramaCore dalla mappa nella finestra minima;
- dettaglio compatto con intestazione, schede e azione in basso raggiungibili;
- apertura di PlanningReply.swift dalla scheda File sopra il dettaglio;
- Esc chiude prima il file e poi il dettaglio, conservando TramaCore selezionato;
- riapertura della sidebar dal controllo nativo;
- passaggio a Modifiche con elenco sopra il piano e scorrimento indipendente del testo, mantenendo la richiesta selezionata.

Le schermate prima e dopo sono state osservate durante la sessione di verifica. Non sono ancora raccolte in un confronto esportabile per tutte le dimensioni del ticket.

## Da completare prima della chiusura di #21

Restano la matrice completa 720×640, 1040×700, 1280×800, 1440×900 e 1920×1080; piano in modifica, revisione, pubblicazione PR e tutte le altre modali; testi e percorsi lunghi; stati vuoti, caricamento ed errore; tastiera completa e VoiceOver. Va provato anche il passaggio tra le soglie mentre una fonte è aperta.

La build e la suite automatica non sostituiscono queste prove visive. Nessun criterio globale viene marcato completato sulla base di questo incremento.
