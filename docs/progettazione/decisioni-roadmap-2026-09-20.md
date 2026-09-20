# Decisioni su provider, dialoghi e roadmap

Decisioni confermate dalla persona nella sessione grill-with-docs del 20 settembre 2026. Questo documento registra requisiti approvati, senza attestare implementazione o prove.

## Ordine e responsabilità

Prima si completa P02 con Codex e Claude coerenti. Seguono UX00, con scelta umana del layout, e UX01-UX08, conservando i prerequisiti C06, C07, C08 e C09 dove richiesti. P03-P09 seguono la nuova esperienza. La struttura centrata su obiettivi e risultati è approvata; il layout viene dal prototipo.

P02 possiede il selettore unificato e la corrispondenza fra selezione e invio. T21 conserva le prove specifiche del catalogo Codex. UX05 possiede comprensione e motivazione delle scelte degli specialisti. Le serie P e UX restano distinte, con un solo proprietario per comportamento. ready-for-agent indica il prossimo lavoro eseguibile con prerequisiti risolti.

## Composer

La persona ha corretto la proposta iniziale richiedendo il comportamento di Synara. La selezione resta associata a bozza e dialogo, con preferenze separate per provider; una nuova bozza usa l'ultima selezione disponibile. Si elimina la distinzione fra modello permanente e modello valido soltanto per il prossimo messaggio. Il riferimento locale è docs/reference/synara-funzioni.md, sezione Composer; il comportamento corrente di Synara va verificato sul sorgente prima del porting.

Modello e sforzo vengono fotografati all'accodamento. Cambiare la selezione successivamente non cambia turni già accodati. Il provider può cambiare soltanto senza turno attivo e con coda vuota; dopo una richiesta di interruzione si attende la conferma.

Il cambio provider conserva dialogo, cronologia, bozza e worktree applicabili. La nuova sessione riceve trascrizione, memoria e studio. Una selezione indisponibile resta visibile con il motivo e blocca l'invio, senza fallback automatico. Il turno distingue selezione richiesta e attribuzione effettiva; dati effettivi mancanti non si deducono dalla preferenza.

## Dialoghi e superfici

Un Coordinatore logico è responsabile del progetto. Ogni dialogo di obiettivo e il dialogo generale hanno sessioni tecniche distinte, con mandato, decisioni e memoria di progetto condivisi. Nella prima versione un solo turno del Coordinatore è attivo per progetto. Gli specialisti autorizzati possono continuare in parallelo.

La cronologia precedente rimane nel dialogo generale. Il composer appartiene al dialogo selezionato e rende visibile il destinatario; bozze e selezioni restano nel loro contesto. Obiettivi, decisioni, lavori e risultati costituiscono il percorso principale. Attività tecniche e prove complete restano raggiungibili dai rispettivi oggetti. Mappa, Issue e Modifiche restano strumenti del progetto.

## Consegna di P02

P02 corregge composer e runtime esistenti, senza introdurre i dialoghi multipli o il layout UX00. Prima del merge occorrono prove sulla stessa build di invio reale Codex/Claude, preferenze per provider, passaggio di consegne, fotografia dei turni in coda, attribuzione del turno, indisponibilità senza fallback e riapertura senza perdita. Restano richiesti tutti i criteri preesistenti di P02, test pertinenti, build, review Standards/Spec e CI del candidato finale.

L'aggiornamento di specifica, piano e ticket precede l'implementazione. Il merge è autorizzato quando i criteri sono dimostrati; il lavoro UX riparte dal main integrato.

## Responsabilità di esecuzione

La persona richiede gpt-5.6-luna con ragionamento medium come implementatore. Il Coordinatore segue il lavoro, confronta diff e prove con il ticket e richiede correzioni prima di accettarlo. Un solo implementatore è attivo alla volta.

La richiesta successiva di portare il sistema di apprendimento Hermes è registrata in apprendimento-hermes.md. Il porting deve partire dal codice ufficiale, con revisione e licenza identificate, e collegarsi al miglioramento previsto da C15.
