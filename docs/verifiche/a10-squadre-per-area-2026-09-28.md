# A10: squadre per area del prodotto e vista Squadre (2026-09-28)

Controllo di #250 sul branch `feature/issue-250-product-area-squads-ni9n0v`. Dalla specifica #239 (Q12, Q14, Q15, Q21, Q22, Q23, Q29) e dall'ADR 0017.

## Cosa esisteva già

- Team completo con i ruoli fissi e gli sviluppatori confermati (W09), identità degli agenti con colore e tag (W15), bot (W16).
- Un limite unico di sviluppatori in parallelo per progetto (W08), scelto nelle impostazioni, e la presa autonoma delle fette pronte.
- Ciclo autonomo dentro il mandato (#296): i passi che il Coordinatore fa da solo vanno in Attività e nel riepilogo, e la persona li corregge da Attività.
- Nessuna sessione cloud nel codice: un incarico non aveva un luogo di lavoro.

## Cosa cambia

- Squadre (`app/src/main/core/squads.ts`): dopo lo studio, e quando il team viene confermato, Trama forma una squadra per ogni area della Mappa con lavoro previsto (i moduli dei piani aperti, degli sviluppatori e dei loro incarichi non conclusi). Ogni squadra ha un capo squadra (ruolo nuovo `squadLead`, con un corpo del bot proprio), da uno a tre sviluppatori e un QA dedicato: il QA del progetto va alla prima squadra, le altre ricevono un QA proprio. Un'area prende prima uno sviluppatore che conosce i suoi moduli, poi uno libero; dentro il mandato (`composeTeam`) il Coordinatore aggiunge uno sviluppatore per l'area che non ne ha, altrimenti l'area aspetta. Un progetto il cui lavoro non nomina moduli ha una squadra "Prodotto". La formazione è idempotente: uno studio successivo aggiunge solo le aree nuove e mette in squadra solo gli sviluppatori che non ne hanno.
- Attività e riepilogo: la formazione è un passo del Coordinatore ("Squadre formate dal Coordinatore", "Dopo lo studio"), con i membri di ogni squadra. La correzione da Attività va al Coordinatore.
- Limiti (`app/src/shared/squads.ts`): sviluppatori al lavoro per squadra e squadre al lavoro insieme, tre e tre, nelle impostazioni del progetto (da 1 a 6). Il limite di sviluppatori in parallelo scelto prima delle squadre vale come limite per squadra. `assign_task`, la ripresa dopo una domanda e la ripresa dopo il cancello rifiutano il lavoro oltre i limiti. Ogni incarico in corso conta, anche con `workplace: "cloud"`.
- Scelta delle fette: una fetta appartiene alla squadra della sua area; finché quella squadra ha sviluppatori, la prendono solo loro, e anche `assign_task` rifiuta di darla a un'altra squadra. Due fette sugli stessi moduli non vanno in lavoro insieme, anche in squadre diverse. Una fetta che aspetta per i limiti lo dice con il motivo.
- Vista Squadre (`app/src/renderer/components/inspector/TeamView.tsx`): sostituisce Team nella barra laterale, nell'intestazione e nella ricerca. Per ogni squadra l'area, la riga di stato della squadra, il capo squadra, gli sviluppatori e il QA; i ruoli condivisi in una sezione a parte; gli sviluppatori fuori dalle squadre, se ci sono, in una sezione loro. Rinomina e colore restano nella scheda dell'agente, che dice anche la squadra.
- Il Coordinatore legge squadre, riga di stato e limiti in `read_team`.

## Verifiche

- Test: `app/src/main/core/squads.test.ts` (formazione per area, QA e capo squadra, ruoli condivisi, passo in Attività e nel riepilogo, idempotenza, squadra "Prodotto", sviluppatore aggiunto solo dentro il mandato, migrazione di un team di prima con sei sviluppatori, limite per squadra, limite di squadre attive, incarico in una sessione cloud, fetta alla squadra della sua area, fette sugli stessi moduli, motivo dell'attesa), `app/src/main/team.integration.test.ts` (squadre dopo la conferma del team; un progetto salvato senza squadre si riapre senza errori e le riceve), `app/src/shared/roster.test.ts`, `app/src/main/core/slices.test.ts`.
- ui-check, passi nuovi e adattati: `04e-squads` (squadra con capo, sviluppatore, QA e riga di stato; ruoli condivisi a parte, senza il QA della squadra; niente più elenco per momenti), `04e1-squads-shared-roles`, `15b-activity` (il passo "Squadre formate dal Coordinatore"), `22a` e `22b` (i due limiti nelle impostazioni), tutti in chiaro e in scuro. Rinomina e colore passano come prima.
- Schermate in `docs/images/a10/`: prima con la build di main a `6aa7f7b`, dopo con questo branch unito a main `d550ab7`. Le correzioni della revisione non cambiano quelle schermate.
- Revisione automatica della PR #306: `assign_task` rifiuta il lavoro sull'area di un'altra squadra finché quella squadra ha sviluppatori; una squadra si riempie fino a tre sviluppatori qualunque sia il limite di sviluppatori al lavoro; la capacità del progetto conta gli sviluppatori fuori dalle squadre come una squadra in più; una fetta pronta ferma per i limiti mostra il motivo nell'elenco delle fette ("In attesa: ...").
- Risultati su Linux nel container (xvfb), dopo il merge di main `6b6e33a`: `tsc` senza errori, `vitest` 132 file e 1266 test passati (3 saltati), `npm run build` ok, `ui-check` completato con 357 schermate.

Non verificato: rinominare, unire o dividere una squadra (la persona lo chiede al Coordinatore, che non ha ancora uno strumento per farlo); sessioni cloud reali, che non esistono ancora nel codice; nessuna esecuzione reale di Codex.
