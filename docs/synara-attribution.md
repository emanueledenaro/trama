# Attribuzione di Synara

Trama porta logica e comportamento dei provider da [Synara](https://github.com/Emanuele-web04/synara), come deciso nell'[ADR 0008](adr/0008-provider-di-synara-in-swift.md). La logica è riscritta in Swift: Trama non include il server Node né il codice TypeScript di Synara.

La fonte di riferimento è il commit `9f91d59f182ec03722cb7fe8fe2244ef268c2c39` del repository `https://github.com/Emanuele-web04/synara`. Il [riferimento funzionale](reference/synara-funzioni.md) collega i comportamenti di Synara ai ticket di Trama; le sue prime sezioni erano state scritte sul commit `dd88d9272f97e4dda5735281e73ce14de388ad25`.

Synara è distribuito con licenza MIT. Il file `LICENSE` di quel commit indica due titolari: `Copyright (c) 2026 T3 Tools Inc.` e `Copyright (c) 2026 Emanuele Di Pietro`. La logica portata da Synara conserva questa nota. Segue il testo completo della licenza, copiato senza modifiche da `LICENSE` al commit `9f91d59f182ec03722cb7fe8fe2244ef268c2c39`.

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
