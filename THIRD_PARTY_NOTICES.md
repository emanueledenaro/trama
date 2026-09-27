# Avvisi di terze parti

Trama contiene codice, testi e design derivati dai progetti qui sotto, tutti distribuiti con licenza MIT. Questo file e i file in [`docs/legal/`](docs/legal/) sono gli unici punti del repository che nominano questi progetti. I file derivati rimandano qui.

## Synara

- Fonte: <https://github.com/Emanuele-web04/synara>
- Revisioni: `eaa61eded31b6755d4f30ba8eabc5d905cf817cb` per gli adattatori dei provider in TypeScript e per l'interfaccia dell'app Electron; `9f91d59f182ec03722cb7fe8fe2244ef268c2c39` per la copia della licenza e per il riferimento funzionale usato in precedenza.
- Cosa ne deriva Trama: gli adattatori dei provider in `app/src/main/core/providers/`, i token di design, la disposizione e le classi dell'interfaccia in `app/src/renderer/` i marchi dei provider in `app/src/renderer/components/ProviderIcon.tsx` e alcuni aiutanti in `app/src/shared/`. Trama non include il server di Synara né il set di icone "Central Icons", di cui il repository di Synara non dichiara la licenza.
- Copyright: `Copyright (c) 2026 T3 Tools Inc.` e `Copyright (c) 2026 Emanuele Di Pietro`.
- Dettagli file per file: [docs/legal/synara-attribution.md](docs/legal/synara-attribution.md). Copia della licenza: [docs/legal/synara-LICENSE](docs/legal/synara-LICENSE).

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.
Copyright (c) 2026 Emanuele Di Pietro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Hermes Agent

- Fonte: <https://github.com/NousResearch/hermes-agent>
- Revisione: `58c896ea4ebaff5425a068f461b6c6fedadb8b40`.
- Cosa ne deriva Trama: memoria, ricerca delle sessioni, libreria delle skill, revisione e curatore dell'apprendimento del Coordinatore in `app/src/main/core/learning/`, riscritti in TypeScript. I prompt della revisione e le descrizioni degli strumenti sono copiati senza modifiche. Trama non include il suo codice Python e non avvia i suoi servizi.
- Copyright: `Copyright (c) 2025 Nous Research`.
- Dettagli file per file: [docs/legal/hermes-attribution.md](docs/legal/hermes-attribution.md). Copia della licenza: [docs/legal/hermes-LICENSE](docs/legal/hermes-LICENSE).

```text
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Skill di Matt Pocock

- Fonte: <https://github.com/mattpocock/skills>, release `v1.2.3`.
- Cosa include Trama: le skill in `app/resources/AIHero/skills/`, con il testo originale.
- Copyright: `Copyright (c) 2026 Matt Pocock`, licenza MIT, testo in [app/resources/AIHero/LICENSE](app/resources/AIHero/LICENSE).
- Dettagli: [docs/aihero-attribution.md](docs/aihero-attribution.md).

## Controllo

`npm run check:upstream-names` in `app/` fallisce quando un file tracciato, fuori da questo file e da `docs/legal/`, nomina uno dei progetti elencati in [docs/legal/upstream-names.txt](docs/legal/upstream-names.txt), nel testo o nel percorso. Gira nel job `test` della CI.

## Nei pacchetti dell'app

`npm run dist` copia questo file e la cartella `docs/legal/` tra le risorse del pacchetto, in `THIRD_PARTY_NOTICES.md` e `legal/`.
