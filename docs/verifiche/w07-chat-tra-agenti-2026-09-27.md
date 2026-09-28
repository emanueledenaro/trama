# Chat tra agenti, 27 settembre 2026 (W07)

Registro della prova dell'interfaccia per la issue #144. Le schermate vengono da `node scripts/ui-check.mjs` con Codex e GitHub CLI finti: nessun provider reale.

Le conversazioni sono in sola lettura e non stanno nella barra laterale, secondo la decisione Q32 della specifica #239: la persona parla solo con il Coordinatore.

## Metodo

- "Prima": `main` a cf7eede, passo W06 dell'ui-check (`19h-developer-question-resumed`). La domanda dello sviluppatore e la risposta esistono solo dentro la scheda dell'incarico.
- "Dopo": il branch della issue unito a `origin/main` a 7763d2d (chat unica e barra laterale pulita incluse), passo W07 dell'ui-check subito dopo W06 (`19j` a `19m`).
- Il passo W07 controlla: nessuna conversazione nella barra laterale; il collegamento "Chat tra agenti" nella scheda dell'incarico; gli autori dei messaggi nell'ordine sviluppatore, Coordinatore, persona (la risposta sulla scheda del Patto); il tag colorato dello sviluppatore; nessun campo di testo né pulsante per scrivere; l'elenco delle conversazioni nella scheda dello specialista.

## Schermate

| File | Cosa mostra |
| --- | --- |
| `w07-chat-tra-agenti/01-prima-barra-laterale.png` | Prima: la domanda e la risposta solo nella scheda dell'incarico |
| `w07-chat-tra-agenti/02-dopo-conversazione.png` | La conversazione tra Ada e il Coordinatore, aperta dalla scheda dell'incarico |
| `w07-chat-tra-agenti/03-codex-chiaro.png` | Tema chiaro di Codex |
| `w07-chat-tra-agenti/04-codex-scuro.png` | Tema scuro di Codex |
| `w07-chat-tra-agenti/05-claude-chiaro.png` | Tema chiaro di Claude Agent |
| `w07-chat-tra-agenti/06-claude-scuro.png` | Tema scuro di Claude Agent |
| `w07-chat-tra-agenti/07-scheda-dello-specialista.png` | Le conversazioni di Ada nella sua scheda |

## Limiti

I messaggi dei revisori del candidato e del guardiano delle regressioni nascono alla fine del gate dei revisori (W10) e sono coperti dai test in `app/src/main/core/agentThreads.test.ts`, non da una schermata dedicata.
