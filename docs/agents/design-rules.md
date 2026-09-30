# Regole di design dell'interfaccia

Valgono per ogni schermata, componente o testo dell'interfaccia che si crea o si modifica in `app/src/renderer`. Il codice che non si tocca non si riscrive per applicarle.

## Ordine di precedenza

1. I token, le misure e i componenti che esistono già in `app/src/renderer` (ADR 0011). Prima di creare uno stile o un componente si cerca quello esistente. Non si duplica.
2. Le regole delle schermate: [ADR 0018](../adr/0018-finestra-a-barra-delle-attivita.md) e [principi.md](../design/schermate-2026-09-28/principi.md): una domanda per zona, un solo pulsante pieno nella finestra, azioni a destra con la primaria per ultima, icone per le azioni secondarie, niente ripetizioni.
3. Questo documento, che riempie i vuoti e vale per tutto il codice nuovo.

Dove questo documento e l'app di oggi non coincidono, vale la sezione [Convivenza con l'app di oggi](#convivenza-con-lapp-di-oggi).

## Principi

### Struttura e layout

- **Gerarchia visiva.** Gli elementi importanti spiccano per dimensione, contrasto o posizione. La cosa che la persona deve fare viene prima del resto.
- **Allineamento e griglia.** Niente è messo a caso: ogni elemento sta su una griglia (vedi la regola 1).
- **Prossimità.** Gli elementi legati stanno vicini, quelli diversi sono separati in modo chiaro.
- **Spazio vuoto.** Lo spazio vuoto riduce il carico di lettura e dà enfasi ai contenuti. Non si riempie per riempire.

### Tipografia

- Al massimo due famiglie di font: una per i titoli, una per il corpo.
- Una scala fissa di dimensioni (titolo, sottotitolo, corpo, nota), usata sempre allo stesso modo.
- Interlinea tra 1,4 e 1,6 nel testo esteso. Righe di lettura non troppo lunghe.

### Colore e contrasto

- Regola 60-30-10: 60% neutri, 30% struttura e testo, 10% accento.
- Il colore ha un significato e lo mantiene: rosso per errore e pericolo, verde per successo e conferma. Un pulsante non prende il colore di uno stato.
- Contrasto tra testo e sfondo almeno WCAG AA.

### Usabilità

- **Coerenza.** Stessi stili, stesse forme di pulsante, stessi comportamenti in tutte le schermate. La persona non deve reinterpretare l'interfaccia a ogni cambio di vista.
- **La funzione guida la forma.** Un pulsante che non sembra un pulsante è un difetto, anche se è bello.
- **Feedback immediato.** L'interfaccia dice sempre cosa sta succedendo: caricamento, esito, passaggio del mouse, salvataggio.

## Regole misurabili

### 1. Spaziatura su griglia di 8 px

- `margin`, `padding`, `gap`, `height` e `width` sono multipli di 8 px: 8, 16, 24, 32, 48, 64.
- Niente valori arbitrari (`p-[13px]`) e niente multipli dispari, salvo un allineamento minimo che si spiega in un commento.

### 2. Raggi dei bordi

- Un solo raggio per i componenti principali di una schermata, lo stesso ovunque.
- Un elemento dentro un contenitore arrotondato ha raggio uguale al raggio del padre meno il padding. Così gli angoli restano paralleli.

### 3. Palette limitata

- 60% sfondo e base neutra. 30% struttura: testo, bordi, divisori, con grigi scuri e non nero puro su bianco puro. 10% accento, un solo colore per gli elementi interattivi.
- Niente gradienti casuali, sfumature arcobaleno o colori che non stanno nei token del progetto.

### 4. Tipografia

- Salti di dimensione netti e proporzionati, presi dalla scala dei token del renderer.
- Interlinea del testo esteso tra 1,4 e 1,6.

### 5. Stati e accessibilità

- Ogni elemento cliccabile ha un'area d'uso minima (vedi la sezione sotto sulla misura).
- Contrasto minimo WCAG AA.
- Ogni componente che mostra dati ha quattro stati, tutti provati in `npm run ui-check`:
  1. **Default.**
  2. **Caricamento:** scheletro o indicatore coerente con il resto.
  3. **Vuoto:** un messaggio chiaro e, se serve, una azione.
  4. **Errore:** con il rosso di sistema per i feedback negativi.

### 6. Coerenza con il codice

Si controllano prima le classi globali e i componenti riutilizzabili del renderer. Un nuovo stile si crea solo se non esiste.

## Convivenza con l'app di oggi

Alcune misure di queste regole non coincidono con quelle già in uso nel renderer. Finché la persona non decide altrimenti, per il codice nuovo si fa così. La colonna «Da confermare» dice cosa cambierebbe.

| Regola | Nell'app di oggi | Come si applica per ora | Da confermare |
|---|---|---|---|
| Griglia di 8 px | Molte misure a 4 px e a mezzo passo (`gap-1.5`, `px-2.5`), intestazione di 46 px (ADR 0011) | Tra blocchi e zone si usano 16, 24, 32. Dentro i componenti compatti già esistenti si riusa il componente com'è | Se la griglia vale anche dentro i componenti compatti |
| Area d'uso di 44 px | App desktop densa: pulsanti alti 32 px, pulsanti a icona di 24 e 28 px | Un elemento nuovo ha almeno 32 px di area d'uso, con il padding che allarga la zona cliccabile | Se 44 px vale anche sul desktop o solo dove c'è il tocco |
| Scala tipografica (32, 20, 14) | Token `--text-ui` e simili in `app/src/renderer/index.css`, da 9 a 14 px | Si usano i token esistenti. Non si introducono dimensioni nuove | Se serve una scala più ampia per i titoli |
| Un solo accento | Colore d'accento dell'interfaccia, più i 9 colori di identità degli agenti e i colori di stato | Vale per gli elementi interattivi. I colori degli agenti e di stato sono eccezioni previste e non sono accenti | Niente |
| Rosso per errore e pericolo | Variante `destructive` del pulsante | Il rosso pieno resta alle azioni che non si annullano e agli errori. Approva e Rifiuta restano neutri | Niente |

## Prima di consegnare

- La schermata risponde a una sola domanda per zona.
- Ogni elemento ha una ragione: chi ne ha bisogno, perché sta lì, quando non c'è.
- Le azioni stanno a destra, la primaria per ultima, e c'è un solo pulsante pieno nella finestra.
- Ogni testo nuovo sta nei due cataloghi di `app/src/shared/messages`.
- `npm run ui-check` include la schermata nuova, in chiaro e in scuro, stretta e larga.
