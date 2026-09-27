# Chat tra agenti, 27 settembre 2026 (W07)

Registro della prova dell'interfaccia per la issue #144. Le schermate vengono da `node scripts/ui-check.mjs` con Codex e GitHub CLI finti: nessun provider reale.

## Metodo

- "Prima": `main` a cf7eede, passo W06 dell'ui-check (`19h-developer-question-resumed`). La domanda dello sviluppatore e la risposta esistono solo dentro la scheda dell'incarico; la barra laterale non ha conversazioni tra agenti.
- "Dopo": il branch della issue con `origin/main` a 2257d52 unito, passo W07 dell'ui-check subito dopo W06 (`19j` a `19m`).
- Il passo W07 controlla: la riga della conversazione nella barra laterale; gli autori dei messaggi nell'ordine sviluppatore, Coordinatore, persona; il tag colorato dello sviluppatore; il pulsante "Scrivi nella conversazione" a destra e unico primario; il messaggio della persona con lo stato di consegna; il turno successivo del Coordinatore che riceve il messaggio; lo stato "Letto dal Coordinatore"; l'attività registrata nella cronologia del progetto.

## Schermate

| File | Cosa mostra |
| --- | --- |
| `w07-chat-tra-agenti/01-prima-barra-laterale.png` | Prima: nessuna conversazione tra agenti nella barra laterale |
| `w07-chat-tra-agenti/02-dopo-conversazione.png` | La conversazione tra Ada e il Coordinatore, aperta dalla barra laterale |
| `w07-chat-tra-agenti/03-dopo-messaggio-della-persona.png` | Il messaggio della persona, in attesa del prossimo turno degli agenti |
| `w07-chat-tra-agenti/04-codex-scuro.png` | Tema scuro di Codex |
| `w07-chat-tra-agenti/05-claude-chiaro.png` | Tema chiaro di Claude Agent |
| `w07-chat-tra-agenti/06-claude-scuro.png` | Tema scuro di Claude Agent |
| `w07-chat-tra-agenti/07-letto-dal-coordinatore.png` | Dopo il turno del Coordinatore: "Letto dal Coordinatore" |

## Limiti

La risposta dello sviluppatore nella conversazione e i messaggi del revisore e del guardiano delle regressioni sono coperti dai test in `app/src/main/core/agentThreads.test.ts`, non da una schermata dedicata. Nelle schermate compaiono le righe "Revisione tecnica" nella barra laterale, nate dalle revisioni dei passi precedenti dell'ui-check.
