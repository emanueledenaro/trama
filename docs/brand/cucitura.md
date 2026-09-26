# La cucitura

La cucitura è il bordo tratteggiato dei bot degli agenti (W16). Trama la usa anche nell'interfaccia come tratto riconoscibile, con misura (W17, issue #215).

## Token

I parametri sono quelli della cucitura dei bot, nel riquadro di 216 unità del loro SVG. In `app/src/renderer/index.css`:

| Token | Valore | Significato |
| --- | --- | --- |
| `--bot-seam-width` | 3.5 | Spessore del punto nei bot |
| `--bot-seam-dash` | 7 | Lunghezza di un punto nei bot |
| `--bot-seam-gap` | 8 | Spazio tra due punti nei bot |
| `--seam-scale` | 96 / 216 | L'interfaccia disegna la cucitura come un bot alla misura massima, 96 px |
| `--seam-width`, `--seam-dash`, `--seam-gap` | circa 1,6 px, 3,1 px, 3,6 px | I tre valori dei bot moltiplicati per la scala |
| `--seam-color` | l'accento del provider | Colore dal tema e dal provider; l'agente passa il suo colore quando la cucitura riguarda un agente |
| `--seam-radius` | dal contenitore | Angoli arrotondati come l'elemento che la cucitura segue |

Il punto ha le estremità arrotondate, come nei bot. La cucitura è un SVG, senza immagini, e funziona in chiaro e in scuro perché prende il colore dal tema.

## Componente

`useSeam(uso, opzioni)` in `app/src/renderer/components/Seam.tsx` restituisce `shown` e `stitch`. `stitch` è il contorno da mettere dentro l'elemento, che deve avere `position: relative`. Gli usi ammessi sono elencati in `app/src/renderer/lib/seam.ts`, ciascuno con la sua priorità.

## Usi

| Uso | Dove | Cosa dice |
| --- | --- | --- |
| `fileDrop` | Il composer mentre si trascinano immagini | Qui arrivano le immagini. Accanto c'è il testo "Rilascia le immagini per allegarle al messaggio" |
| `focus` | Il task in focus nella barra di focus | Questo è il lavoro in corso. Accanto ci sono l'icona di focus, il titolo e la fase |
| `firstGoal` | Il riquadro "Formula il primo obiettivo" nel dialogo del progetto | Qui va il primo obiettivo. Accanto ci sono l'icona e il testo |
| `logo` | Il marchio di Trama nella schermata iniziale | Trama è cucita come i suoi agenti |

## Regola d'uso

- Al massimo una cucitura visibile per schermata. Se due usi sono presenti insieme, la disegna quello con la priorità più alta (nell'ordine della tabella) e l'altro resta com'era, per esempio il primo obiettivo torna al bordo tratteggiato normale.
- Mai su bottoni, liste o card normali, e mai come semplice bordo decorativo. Un nuovo uso entra solo aggiungendolo a `SeamUse` con la sua motivazione, e gli usi restano tra tre e cinque.
- La cucitura non è mai l'unico segnale di uno stato: accanto c'è sempre testo o un'icona.
- Con il contrasto alto (`prefers-contrast: more`) la cucitura diventa un bordo continuo e pieno. Con i colori forzati usa anche il colore del testo di sistema.

## Verifiche

`app/src/renderer/lib/seam.test.ts` controlla la priorità tra gli usi, i parametri presi dai bot e il bordo continuo con il contrasto alto. `npm run ui-check` controlla che su ogni schermata con un uso ci sia una sola cucitura visibile, quella attesa, che il contrasto alto e i colori forzati tolgano il tratteggio e salva le schermate `21-seam-*` in chiaro e in scuro.
