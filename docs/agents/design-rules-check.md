# Controllo delle regole di design in CI

Il controllo segnala le violazioni delle regole di design solo nelle **righe che una pull request aggiunge o modifica** in `app/src/renderer/**/*.tsx` e `*.css`. Il codice che non si tocca non viene segnalato: il codice nuovo segue le regole, quello vecchio migliora quando lo si modifica. Le regole sono in [design-rules.md](design-rules.md) (PR #488, se non è ancora su `main`).

Lo script è `app/scripts/check-design-rules.mjs`, senza dipendenze oltre a Node. Lo esegue il job `design-rules` del workflow `.github/workflows/design-rules.yml` su ogni pull request. I suoi test (vitest) girano nel controllo `test` insieme agli altri.

## Come si esegue in locale

```
node app/scripts/check-design-rules.mjs origin/main
```

Confronta la copia di lavoro con il punto in cui il branch si è staccato da `origin/main`, quindi conta anche le modifiche non ancora committate (non i file nuovi non ancora aggiunti con `git add -N`). Senza `--enforce` stampa le segnalazioni e termina sempre con codice 0.

## Cosa segnala

| Regola | Livello | Cosa cerca |
|---|---|---|
| `spacing-scale` | avviso | Spaziature Tailwind fuori dalla griglia di 8 px (`p-3`, `px-2.5`, `gap-1.5`, `size-3.5`): ammessi 0, 0.5, 1 e i valori pari (2, 4, 6, 8, 12, 16 e così via). Vale per `p`, `m`, `gap`, `space`, `w`, `h`, `size` e i loro `min-`/`max-` |
| `arbitrary-pixel-value` | errore | Valori arbitrari in pixel (`p-[13px]`, `w-[37px]`, `text-[11px]`). Esclusi `0px` e i breakpoint `min-[560px]:` |
| `raw-color` | errore | Colori esadecimali e `rgb()`, `hsl()`, `oklch()` e simili scritti nel codice. Sono permessi `var(--token)`, le dichiarazioni `--nome:` di `index.css`, i riferimenti `url(#id)` e le maschere (`mask`) |
| `gradient` | errore | `bg-gradient-*`, `bg-linear-*`, `linear-gradient(` e simili, tranne nelle dichiarazioni dei token e nelle maschere |
| `second-filled-button` | errore | `<Button variant="default">` fuori da `WaitingView.tsx` e `WaitingPointer.tsx`, dove sta l'unico pulsante pieno (ADR 0018) |
| `untranslated-text` | avviso | Testo tra i tag JSX sulla stessa riga, o negli attributi `title`, `aria-label`, `placeholder`, `alt`, senza `t()` |
| `ignore-without-reason` | errore | Un commento `design-rules-ignore:` senza motivo |

Limiti noti, pensati per evitare falsi allarmi:

- `second-filled-button` segnala solo `variant="default"` scritto in modo esplicito. Un `<Button>` senza `variant` è pieno per default, ma `FilledScope` (ADR 0018, `ui/button.tsx`) lo disegna già a contorno fuori da Aspetta te, e nei dialoghi è la regola normale per la primaria: segnalarlo sarebbe rumore.
- `untranslated-text` legge una riga alla volta: il testo JSX che va a capo non viene visto.
- Le righe dentro un commento a blocchi (`/* ... */`) e i commenti di riga non vengono controllati.

## Come si esclude una riga

Un commento `design-rules-ignore: <motivo>` sulla stessa riga, oppure da solo sulla riga sopra, spegne tutte le regole per quella riga. Il motivo è obbligatorio: senza, l'esclusione non vale e compare l'errore `ignore-without-reason`.

```tsx
{/* design-rules-ignore: allineato al bordo nativo della barra del titolo */}
<div className="h-[35px]" />
<path fill="#D97757" /> {/* design-rules-ignore: colore del marchio del provider */}
```

## Da avviso a errore

All'inizio il controllo non blocca nulla: il job è verde e le segnalazioni compaiono come annotazioni sulle righe della pull request (`::warning`). Il job `design-rules` non è il controllo richiesto `test`.

Per passare a errore servono due passi, nell'ordine:

1. In `.github/workflows/design-rules.yml` aggiungere `--enforce` al comando: `node app/scripts/check-design-rules.mjs --enforce "$BASE_SHA"`. Da quel momento le regole di livello errore diventano `::error` e fanno fallire il job. Le regole di livello avviso (`spacing-scale`, `untranslated-text`) restano avvisi.
2. Nelle impostazioni del branch `main`, aggiungere `design-rules` ai controlli richiesti (lo fa la persona). Finché non è richiesto, un job rosso non impedisce l'unione. Quando lo diventa, il workflow non deve avere filtri sui percorsi (`paths`): un job saltato non riporta l'esito e bloccherebbe le PR.

Per alzare di livello una regola cambiare `level` in `RULES` nello script.
