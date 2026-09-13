# Piano operativo vigente di Trama

Stato: modello del Coordinatore e simulazione del primo utilizzo approvati da Emanuele. Questo piano sostituisce le scelte del piano iniziale incompatibili con l’intervista, mantenendo requisiti, ottimizzazioni e prove precedenti.

[Specifica completa](spec-coordinatore.md) · [Intervista approvata](progettazione/coordinatore-intervista.md) · [Piano iniziale conservato](pianificazione/piano-iniziale-2026-09-12.md).

## Stato reale di partenza

Base pubblicata verificata: `ad38e76`, PR #32 integrata e CI di main riuscita. Prima del nuovo piano risultavano 22 issue aperte, inclusa la specifica #1. Le ulteriori modifiche di design #22 sono locali e non committate; non vengono dichiarate integrate da questo piano.

Il runtime attuale è centrato su un solo progetto e il cambio progetto interrompe Codex. La chat persistente e i team concorrenti sono lavoro da realizzare. Catalogo, scanner, Patto, sessioni, GitHub, modelli e monitor esistenti costituiscono la base da estendere.

## Ordine del lavoro

Preservare e completare la verifica dell’incremento #22 pendente. C01-C04 portano poi un primo percorso verticale dalla cronologia esistente alla chat e a un incarico isolato verificato. Le altre fasi seguono le dipendenze effettive; nessun numero fisso limita la composizione dei futuri team.

| Ticket | Consegna | Bloccato da |
| --- | --- | --- |
| [#33](https://github.com/emanueledenaro/trama/issues/33) | Ritrovare chat e richieste senza perdere i dati esistenti | Nessuno |
| [#34](https://github.com/emanueledenaro/trama/issues/34) | Dialogare con il Coordinatore in streaming e aprire le fonti | [#33](https://github.com/emanueledenaro/trama/issues/33) |
| [#35](https://github.com/emanueledenaro/trama/issues/35) | Concedere un mandato e decidere il comportamento dalla chat | [#34](https://github.com/emanueledenaro/trama/issues/34) |
| [#36](https://github.com/emanueledenaro/trama/issues/36) | Portare un incarico dalla chat a un candidato verificato | [#35](https://github.com/emanueledenaro/trama/issues/35) |
| [#37](https://github.com/emanueledenaro/trama/issues/37) | Comporre specialisti dinamici e controllarli da Team | [#36](https://github.com/emanueledenaro/trama/issues/36) |
| [#38](https://github.com/emanueledenaro/trama/issues/38) | Ricalcolare solo gli incarichi coinvolti da decisioni e perimetri | [#37](https://github.com/emanueledenaro/trama/issues/37) |
| [#39](https://github.com/emanueledenaro/trama/issues/39) | Cambiare progetto mentre i team autorizzati continuano | [#37](https://github.com/emanueledenaro/trama/issues/37) |
| [#40](https://github.com/emanueledenaro/trama/issues/40) | Mostrare in chat conflitti tra specialisti e collaboratori GitHub | [#37](https://github.com/emanueledenaro/trama/issues/37), [#38](https://github.com/emanueledenaro/trama/issues/38) |
| [#41](https://github.com/emanueledenaro/trama/issues/41) | Integrare candidati tramite mandato senza falsare la revisione umana | [#38](https://github.com/emanueledenaro/trama/issues/38), [#40](https://github.com/emanueledenaro/trama/issues/40) |
| [#42](https://github.com/emanueledenaro/trama/issues/42) | Aggiornare ticket e checklist solo quando le prove lo consentono | [#41](https://github.com/emanueledenaro/trama/issues/41) |
| [#43](https://github.com/emanueledenaro/trama/issues/43) | Riprendere il Coordinatore dopo limiti, chiusura e indisponibilità | [#39](https://github.com/emanueledenaro/trama/issues/39) |
| [#44](https://github.com/emanueledenaro/trama/issues/44) | Configurare Trama al primo avvio con una guida riprendibile | [#34](https://github.com/emanueledenaro/trama/issues/34), [#35](https://github.com/emanueledenaro/trama/issues/35) |
| [#45](https://github.com/emanueledenaro/trama/issues/45) | Imparare a conoscere un progetto con il primo esercizio guidato | [#44](https://github.com/emanueledenaro/trama/issues/44) |
| [#46](https://github.com/emanueledenaro/trama/issues/46) | Completare gli esercizi di modifica, decisione e conflitto | [#45](https://github.com/emanueledenaro/trama/issues/45), [#36](https://github.com/emanueledenaro/trama/issues/36), [#38](https://github.com/emanueledenaro/trama/issues/38), [#40](https://github.com/emanueledenaro/trama/issues/40), [#41](https://github.com/emanueledenaro/trama/issues/41) |
| [#47](https://github.com/emanueledenaro/trama/issues/47) | Migliorare i team con pratiche verificate e reversibili | [#37](https://github.com/emanueledenaro/trama/issues/37), [#42](https://github.com/emanueledenaro/trama/issues/42), [#39](https://github.com/emanueledenaro/trama/issues/39) |
| [#48](https://github.com/emanueledenaro/trama/issues/48) | Usare Trama funzionante per sviluppare Trama senza regressioni | [#41](https://github.com/emanueledenaro/trama/issues/41), [#43](https://github.com/emanueledenaro/trama/issues/43), [#46](https://github.com/emanueledenaro/trama/issues/46), [#47](https://github.com/emanueledenaro/trama/issues/47) |

## Ticket precedenti e verifica finale

I ticket #2-#19 e #21-#23 mantengono criteri e cronologia. Il [raccordo criterio per criterio](verifiche/roadmap-coordinatore.md) indica prove pregresse, parti mancanti e nuova responsabilità. #18 verifica il percorso completo finale e #19 la riproduzione da clone pulito. Responsive #21 e design #22 restano necessari per tutte le schermate coinvolte.

I riferimenti alle funzionalità già esistenti non creano dipendenze artificiali tra un nuovo ticket e la chiusura integrale di tutti i ticket precedenti. Ogni nuovo incremento verifica i comportamenti che riusa. Le vecchie prove non si trasferiscono automaticamente al nuovo runtime.

## Regola di avanzamento

Per ogni criterio registrare stato, fonte della prova, candidato/commit, esito e limite. Durante l’implementazione aggiornare il ticket per progressi e impedimenti. La chiusura segue solo test, prova nell’app, revisione, CI e documentazione completi. Nessuna issue chiusa per la sola fine dell’agente. Il merge ordinario può essere delegato nel mandato; casi distruttivi seri e scelte di prodotto richiedono Emanuele.

## Accettazione della beta

La chiusura complessiva richiede i criteri originari e il Coordinatore completo: tutorial, team dinamici, isolamento, gestione del mandato, conflitti, aggiornamento ticket, ripresa, miglioramento del metodo, uso di Trama su Trama, UI e clone pulito. Firma Developer ID, notarizzazione e installazione su secondo Mac restano condizioni separate per la beta scaricabile.
