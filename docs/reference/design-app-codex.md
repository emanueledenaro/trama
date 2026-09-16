# Riferimento visivo: la app Codex di OpenAI

Il Product Owner ha scelto il 16 settembre 2026 la app Codex installata sul Mac come riferimento estetico della chat del Coordinatore. Synara resta il riferimento per le funzioni (collegamento provider, finestra di contesto, canale agente-host, timeline delle attività).

Fonte: foglio di stile del webview Codex dentro `ChatGPT.app` versione 26.908, letto dal bundle locale. I valori sotto sono quelli del tema Electron, non dell'estensione VS Code. Trama li riproduce con controlli SwiftUI e AppKit nativi, senza web view, come richiede l'ADR 0001.

## Impianto

- Font interfaccia: quello di sistema (`-apple-system`). Font codice: `ui-monospace`, SF Mono, Menlo. In SwiftUI corrispondono a `.body` e `.monospaced` senza font esterni.
- Dimensione testo chat: 13 px nella finestra desktop, 16 px nella versione web. Codice: `--text-sm`, 13 px.
- Larghezza massima della colonna del thread: 42 rem (672 px) per la conversazione, 48 rem (768 px) per le viste larghe.
- Altezza barra strumenti 46 px, barra piccola 36 px, righe elenco 30 o 36 px.
- Spaziatura base 4 px (`--spacing: .25rem`), multipli interi.

## Colori

Scala di grigi neutra, senza tinta. In modalità scura la scala si inverte: lo stesso nome indica il tono opposto.

| Ruolo | Chiaro | Scuro |
| --- | --- | --- |
| Superficie principale | `#ffffff` | `#181818` |
| Superficie secondaria (sidebar, menu) | `#f9f9f9` | `#212121` |
| Testo | `#282828` | `#dfdfdf` circa (gray-850 invertito) |
| Testo enfasi (prosa, titoli) | `#0d0d0d` | `#ffffff` circa |
| Testo secondario | `#5d5d5d` | `#8f8f8f` circa |
| Testo terziario | `#8f8f8f` | `#5d5d5d` circa |
| Sfondo morbido (chip, righe attive) | `#ededed` | `#303030` circa |
| Pulsante primario pieno | `#181818` testo bianco | `#131313` testo bianco |
| Bordo contorno | nero al 16 % | bianco al 25 % |
| Hover fantasma | nero all'8 % | bianco al 12 % |
| Informazione (link, stato) | blu `#0169cc` | blu `#66b5ff` |
| Informazione pieno | blu `#0285ff` | blu `#0285ff` |
| Diff aggiunto e rimosso | dai colori grafico verde e rosso del tema | idem |

Scala grigi di riferimento: 0 `#fff`, 25 `#fcfcfc`, 50 `#f9f9f9`, 75 `#f3f3f3`, 100 `#ededed`, 150 `#dfdfdf`, 200 `#cdcdcd`, 300 `#afafaf`, 400 `#8f8f8f`, 500 `#5d5d5d`, 600 `#414141`, 700 `#303030`, 750 `#282828`, 800 `#212121`, 850 `#1c1c1c`, 900 `#181818`, 950 `#131313`, 1000 `#0d0d0d`.

Scala blu: 50 `#e5f3ff`, 100 `#99ceff`, 200 `#66b5ff`, 300 `#339cff`, 400 `#0285ff`, 500 `#0169cc`, 600 `#004f99`.

Non esiste un colore d'accento forte: l'interfaccia è grigia, il blu compare solo per link, informazioni e selezione. Il pulsante principale è nero pieno in chiaro.

## Raggi e ombre

Raggi base: xs 4, sm 6, md 8, lg 10, xl 12, 2xl 16, 3xl 20, 4xl 24 px, moltiplicati per una scala 1 o 1,25. Forma degli angoli `superellipse(1.5)` dove il motore la supporta, altrimenti tondi: in SwiftUI corrisponde a `RoundedRectangle(cornerRadius:style: .continuous)`.

Ombre molto leggere: sm `0 1 2 nero 8 %`, md `0 2 4 nero 8 %`, lg `0 4 8 nero 10 %`, xl `0 8 16 nero 12 %`. Bordo sottile `0 0 0 0.5 px nero 10 %`.

## Chat

- Messaggio della persona: blocco allineato a destra su sfondo morbido, senza bordo, larghezza al contenuto.
- Risposta: testo in prosa senza bolla, larghezza della colonna.
- Attività dell'agente (comandi, file letti, strumenti): righe compatte in testo secondario con icona, raggruppate e collassate a turno concluso, espandibili nel dettaglio.
- Diff: schede con intestazione file, superficie leggermente distinta dalla pagina, righe aggiunte e rimosse colorate.
- Composer: campo flottante in fondo alla colonna, angoli 2xl, bordo sottile, riga inferiore con selettori (modello, sforzo, ambiente) e pulsante di invio circolare.
- Sidebar: superficie secondaria, righe da 30 px, testo secondario, selezione con sfondo morbido.

## Cosa prendere da Synara

Da Synara arrivano i comportamenti, non i colori: bolla persona senza bordo e risposta senza bolla (identici alla app Codex), riga "Ha lavorato per…" che raccoglie le attività di un turno, ispettore dell'attività, misuratore della finestra di contesto ad anello, chip per file, menzioni e comandi nel composer, selettore modello con sforzo, stato vuoto con logo e invito a iniziare.
