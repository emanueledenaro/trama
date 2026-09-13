# Sistema visivo di Trama

Trama usa controlli, materiali, colori e caratteri di sistema macOS. Questa guida raccoglie le misure condivise dalle viste SwiftUI; non sostituisce il comportamento adattivo dei controlli Apple.

## Spaziatura

| Nome | Punti | Uso |
| --- | ---: | --- |
| `compact` | 6 | Titolo e sottotitolo, elementi strettamente collegati |
| `control` | 10 | Controlli nella stessa riga e contenuto interno compatto |
| `related` | 12 | Elementi dello stesso gruppo e margini secondari |
| `section` | 20 | Gruppi distinti e distanza verticale dell’intestazione |
| `content` | 24 | Margine laterale delle schermate e contenuto principale |

I valori vivono in `TramaSpacing`. Una vista usa un valore diverso solo quando la misura appartiene al controllo, come la dimensione di una scheda della mappa o l’altezza limitata di un diff.

## Forme

`TramaRadius.control` usa 8 punti per campi, riquadri tecnici e icone. `TramaRadius.card` usa 12 punti per schede e contenitori principali. Capsule, interruttori e controlli macOS conservano la forma fornita dal sistema.

## Gerarchia

`TramaScreenHeader` allinea titolo, sottotitolo e azioni di Mappa, Issue, Gruppo e Decisioni. Il titolo usa `title2` semibold, il sottotitolo usa `callout` secondario e le azioni restano sulla guida superiore. Il contenuto successivo parte dallo stesso margine di 24 punti.

Titoli delle sezioni interne usano `headline`, il contenuto usa `body` o `callout`, e metadati, versioni, percorsi sintetici e spiegazioni accessorie usano `caption`. Il testo tecnico usa il carattere monospaziato di sistema.

`TramaSupportingText` presenta spiegazioni che devono restare leggibili con `callout` e colore secondario. `caption` resta riservato a metadati brevi come ora, versione, modello e SHA. `TramaLabeledText` dispone etichetta e valore in verticale per evitare righe centrate o compresse con contenuti lunghi.

Le intestazioni e i gruppi di azioni usano una guida sinistra comune. Quando manca spazio, le azioni passano sotto il testo senza centrare il blocco o ridurre il carattere.

## Stati

`TramaStatusBadge` mostra sempre testo e simbolo insieme al colore. Verde indica un risultato revisionato o superato, blu un’attività in corso, arancione una scelta o rivalutazione richiesta, rosso un errore. Gli altri stati usano il colore secondario. VoiceOver riceve l’etichetta `Stato: <valore>`.

Il colore non è l’unico segnale. Gli errori conservano il testo completo, i controlli disabilitati mantengono l’etichetta e gli esiti delle verifiche mostrano un simbolo con la descrizione.

## Verifica corrente

Il 13 settembre 2026 la build QA è stata controllata in tema scuro e chiaro, in finestra ampia e stretta. Le intestazioni condivise risultano allineate. Gli stati della lista richieste e del dettaglio conservano testo, simbolo e colore. Lo stato vuoto delle Issue inizialmente centrava l’intera vista a metà finestra; ora l’intestazione resta in alto e il contenuto vuoto occupa l’area disponibile.

La prima prova del tema chiaro ha rilevato che la finestra principale cambiava aspetto mentre Impostazioni restava nel tema di sistema. La stessa preferenza viene ora applicata a entrambe le scene; la build riavviata ha mostrato Impostazioni in tema chiaro. Al termine della prova è stata ripristinata l’opzione Sistema.

Il secondo controllo ha attivato temporaneamente Aumenta contrasto e Riduci la trasparenza nelle impostazioni di macOS. Selezione, testi, schede, materiali e contorni sono rimasti leggibili; entrambe le preferenze sono state ripristinate al valore iniziale. Restano da verificare focus completo da tastiera, VoiceOver, tutte le finestre modali e una raccolta esportata del confronto visivo. Il ticket #22 rimane aperto fino a quelle prove.
