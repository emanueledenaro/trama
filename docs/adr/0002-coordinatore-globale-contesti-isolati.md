# Coordinatore unico con contesti di progetto separati

Stato: accettata nella prima tornata dell'intervista sul Coordinatore. Decisione di prodotto; implementazione ancora da verificare.

Trama presenta una sola chat principale. Selezionare un progetto mostra la sua cronologia e il suo team, mentre Tutti i progetti raccoglie avanzamento, blocchi e decisioni richieste. La vista globale usa riepiloghi e non incorpora automaticamente codice o conversazioni private dei diversi progetti. Un confronto dettagliato tra progetti richiede una richiesta esplicita della persona. Questa separazione conserva un solo interlocutore senza trasformare la cronologia globale in un contesto condiviso indiscriminato.

L'identità di progetto resta distinta per cartella: due cloni con lo stesso remote GitHub non condividono automaticamente Patto, team o approvazioni. Il collegamento a un unico progetto richiede una scelta esplicita. Gli avvisi remoti possono avere la stessa fonte, ma il loro impatto viene valutato sui candidati del rispettivo progetto.

Il progetto attivo indica il destinatario del dialogo, non l'unico progetto autorizzato a lavorare. Cambiare selezione lascia proseguire gli incarichi già autorizzati del progetto precedente nei limiti assegnati. Questa scelta richiede di separare lo stato della navigazione dallo stato delle esecuzioni, preservando l'isolamento e le prove già presenti.

Estensione accettata con Q12: le buone pratiche di un team possono essere proposte agli altri team come metodi generali. Il trasferimento mantiene separati codice, decisioni e contenuti riservati dei progetti. Il team destinatario ne verifica l'utilità nel proprio contesto prima dell'adozione. Condividere una procedura non concede accesso al contesto che l'ha originata e non estende il mandato del destinatario.
