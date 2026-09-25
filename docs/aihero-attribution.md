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

Trama esegue anche le skill incluse dentro il proprio flusso, con il testo originale (issue #118). `app/src/main/core/nativeSkills.ts` consegna `SKILL.md` e i file di riferimento accanto senza modifiche, seguiti da un collegamento di Trama separato che traduce i verbi generici della skill negli strumenti di Trama. Oggi le skill consegnate così sono `grilling`, al Coordinatore, e `to-spec` con `codebase-design`, al pianificatore che scrive il piano di una richiesta come spec (issue #121). Il controllo dei seam che `to-spec` chiede alla persona diventa la scheda del piano, dove la persona conferma o corregge i seam; la pubblicazione sull'issue tracker è una issue GitHub quando il progetto ha GitHub collegato.

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
