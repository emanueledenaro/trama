# Attribuzione di Hermes Agent

Trama porta il sistema di apprendimento di [Hermes Agent](https://github.com/NousResearch/hermes-agent), come deciso nell'[ADR 0014](adr/0014-apprendimento-di-hermes.md). La fonte è la revisione `58c896ea4ebaff5425a068f461b6c6fedadb8b40` del 24 settembre 2026. Il codice è riscritto in TypeScript in `app/src/main/core/learning`; ogni file indica in testa i file di Hermes da cui deriva. Trama non include codice Python di Hermes e non avvia i suoi servizi.

| File di Trama | File di Hermes |
| --- | --- |
| `memoryStore.ts` | `tools/memory_tool_store.py`, `tools/memory_tool.py` |
| `threatPatterns.ts` | `tools/threat_patterns.py` |
| `searchIndex.ts`, `sessionSearch.ts` | `hermes_state_search.py`, `tools/session_search_tool.py` |
| `fuzzyMatch.ts`, `sequenceMatcher.ts` | `tools/fuzzy_match.py`, `difflib.SequenceMatcher` di Python |
| `skillFormat.ts`, `skillLibrary.ts`, `skillLinter.ts`, `skillUsage.ts` | `tools/skill_manager_tool.py`, `tools/skill_manager_guards.py`, `tools/skill_manager_batch.py`, `tools/skills_tool.py`, `tools/skill_linter.py`, `tools/skill_usage.py`, `agent/skill_utils.py` |
| `review.ts`, `reviewRunner.ts` | `agent/background_review.py`, `agent/turn_context.py`, `agent/turn_finalizer.py`, `agent/prompt_builder.py` |
| `curator.ts` | `agent/curator.py`, `agent/curator_backup.py` |

Hermes Agent è distribuito con licenza MIT, `Copyright (c) 2025 Nous Research`. La copia della licenza sta in [hermes-LICENSE](hermes-LICENSE), copiata senza modifiche da `LICENSE` alla revisione indicata. Il suo SHA-256 è `821556e6336796450ab852d375117b48a4887e71d255794fd6318d99982a5ab6`. I prompt e le descrizioni degli strumenti sono porzioni sostanziali copiate da Hermes, quindi la nota di copyright e la licenza restano con loro. Il testo è ripetuto qui sotto.

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

La dipendenza aggiunta per leggere il frontmatter delle skill è `yaml` 2.9.0 (licenza ISC), già presente nel lockfile tramite Pi e Vite.
