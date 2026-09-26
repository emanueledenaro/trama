# Marchio di Trama

Il logo di Trama è una "T" fatta di due nastri che si intrecciano, come i fili della trama di un tessuto. La persona lo ha scelto il 26 settembre 2026 (issue #199). Le immagini di partenza sono in `source/`: `app-icon.webp` è l'icona con la piastrella, `glyph-variants.webp` il simbolo a colori, bianco e nero.

Il simbolo vettoriale è ricostruito dalla versione nera, che ha i contorni netti. Barra, estremità arrotondate e angoli dell'anello in basso sono geometria esatta e simmetrica. Le curve seguono punti misurati sulla sorgente ogni 10 unità e poi lisciati. Dove un nastro passa sotto l'altro resta uno stacco di 7 unità su 560. La sovrapposizione con la versione nera è del 98,4% (IoU, in `previews/misure.json`), e `previews/sovrapposizione.png` mostra in rosso e in blu i pixel che non coincidono.

## File

| File | Cosa contiene | Dove si usa |
|---|---|---|
| `trama-glyph-color.svg` | Simbolo a colori: sfumatura, lato interno scuro negli stacchi e nei due fori, ombre agli incroci | Temi chiari, documenti, presentazioni |
| `trama-glyph-white.svg` | Simbolo bianco con ombre trasparenti | Temi scuri e fondi colorati |
| `trama-glyph-mono.svg` | Simbolo in `currentColor`, con gli stacchi | Dove il colore viene dal CSS |
| `trama-glyph-small.svg` | Simbolo semplificato in `currentColor`: senza stacchi né riga sottile, nastri più spessi | 16, 24 e 32 px |
| `trama-app-icon.svg` | Icona dell'app sulla griglia macOS: piastrella di 824 su 1024 con 100 px di margine | Sorgente del file `.icns` |
| `trama-app-icon-small.svg` | Come sopra, con il simbolo semplificato | `.icns` a 16 e 32 px |
| `trama-app-icon-square.svg` | Piastrella di 940 su 1024 | `.ico` e PNG per Windows e Linux, README |
| `trama-app-icon-square-small.svg` | Come sopra, con il simbolo semplificato | `.ico` e PNG fino a 32 px |
| `previews/` | Confronto con la sorgente, sovrapposizione, misure piccole | Verifica del disegno |
| `tools/` | Script che genera tutti i file sopra | Vedi "Rigenerare i file" |

File generati nell'app:

- `app/resources/icons/icon.icns`: 16, 32, 64, 128, 256, 512 e 1024 px, comprese le versioni @2x. `electron-builder` lo usa per macOS.
- `app/resources/icons/icon.ico`: 16, 24, 32, 48, 64, 128 e 256 px, per Windows.
- `app/resources/icons/png/`: un PNG per misura da 16 a 1024 px, per Linux.
- `app/src/renderer/public/favicon.svg` e `favicon.ico` (16, 32, 48 px): piastrella piena con il simbolo semplificato.
- `app/src/renderer/components/brand/tramaMarkGeometry.ts`: i tracciati usati dal componente `TramaMark`.

Fino a 32 px tutte le icone usano il simbolo semplificato.

## Colori

Campionati dalle immagini di partenza.

| Uso | Esadecimale |
|---|---|
| Sfumatura del simbolo, in basso a sinistra | `#3558FB` |
| Sfumatura del simbolo, al 45% | `#5A6BFC` |
| Sfumatura del simbolo, al 75% | `#8F86FA` |
| Sfumatura del simbolo, in alto a destra | `#CDAAFB` |
| Lato interno del nastro, in alto | `#1A2BC4` |
| Lato interno del nastro, in basso | `#040F63` |
| Ombra agli incroci | `#010E6E` |
| Piastrella, angolo in basso a sinistra | `#08157A` |
| Piastrella, centro | `#2333D6` |
| Piastrella, angolo in alto a destra | `#6C4DF9` |
| Piastrella, luce in alto a destra | `#D6B8FF` |
| Piastrella, luci in alto a sinistra e in basso a destra | `#3D55F5`, `#3A55FF` |
| Ombra del simbolo bianco sulla piastrella | `#1F33D6` |

La sfumatura del simbolo va dall'indaco al viola lungo la diagonale, dal basso a sinistra all'alto a destra. Quella della piastrella va dall'indaco scuro in basso a sinistra al viola in alto a destra, con una luce lilla nell'angolo in alto a destra.

Nell'interfaccia il simbolo segue il provider del dialogo (ADR 0011): i token `--trama-mark-*` in `app/src/renderer/index.css` ricavano la sfumatura dall'accento del provider (`--color-text-accent`) e dalla sua luce (`--glow-1`), in chiaro e in scuro. I colori fissi qui sopra valgono per l'icona dell'app, il README e la variante `palette="brand"` del componente.

## Spazio di rispetto e misure minime

- Intorno al simbolo lasciare almeno metà dell'altezza della barra: 72 unità su 560, cioè circa il 13% della larghezza del simbolo. Nella piastrella il simbolo occupa il 68% della larghezza.
- Sotto i 33 px usare il simbolo semplificato. Il componente `TramaMark` lo sceglie da solo.
- Il simbolo dettagliato rende bene da 40 px in su. Non scendere sotto i 16 px.

## Cosa non fare

- Non deformare il simbolo: nessuno schiacciamento, nessuna rotazione, nessuna inclinazione.
- Non ridisegnare gli incroci e non invertire quale nastro passa sopra.
- Non togliere gli stacchi nella versione dettagliata e non aggiungerli in quella semplificata.
- Non cambiare i colori della sfumatura nei file di marca. Nell'interfaccia i colori vengono solo dai token del provider.
- Non aggiungere contorni, ombre esterne, bagliori o effetti tridimensionali oltre a quelli già nei file.
- Non mettere il simbolo a colori su fondi che ne riducono il contrasto: su fondi scuri o colorati usare la versione bianca.
- Non accostare testo o altri segni dentro lo spazio di rispetto.

## Componente `TramaMark`

`app/src/renderer/components/brand/TramaMark.tsx` è l'unico modo di mostrare il marchio nell'app. L'API è stabile: la usano anche l'introduzione all'avvio, il benvenuto e la scelta del progetto (B02).

```tsx
<TramaMark size={24} variant="glyph" palette="provider" title="Trama" />
```

| Proprietà | Valori | Predefinito | Effetto |
|---|---|---|---|
| `size` | numero in pixel CSS | `24` | Lato del quadrato. Fino a 32 disegna il simbolo semplificato |
| `variant` | `"glyph"`, `"tile"`, `"mono"` | `"glyph"` | Simbolo con sfumatura e ombre; piastrella con il simbolo bianco; simbolo in `currentColor` |
| `palette` | `"provider"`, `"brand"` | `"provider"` | Colori del provider in uso, in chiaro e in scuro; oppure i colori fissi dell'icona |
| `title` | testo | nessuno | Nome accessibile. Senza titolo il marchio è decorativo e nascosto ai lettori di schermo |

Le altre proprietà SVG, come `className`, passano all'elemento `<svg>`. L'elemento ha gli attributi `data-trama-mark` (la variante) e `data-trama-mark-palette`.

Dove appare oggi:

- barra laterale, in alto accanto al nome: è lo spazio fisso del marchio;
- schermata iniziale e schermata del progetto aperto;
- guida introduttiva, nell'intestazione;
- Impostazioni, Generale, sezione Informazioni, con la versione dell'app.

## Rigenerare i file

Tutti i file sopra vengono da `tools/build_brand_assets.py`, che costruisce il simbolo con `tools/glyph_geometry.py`. Servono Python 3 con `numpy`, `scipy`, `skia-pathops` e `Pillow`, più `rsvg-convert` (librsvg).

```sh
pip install numpy scipy skia-pathops pillow
python3 docs/brand/tools/build_brand_assets.py
```

Lo script riscrive gli SVG, le icone dell'app, le favicon, i tracciati del componente e le immagini in `previews/`. Per cambiare il disegno si modifica `glyph_geometry.py`, non i file generati.

## Cucitura

La cucitura dei bot è l'altro tratto del marchio nell'interfaccia. Token, usi ammessi e regola d'uso sono in [cucitura.md](cucitura.md). Nella scelta del progetto la cucitura incornicia lo spazio del simbolo fuori dallo spazio di rispetto e non tocca il simbolo.
