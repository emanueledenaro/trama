# Piano operativo vigente di Trama

Stato: incremento verticale del Coordinatore approvato da Emanuele il 16 settembre 2026. Questo piano sostituisce l'ordine C03, C04, C05 con i ticket V01-V09 e mantiene requisiti, ottimizzazioni e prove precedenti. Il 17 settembre 2026 Emanuele ha aggiunto i ticket P01-P09: Trama avrà gli stessi nove provider di Synara ([ADR 0008](adr/0008-provider-di-synara-in-swift.md)).

[Specifica dell'incremento verticale](spec-coordinatore-verticale.md) · [Specifica del Coordinatore](spec-coordinatore.md) · [ADR 0006](adr/0006-coordinatore-thread-persistente-con-strumenti.md) · [ADR 0007](adr/0007-finestra-centrata-su-decisioni-team-e-verifiche.md) · [Riferimento visivo](reference/design-app-codex.md) · [Riferimento funzionale Synara](reference/synara-funzioni.md) · [Intervista approvata](progettazione/coordinatore-intervista.md) · [Piano iniziale conservato](pianificazione/piano-iniziale-2026-09-12.md).

## Stato reale di partenza

Base pubblicata: `4507788`, con la cronologia del Coordinatore (C01, #33), la chat in streaming con fonti (C02, PR #55), il modello del mandato (PR #56) e il campo di scrittura solo nel Coordinatore con RequestState (PR #62) integrati. C01 è chiuso e verificato; C02 (#34) resta aperto perché le prove reali e il documento di verifica arrivano con V09 sul nuovo runtime. La verifica complessiva di #21 e #22 resta aperta e va ripetuta sul nuovo impianto.

Il Coordinatore attuale apre un thread effimero a ogni messaggio, riceve solo la richiesta e le decisioni, può soltanto leggere file e non compone un team. Il Product Owner lo ha giudicato inutilizzabile rispetto alla specifica: da qui l'incremento verticale. Catalogo, scanner, Patto, sessioni, GitHub, modelli e monitor esistenti restano la base da estendere.

## Ordine del lavoro

I ticket V01-V09 costruiscono il Coordinatore vero per fette verticali, ognuna dimostrabile. V07 corre in parallelo con V03-V05; V06 in parallelo con V05. P01 è solo documentazione e può partire subito. I provider entrano dopo V08 e prima di V09: prima Claude Agent (P02), poi gli altri sette. C03, C04 e C05 sono chiusi come sostituiti; #57, #58, #59 e #60 sono chiusi come assorbiti o realizzati.

| Ticket | Consegna | Bloccato da |
| --- | --- | --- |
| [#64](https://github.com/emanueledenaro/trama/issues/64) | V01 Timeline degli eventi della conversazione | Nessuno |
| [#65](https://github.com/emanueledenaro/trama/issues/65) | V02 Il Coordinatore studia il progetto e lo ricorda | [#64](https://github.com/emanueledenaro/trama/issues/64) |
| [#66](https://github.com/emanueledenaro/trama/issues/66) | V03 Mandato e decisioni dalla conversazione | [#65](https://github.com/emanueledenaro/trama/issues/65) |
| [#67](https://github.com/emanueledenaro/trama/issues/67) | V04 Team di progetto e incarico in worktree | [#66](https://github.com/emanueledenaro/trama/issues/66) |
| [#68](https://github.com/emanueledenaro/trama/issues/68) | V05 Candidato verificato in chat | [#67](https://github.com/emanueledenaro/trama/issues/67) |
| [#69](https://github.com/emanueledenaro/trama/issues/69) | V06 Impianto della finestra centrato su decisioni, team e verifiche | [#67](https://github.com/emanueledenaro/trama/issues/67) |
| [#70](https://github.com/emanueledenaro/trama/issues/70) | V07 Composer con menzioni e misuratore della finestra di contesto | [#65](https://github.com/emanueledenaro/trama/issues/65) |
| [#71](https://github.com/emanueledenaro/trama/issues/71) | V08 Forma dell'adattatore provider con Codex come unico adattatore | [#68](https://github.com/emanueledenaro/trama/issues/68), [#70](https://github.com/emanueledenaro/trama/issues/70), [#80](https://github.com/emanueledenaro/trama/issues/80) |
| [#80](https://github.com/emanueledenaro/trama/issues/80) | P01 Riferimento Synara per tutti i provider e attribuzione | Nessuno |
| [#81](https://github.com/emanueledenaro/trama/issues/81) | P02 Adattatore Claude Agent | [#71](https://github.com/emanueledenaro/trama/issues/71), [#80](https://github.com/emanueledenaro/trama/issues/80) |
| [#82](https://github.com/emanueledenaro/trama/issues/82) | P03 Runtime ACP condiviso e adattatore Cursor | [#81](https://github.com/emanueledenaro/trama/issues/81) |
| [#83](https://github.com/emanueledenaro/trama/issues/83) | P04 Adattatore Grok | [#82](https://github.com/emanueledenaro/trama/issues/82) |
| [#84](https://github.com/emanueledenaro/trama/issues/84) | P05 Adattatore Droid | [#82](https://github.com/emanueledenaro/trama/issues/82) |
| [#85](https://github.com/emanueledenaro/trama/issues/85) | P06 Adattatore Devin | [#82](https://github.com/emanueledenaro/trama/issues/82) |
| [#86](https://github.com/emanueledenaro/trama/issues/86) | P07 Adattatore OpenCode | [#81](https://github.com/emanueledenaro/trama/issues/81) |
| [#87](https://github.com/emanueledenaro/trama/issues/87) | P08 Adattatore Antigravity | [#81](https://github.com/emanueledenaro/trama/issues/81) |
| [#88](https://github.com/emanueledenaro/trama/issues/88) | P09 Adattatore Pi | [#81](https://github.com/emanueledenaro/trama/issues/81), [#80](https://github.com/emanueledenaro/trama/issues/80) |
| [#72](https://github.com/emanueledenaro/trama/issues/72) | V09 Prova reale Trama su Trama e chiusura dell'incremento | [#68](https://github.com/emanueledenaro/trama/issues/68), [#69](https://github.com/emanueledenaro/trama/issues/69), [#70](https://github.com/emanueledenaro/trama/issues/70), [#71](https://github.com/emanueledenaro/trama/issues/71), [#81](https://github.com/emanueledenaro/trama/issues/81), [#82](https://github.com/emanueledenaro/trama/issues/82), [#83](https://github.com/emanueledenaro/trama/issues/83), [#84](https://github.com/emanueledenaro/trama/issues/84), [#85](https://github.com/emanueledenaro/trama/issues/85), [#86](https://github.com/emanueledenaro/trama/issues/86), [#87](https://github.com/emanueledenaro/trama/issues/87), [#88](https://github.com/emanueledenaro/trama/issues/88) |
| [#61](https://github.com/emanueledenaro/trama/issues/61) | Tastiera e scorciatoie sul nuovo impianto | [#69](https://github.com/emanueledenaro/trama/issues/69) |

Le fasi successive restano i ticket C06-C16, riformulati sopra il nuovo Coordinatore. Le dipendenze aggiornate:

| Ticket | Consegna | Bloccato da |
| --- | --- | --- |
| [#38](https://github.com/emanueledenaro/trama/issues/38) | C06 Ricalcolare solo gli incarichi coinvolti da decisioni e perimetri | [#68](https://github.com/emanueledenaro/trama/issues/68) |
| [#39](https://github.com/emanueledenaro/trama/issues/39) | C07 Cambiare progetto mentre i team autorizzati continuano | [#68](https://github.com/emanueledenaro/trama/issues/68), [#69](https://github.com/emanueledenaro/trama/issues/69) |
| [#40](https://github.com/emanueledenaro/trama/issues/40) | C08 Mostrare in chat conflitti tra specialisti e collaboratori GitHub | [#68](https://github.com/emanueledenaro/trama/issues/68), [#38](https://github.com/emanueledenaro/trama/issues/38) |
| [#41](https://github.com/emanueledenaro/trama/issues/41) | C09 Integrare candidati tramite mandato senza falsare la revisione umana | [#38](https://github.com/emanueledenaro/trama/issues/38), [#40](https://github.com/emanueledenaro/trama/issues/40) |
| [#42](https://github.com/emanueledenaro/trama/issues/42) | C10 Aggiornare ticket e checklist solo quando le prove lo consentono | [#41](https://github.com/emanueledenaro/trama/issues/41) |
| [#43](https://github.com/emanueledenaro/trama/issues/43) | C11 Riprendere il Coordinatore dopo limiti, chiusura e indisponibilità | [#39](https://github.com/emanueledenaro/trama/issues/39) |
| [#44](https://github.com/emanueledenaro/trama/issues/44) | C12 Configurare Trama al primo avvio con una guida riprendibile | [#65](https://github.com/emanueledenaro/trama/issues/65), [#66](https://github.com/emanueledenaro/trama/issues/66) |
| [#45](https://github.com/emanueledenaro/trama/issues/45) | C13 Imparare a conoscere un progetto con il primo esercizio guidato | [#44](https://github.com/emanueledenaro/trama/issues/44) |
| [#46](https://github.com/emanueledenaro/trama/issues/46) | C14 Completare gli esercizi di modifica, decisione e conflitto | [#45](https://github.com/emanueledenaro/trama/issues/45), [#68](https://github.com/emanueledenaro/trama/issues/68), [#38](https://github.com/emanueledenaro/trama/issues/38), [#40](https://github.com/emanueledenaro/trama/issues/40), [#41](https://github.com/emanueledenaro/trama/issues/41) |
| [#47](https://github.com/emanueledenaro/trama/issues/47) | C15 Migliorare i team con pratiche verificate e reversibili | [#67](https://github.com/emanueledenaro/trama/issues/67), [#42](https://github.com/emanueledenaro/trama/issues/42), [#39](https://github.com/emanueledenaro/trama/issues/39) |
| [#48](https://github.com/emanueledenaro/trama/issues/48) | C16 Usare Trama funzionante per sviluppare Trama senza regressioni | [#41](https://github.com/emanueledenaro/trama/issues/41), [#43](https://github.com/emanueledenaro/trama/issues/43), [#46](https://github.com/emanueledenaro/trama/issues/46), [#47](https://github.com/emanueledenaro/trama/issues/47) |

Le automazioni programmate sono un ticket da aprire dopo V09.

## Ticket precedenti e verifica finale

I ticket #2-#19 e #21-#23 mantengono criteri e cronologia. Il [raccordo criterio per criterio](verifiche/roadmap-coordinatore.md) indica prove pregresse, parti mancanti e nuova responsabilità. #18 verifica il percorso completo finale e #19 la riproduzione da clone pulito. Responsive #21 e design #22 restano necessari per tutte le schermate coinvolte.

I riferimenti alle funzionalità già esistenti non creano dipendenze artificiali tra un nuovo ticket e la chiusura integrale di tutti i ticket precedenti. Ogni nuovo incremento verifica i comportamenti che riusa. Le vecchie prove non si trasferiscono automaticamente al nuovo runtime.

## Regola di avanzamento

Per ogni criterio registrare stato, fonte della prova, candidato/commit, esito e limite. Durante l’implementazione aggiornare il ticket per progressi e impedimenti. La chiusura segue solo test, prova nell’app, revisione, CI e documentazione completi. Nessuna issue chiusa per la sola fine dell’agente. Il merge ordinario può essere delegato nel mandato; casi distruttivi seri e scelte di prodotto richiedono Emanuele.

## Accettazione della beta

La chiusura complessiva richiede i criteri originari e il Coordinatore completo: tutorial, team dinamici, isolamento, gestione del mandato, conflitti, aggiornamento ticket, ripresa, miglioramento del metodo, uso di Trama su Trama, UI e clone pulito. Firma Developer ID, notarizzazione e installazione su secondo Mac restano condizioni separate per la beta scaricabile.
