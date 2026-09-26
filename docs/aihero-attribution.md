# Attribuzione delle skill AI Hero

Trama include le [skill di Matt Pocock](https://github.com/mattpocock/skills) con i nomi di Trama. Basato sulle skill di Matt Pocock, licenza MIT.

## Sorgente

- Release: `v1.2.3`
- Commit: `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`, risolto dal tag annotato `835450ef244ab7335f75d95b83e7d979eae22a6d`
- Versione del pacchetto in Trama: `v1.2.3+trama.2 (6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)`

La riga "Basato sulle skill di Matt Pocock, licenza MIT" compare nelle impostazioni, sotto "Metodo di lavoro", e nel menu delle skill che si apre scrivendo "/" nel composer, quando il progetto ha il metodo preparato.

I file restano sotto la licenza MIT originale, con l'avviso `Copyright (c) 2026 Matt Pocock`. Il testo della licenza è in `app/resources/AIHero/LICENSE`, identico all'originale, e nei progetti configurati viene copiato in `.agents/skills/AIHERO-LICENSE`.

## Skill incluse

Tutte le skill delle cartelle `skills/engineering`, `skills/productivity` e `skills/misc` della release, con i loro file di riferimento, copiate in `app/resources/AIHero/skills/<nome>/`. Le cartelle `in-progress` e `deprecated` restano fuori.

- engineering: ask-trama (era ask-matt), code-review, codebase-design, diagnosing-bugs, domain-modeling, grill-with-docs, implement, improve-codebase-architecture, prototype, research, resolving-merge-conflicts, setup-trama (era setup-matt-pocock-skills), tdd, to-spec, to-tickets, triage, wayfinder, wizard;
- productivity: grill-me, grilling, handoff, teach, to-questionnaire, wait-what, writing-for-agents;
- misc: git-guardrails-claude-code, migrate-to-shoehorn, scaffold-exercises, setup-pre-commit. Si usano solo con "/" e restano fuori dal flusso automatico di Trama.

## Skill eseguite nel flusso di Trama

Trama esegue anche le skill incluse dentro il proprio flusso, con il testo originale (issue #118). `app/src/main/core/nativeSkills.ts` consegna `SKILL.md` e i file di riferimento accanto senza modifiche, seguiti da un collegamento di Trama separato che traduce i verbi generici della skill negli strumenti di Trama. Oggi le skill consegnate così sono `grill-with-docs`, `grilling` e `domain-modeling`, al Coordinatore (issue #119 e #120), e `to-spec` con `codebase-design`, al pianificatore che scrive il piano di una richiesta come spec (issue #121). Il controllo dei seam che `to-spec` chiede alla persona diventa la scheda del piano, dove la persona conferma o corregge i seam; la pubblicazione sull'issue tracker è una issue GitHub quando il progetto ha GitHub collegato. Scritta la spec, il divisore esegue `to-tickets` (issue #122) con lo stesso meccanismo: `SKILL.md` senza modifiche e un collegamento separato, `TO_TICKETS_BINDING` in `app/src/main/core/slices.ts`. La domanda di `to-tickets` alla persona sulla suddivisione diventa la parte "Fette verticali" della scheda del piano, dove la persona conferma le fette o le corregge; ogni correzione è un nuovo giro del divisore. La pubblicazione è una issue GitHub per fetta, in ordine di dipendenza, con il template della skill, la spec come genitore e i blocchi anche come dipendenza nativa di GitHub, quando il progetto ha GitHub collegato; altrimenti le fette restano in Trama. "Work the frontier" diventa la regola di assegnazione di Trama: solo fette con i blocchi fatti, al massimo tre sviluppatori insieme. Con il lavoro automatico dei ruoli fissi (issue #148) si aggiungono `triage`, `diagnosing-bugs` e `improve-codebase-architecture`, con i collegamenti in `app/src/main/core/duties.ts`.

Lo sviluppatore che lavora una fetta esegue `implement` e `tdd` (issue #123), con lo stesso meccanismo: `SKILL.md` di entrambe e i file di riferimento di `tdd` (`tests.md`, `mocking.md`) senza modifiche, seguiti dai collegamenti separati `IMPLEMENT_BINDING` e `TDD_BINDING` in `app/src/main/core/implementation.ts`. Con Codex i due `SKILL.md` arrivano come input `skill` del turno; con gli altri provider tutto il testo entra nelle istruzioni della sessione. Il messaggio dell'incarico contiene la fetta, la sua spec e i seam confermati dalla persona sulla scheda del piano, numerati: sono i "pre-agreed seams" di `implement` e la conferma che `tdd` chiede all'utente. Senza seam confermati lo sviluppatore non scrive test nuovi. "Use /code-review" diventa la revisione tecnica di Trama da un thread distinto, dopo che il candidato è dichiarato; "Commit your work" diventa il candidato che Trama cattura dal worktree. L'elenco dei seam testati alla fine della risposta (riga `Tested seams:`) è un'aggiunta di Trama: Trama lo copia sul candidato come dichiarazione dello sviluppatore, mai come evidenza. Il via libera e l'approvazione restano bloccati finché Trama non ha eseguito e visto passare le verifiche richieste dell'incarico; il Coordinatore le sceglie e per una fetta deve indicare il typecheck e i test del progetto quando esistono.

Il Coordinatore riceve le sue tre skill in quest'ordine, ciascuna con il proprio collegamento (`COORDINATOR_SKILLS` in `app/src/main/core/coordinatorTools.ts`). `domain-modeling` arriva con i suoi file di riferimento `CONTEXT-FORMAT.md` e `ADR-FORMAT.md`. Il Coordinatore è in sola lettura: quando una decisione del Patto chiarisce un termine o merita un ADR, lo propone con lo strumento `propose_domain_docs`. Trama controlla la proposta sul formato dei file di riferimento e la mostra come scheda. I file li scrive il ruolo fisso Documentazione e dominio, con la stessa skill e il collegamento `DOMAIN_WRITING_BINDING` in `app/src/main/core/duties.ts`, in un incarico con worktree proprio e solo dentro il mandato. Senza mandato la proposta aspetta. Il risultato si rivede come candidato. Lo strumento `propose_domain_docs` e il controllo del formato sono aggiunte di Trama.

Ask Trama (issue #130) esegue `ask-trama`, cioè `ask-matt` con il nome di Trama, con lo stesso meccanismo: `SKILL.md` e `PHASE-BOUNDARIES.md` senza modifiche e il collegamento separato `ASK_TRAMA_BINDING` in `app/src/main/core/askTrama.ts`. Il Coordinatore la riceve insieme alle altre sue skill (`COORDINATOR_SKILLS`), così sceglie il percorso anche quando una richiesta diventa lavoro senza il comando. La persona la chiama con `/ask-trama` nel composer, che la mostra in ogni progetto con la descrizione della skill originale, o con il pulsante Ask Trama accanto agli allegati. Invece di dire quale comando lanciare, il Coordinatore propone il percorso con lo strumento `propose_route`, un'aggiunta di Trama: la scheda elenca i passi e per ognuno dice come Trama lo esegue. Un passo con un flusso di Trama (grilling, glossario e ADR, piano come spec, fette verticali, incarichi con `implement` e `tdd`, revisione del candidato e focus mode, triage, diagnosi, revisione dell'architettura) parte con gli strumenti di quel flusso. Una skill del pacchetto senza un flusso di Trama arriva al Coordinatore con il testo originale insieme al messaggio di avvio, seguita dal collegamento `skillInRouteBinding`. Una skill citata da `ask-trama` che il pacchetto non contiene compare come "Non ancora disponibile in Trama" e non viene simulata; con la release v1.2.3 il pacchetto contiene tutte le skill citate. I confini di fase di `PHASE-BOUNDARIES.md` diventano sessioni del Coordinatore: "Continua" e "Subagent" lasciano la sessione com'è, perché il lavoro separato va al pianificatore, a uno sviluppatore, al revisore o a un ruolo fisso; `/clear` apre una sessione nuova con lo studio e la memoria, senza la conversazione; `/compact` e `/handoff` aprono una sessione nuova che riceve la trascrizione della conversazione scritta da Trama. Il percorso parte solo quando la persona preme "Avvia il percorso".

## Nomi cambiati

Il metodo e il testo delle istruzioni restano quelli originali. Cambiano solo questi nomi e riferimenti al marchio:

| Originale | In Trama |
| --- | --- |
| `ask-matt` (cartella, nome e ogni riferimento) | `ask-trama` |
| `setup-matt-pocock-skills` (cartella, nome e ogni riferimento) | `setup-trama` |
| `# Ask Matt` | `# Ask Trama` |
| `display_name: "Ask Matt"` | `display_name: "Ask Trama"` |
| `# Setup Matt Pocock's Skills` | `# Setup Trama` |
| `display_name: "Setup Matt Pocock Skills"` | `display_name: "Setup Trama"` |
| `Label in mattpocock/skills` (intestazione in `setup-trama/triage-labels.md`) | `Label in Trama` |

L'elenco leggibile dalla macchina di ogni sostituzione, file per file, con l'hash SHA-256 del file originale, è in `app/resources/AIHero/bundle.json`. Il test `app/src/main/core/skillBundle.test.ts` annulla le sostituzioni dichiarate e confronta ogni file con l'hash originale. Con la variabile `AIHERO_UPSTREAM` che punta a una copia locale della release, lo stesso test confronta anche i file byte per byte.

## Aggiornare il pacchetto

Da `app/`, con una copia della release al commit indicato:

```sh
node scripts/sync-aihero.mjs <percorso-della-copia>
```

Lo script ricopia le skill, applica solo le sostituzioni dichiarate e riscrive `bundle.json`. Un cambio di release richiede di aggiornare anche `SKILL_VERSION` in `app/src/main/core/skillSetup.ts` e questo documento.

## Progetti configurati con i vecchi nomi

Quando Trama aggiorna il metodo in un progetto preparato con `ask-matt` e `setup-matt-pocock-skills`, i file che Trama aveva scritto e che nessuno ha cambiato passano ai nuovi nomi, con una copia di sicurezza in `.agents/skills/.trama-backup/`. I file cambiati dalla persona restano dove sono e compaiono tra gli avvisi. "Annulla l'ultimo aggiornamento del metodo" ripristina i vecchi file e toglie quelli creati dall'aggiornamento, salvo quelli modificati nel frattempo.
