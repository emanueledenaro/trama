# Simulazione: Trama costruisce da zero un sito fan di GTA 6 (2-6 ottobre 2026)

Prova dal vivo dell'app Electron su un progetto nuovo, con provider e GitHub reali. Questo registro riporta fatti osservati nell'app di prova, nei suoi dati e su GitHub. Non è un test automatico.

## Ambiente

- App di prova costruita da `main` e da `bugfix/issue-action-wording` (poi #581), dati separati in `TRAMA_DATA_DIR`.
- Provider: Codex (ChatGPT) con `gpt-6.1-sol`, sforzo basso per il Coordinatore, quello scelto dal Coordinatore per i ruoli.
- GitHub reale con `gh` autenticato: repository privato `emanueledenaro/sito-gta6-b`, creato da Trama.
- La persona era simulata dal coordinatore della sessione, che scriveva nel composer e rispondeva in "Aspetta te". Dal 6 ottobre sera ha usato l'app anche la persona vera.

## Cosa ha fatto Trama

- Ha creato il progetto da un'idea: repository su GitHub, metodo di lavoro committato, team con una sviluppatrice (Ada).
- Ha chiarito l'idea con `grilling`, scritto la spec e diviso il piano in sette fette.
- Ha affidato le fette, verificato i candidati con le sue verifiche (stato del repository, spazi e conflitti, controllo dei tipi, test Node con prove nel browser), fatto rileggere ai Revisori e unito su GitHub.
- Pull request unite da Trama sul repository reale:

| PR | Fetta | Unita |
| --- | --- | --- |
| [#9](https://github.com/emanueledenaro/sito-gta6-b/pull/9) | Base Astro e navigazione da telefono | 2 ottobre |
| [#21](https://github.com/emanueledenaro/sito-gta6-b/pull/21) | Contenuti locali e regole di pubblicazione | 3 ottobre |
| [#22](https://github.com/emanueledenaro/sito-gta6-b/pull/22) | Notizie e anteprima nella pagina iniziale | 6 ottobre |
| [#25](https://github.com/emanueledenaro/sito-gta6-b/pull/25) | Schede dei personaggi con fonti | 6 ottobre |
| [#26](https://github.com/emanueledenaro/sito-gta6-b/pull/26) | Uscita e conto alla rovescia | 6 ottobre |

- Ricerca ha letto pagine reali di Rockstar e Take-Two e ha confermato la data di uscita (19 novembre 2026) su quattro fonti; il conto alla rovescia la usa con precisione al giorno.
- Ricerca dei guasti ha riprodotto e spiegato più prove fallite (porta di Astro ignorata, testo al 200% senza JavaScript, ritorno sulla pagina); le correzioni sono passate dalle verifiche di Trama.
- Un conflitto tra due fette è stato risolto nella copia della sviluppatrice con `align_with_base`, senza intervento della persona.
- Dopo un riavvio improvviso dell'app il lavoro è ripreso da solo dalla copia conservata.

## Interventi della persona

- Ok sull'aspetto delle fette con interfaccia (4 e 5): le schermate prima e dopo mancavano, il sito è stato aperto e guardato a mano.
- Messaggi per far ripartire il lavoro: alla ripresa del 6 ottobre, dopo una correzione di Ricerca dei guasti che non rilanciava le verifiche, e per ricordare al Coordinatore una data già verificata.
- Consensi per sito dati in "Aspetta te".

## Difetti di Trama trovati

| Difetto | Issue | Stato al 6 ottobre |
| --- | --- | --- |
| Copia di lavoro non riallineabile su `main`, file passati attraverso le domande | #547, #548 | Corretto (#551) |
| Domande senza risposta, issue delle fette non chiuse | #549, #550 | Corretto (#553) |
| Ricerca e Operatore scadevano dopo 2 minuti | #583 | Corretto (#585), verificato nell'app di prova |
| "Assegna il lavoro" con l'unica sviluppatrice occupata, poi Trama si fermava | #584 | Corretto (#586, #588) |
| Schermate prima e dopo assenti nei progetti creati da Trama | #587 | Corretto (#592) |
| Fatti verificati dimenticati dopo il riordino del contesto | #589 | Corretto (#593) |
| Link all'anteprima locale non cliccabile | | Corretto (#594) |
| Stato delle verifiche detto in ritardo | #590 | Aperto |
| Rapporto delle verifiche nel repository che fa rifare le prove | #591 | Aperto |
| Mostrare il sito chiede un consenso e non riparte dopo il sì | #595 | Aperto |
| L'Operatore poteva controllare la finestra di Trama e approvarsi i consensi | #597 | Aperto, priorità di sicurezza |

## Cosa non è provato

- Il Chrome di tutti i giorni della persona: da Chrome 136 la porta di debug non vale sul profilo predefinito, quindi `open_in_chrome` non lo raggiunge.
- Schermo, mouse e tastiera su un Mac reale con i permessi Accessibilità e Registrazione schermo.
- Il ciclo completo su questo repository, con la sua CI: è la fase 5 del ciclo di affidabilità (#601).
- Le ultime due fette del sito (mappa e controllo finale) erano ancora in lavorazione.
