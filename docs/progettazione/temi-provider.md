# Temi dei provider

Trama prende l'aspetto del provider usato dal dialogo: l'attributo `data-provider` sulla radice (impostato in `app/src/renderer/App.tsx`) sceglie in `app/src/renderer/index.css` superfici di base, luce sul vetro, accento, pulsante principale e anello di focus, in versione chiara e scura. I colori di stato (errori, avvisi, successo) restano uguali per tutti i provider.

I colori vengono dai siti ufficiali, letti il 25 settembre 2026 con gli stili calcolati della pagina o le variabili del tema.

| Provider | Superfici chiaro / scuro | Accento del marchio | Fonte |
| --- | --- | --- | --- |
| ChatGPT | `#ffffff` / `#212121`, grigi neutri | blu `#339cff` (oklch 0.72 0.15 248) | chatgpt.com |
| Claude | avorio `#faf9f5` / `#262624`, testo `#141413` | terracotta `#d97757` | anthropic.com |
| Cursor | `#f7f7f4` / `#14120b`, testo `#26251e` | arancio `#f54e00` (`--color-theme-accent`) | cursor.com |
| Antigravity | `#f8f9fc` / `#121317` | blu `#3186ff`, con `#00b95c`, `#fc413d`, `#ffe432` | antigravity.google |
| Grok | `#f9f8f7` / `#1e1f22` (`theme-color`) | monocromatico | grok.com |
| Droid (Factory) | `#f5f5f5` / `#0d0d0d` | arancio `#d15010` | factory.ai |
| Devin | `#fcfcfc` / `#131313`, testo `#191919` | blu `#317cff` (`--text-accent-primary`), verde `#00a558` | devin.ai |
| OpenCode | `#f1f0f0` / `#181616`, carbone `#211e1e` | grigi `#bcbbbb`, verde `#03b000` | opencode.ai |
| Pi | `#f3f2f0` / `#161d27` (`--bg-canvas`) | azzurro `#6a9fcc`, blu marea `#4b607c` | pi.dev |

Gli accenti usati per il testo sono una tonalità più scura del colore del marchio in modalità chiara e più chiara in modalità scura, per restare leggibili. La luce sul vetro di Grok, ChatGPT e OpenCode è neutra perché i loro marchi sono monocromatici.
