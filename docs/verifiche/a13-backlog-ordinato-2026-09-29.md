# A13: backlog di ogni squadra ordinato, con l'ordine della persona che vince (2026-09-29)

Controllo di #253 sul branch `feature/issue-253-ordered-squad-backlog-nqt6o9`. Dalla specifica #239 (Q19, Q20, Q23) e dall'ADR 0017.

## Cosa esisteva già

- Squadre per area (A10, #306) e vista Squadre nella barra laterale (B04, #386).
- Presa autonoma delle fette pronte (W08): uno sviluppatore libero prendeva la prossima fetta pronta nell'ordine della suddivisione.
- Problemi trovati (A08): dopo il triage un problema senza incarico andava "nel backlog", visibile solo nel filtro "Nel backlog" delle issue. Nessun ordine, nessuna squadra.

## Cosa cambia

- Backlog per squadra (`app/src/main/core/backlog.ts`): le fette delle suddivisioni in corso che nessuno ha preso (pronte, bloccate, in pausa) e i problemi trovati messi nel backlog, ognuno nella squadra della sua area. Un rilievo di un revisore va nella squadra del modulo del file; una verifica rossa sul progetto, che non ha un'area, va nel backlog senza squadra. Senza squadre tutto il lavoro sta nel backlog del progetto.
- Ordine del Coordinatore: senza un suo ordine vale la regola di Trama, con il motivo in una riga (sblocca altre fette, verifica rossa, pronta nell'ordine della suddivisione, rilievo di un revisore, in pausa, aspetta S1). Il Coordinatore riordina con lo strumento nuovo `order_backlog`, un motivo per voce; le voci che non elenca seguono la regola dopo le sue. `read_team` mostra il backlog di ogni squadra, dall'alto.
- Ordine della persona (`app/src/shared/backlog.ts`): la persona sposta una voce su o giù e la posizione scelta resta sua. Un nuovo ordine del Coordinatore e le voci nuove riempiono solo i posti liberi. L'ordine sta nel documento del progetto (`backlog`), quindi resta dopo un riavvio. La persona può restituire una voce all'ordine del Coordinatore.
- Presa del lavoro: gli sviluppatori liberi prendono le fette dall'alto del backlog della loro squadra, saltando quelle bloccate e in pausa. Le squadre mantengono i loro turni: l'ordine cambia solo tra le fette della stessa squadra.
- Vista Squadre (`TeamView.tsx`): sotto le persone di ogni squadra una sezione chiusa "Backlog, N voci" che dice la voce in cima; aperta mostra le voci in ordine, con il motivo, i pulsanti Sposta giù e Sposta su a destra e, per una voce spostata dalla persona, il segno "Posizione scelta da te" con il pulsante per riportarla all'ordine del Coordinatore. Testi in italiano e in inglese nei cataloghi.

## Verifiche

- Test: `app/src/shared/backlog.test.ts` (ordine con le voci della persona, nuovo ordine del Coordinatore, voci nuove che non spostano quelle della persona, spostamento, restituzione) e `app/src/main/core/backlog.test.ts` (backlog per area con fette e problemi e motivo, posizione della persona dopo `order_backlog`, dopo una voce nuova e dopo salvataggio e riapertura; ordine rifiutato con voci estranee; sviluppatore libero che prende dall'alto saltando una fetta bloccata). I test esistenti di `squads.test.ts` e `slicePicking.test.ts` passano senza modifiche.
- ui-check, passo nuovo `22c1-squad-backlog`: il backlog della squadra con S2 e S3 nell'ordine del Coordinatore e i motivi, lo spostamento di S3 in cima con il segno della persona, i pulsanti a destra, nessuno scorrimento orizzontale, a 1280x800 e 1680x1050 in chiaro e in scuro, poi in inglese, poi la voce riportata all'ordine del Coordinatore (così la presa autonoma di S2 che segue resta come prima).
- Schermate in `docs/images/a13/`: prima con la build di main `48397bf` nello stesso punto del giro, dopo con questo branch unito a main `910dbfa`.

Non verificato: le issue aperte su GitHub che non vengono da un problema trovato o da una fetta non entrano nel backlog, perché oggi Trama non le lega a un'area; gli sprint (Q19) non esistono ancora, quindi "non ancora in uno sprint" vuol dire "non ancora preso". Nessuna esecuzione reale di Codex: l'ordine del Coordinatore è provato con lo strumento nei test.
