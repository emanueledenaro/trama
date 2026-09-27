# Attribuzione di Synara

Trama porta logica e comportamento dei provider da [Synara](https://github.com/Emanuele-web04/synara), come deciso nell'[ADR 0008](../adr/0008-provider-in-swift.md) e nell'[ADR 0012](../adr/0012-provider-in-typescript.md). Dal 23 settembre 2026 gli adattatori sono in TypeScript in `app/src/main/core/providers`, portati da `apps/server/src/provider` al commit `eaa61eded31b6755d4f30ba8eabc5d905cf817cb` senza il livello Effect. Trama non include il server di Synara.

Dal 23 settembre 2026 l'app desktop di Trama è in Electron ([ADR 0011](../adr/0011-app-desktop-electron.md)) e riprende il design di Synara: token di colore, tipografia, misure e classi dell'interfaccia sono riscritti in `app/src/renderer` a partire dallo stesso commit: `apps/web/src/index.css`, `theme/theme.logic.ts` e i componenti dell'interfaccia. I valori dei token sono quelli del tema predefinito "codex" di Synara. Le icone "Central Icons" di Synara non sono incluse perché il repository di Synara non ne dichiara la licenza.

La fonte di riferimento per la licenza è il commit `9f91d59f182ec03722cb7fe8fe2244ef268c2c39`. Il riferimento funzionale che collegava i comportamenti di Synara ai ticket di Trama (`docs/reference/synara-funzioni.md` e `docs/reference/synara-ricerche/`, scritti sui commit `dd88d92` e `9f91d59`) è stato tolto con la issue #213 e resta nella cronologia git.

## File derivati

Con la issue #213 i file di Trama non nominano più Synara: in testa dicono che derivano da codice MIT di terze parti e rimandano a `THIRD_PARTY_NOTICES.md`. La tabella riporta i file di Synara da cui deriva ciascuno, come erano indicati in testa. I percorsi dei provider sono relativi a `apps/server/src/provider`, salvo dove indicato.

| File di Trama | File di Synara |
| --- | --- |
| `app/src/main/core/providers/types.ts` | forma comune degli adattatori |
| `app/src/main/core/providers/acp/acpRuntime.ts` | `acp/AcpSessionRuntime.ts`, `AcpRuntimeModel.ts`, `AcpAdapterSupport.ts`, `AcpTurnIdleWatchdog.ts`, `AcpLoadReplayGate.ts`, `AcpElicitationSupport.ts`, `skillPromptInjection.ts`, `providerChildEnvironment.ts`, `providerBinaryResolution.ts` (senza la macchina Effect, con un client JSON-RPC su stdio ndjson) |
| `app/src/main/core/providers/acp/cursor.ts` | `acp/CursorAcpSupport.ts`, `CursorAcpCommand.ts`, `CursorAcpExtension.ts`, `Layers/CursorAdapter.ts`, parte Cursor di `Layers/ProviderHealth.ts` |
| `app/src/main/core/providers/acp/devin.ts` | `acp/DevinAcpSupport.ts`, `DevinSessionConfig.ts`, `Layers/DevinAdapter.ts`, parte Devin di `Layers/ProviderHealth.ts` |
| `app/src/main/core/providers/acp/droid.ts` | `acp/DroidAcpSupport.ts`, `DroidTurnCancellation.ts`, `Layers/DroidAdapter.ts`, parte Droid di `Layers/ProviderHealth.ts` |
| `app/src/main/core/providers/acp/grok.ts` | `acp/GrokAcpSupport.ts`, `GrokAcpExtension.ts`, `Layers/GrokAdapter.ts`, parte Grok di `Layers/ProviderHealth.ts` |
| `app/src/main/core/providers/antigravity.ts` | `Layers/AntigravityAdapter.ts`, `antigravityPrintResult.ts`, controllo di Antigravity in `Layers/ProviderHealth.ts`, `providerBinaryResolution.ts`, `apps/server/src/agentGateway/stdioProxyScript.ts` |
| `app/src/main/core/providers/antigravity.test.ts` | nomi degli strumenti e chiavi degli argomenti registrati nei test dell'adattatore Antigravity |
| `app/src/main/core/providers/hostToolProxy.ts` | `apps/server/src/agentGateway/stdioProxyScript.ts` (spostato da `antigravity.ts`) |
| `app/src/main/core/providers/claudeAgent.ts` | `Layers/ClaudeAdapter.ts`, `claudeAuthStatus.ts`, `claudeAuthStatusLock.ts`, `claudeProcessEnv.ts`, `claudeTokenUsage.ts`, `providerBinaryResolution.ts`, `skillPromptInjection.ts`, parti Claude di `Layers/ProviderHealth.ts` |
| `app/src/main/core/providers/opencode.ts` | `opencodeRuntime.ts`, `providerBinaryResolution.ts`, `OpenCodeDiscovery.ts`, `openCodeMessageState.ts`, `Layers/OpenCodeAdapter.ts`, `skillPromptInjection.ts` |
| `app/src/main/core/providers/pi.ts` | `Layers/PiAdapter.ts`, `piOpenCodeCatalog.ts`, `piTurnFailure.ts`, controllo di Pi in `Layers/ProviderHealth.ts`, `skillPromptInjection.ts` |
| `app/src/main/core/providers/providerSupport.ts` | `skillPromptInjection.ts`, `attachmentProjection.ts`, `providerBinaryResolution.ts`, aiutanti di versione di `providerMaintenance.ts` e `cliVersion.ts` |
| `app/src/renderer/index.css` | `apps/web/src/index.css`, `theme/theme.logic.ts` |
| `app/src/renderer/components/ProviderIcon.tsx` | marchi di Claude, Cursor, Devin, Grok, Pi, OpenCode, Droid e Antigravity da `apps/web/src/components/Icons.tsx` e `AntigravityIcon.tsx`; il marchio OpenAI è il percorso di Simple Icons (CC0-1.0) che Synara usa tramite react-icons. I marchi appartengono ai rispettivi titolari |
| `app/src/renderer/components/SearchPalette.tsx` | disposizione e classi di `SidebarSearchPalette` |
| `app/src/renderer/components/Spinner.tsx`, `chat/ChatView.tsx`, `chat/Composer.tsx`, `chat/FocusBar.tsx`, `chat/TimelineRows.tsx`, `sidebar/Sidebar.tsx`, `ui/button.tsx`, `ui/menu.tsx`, `ui/tooltip.tsx` | disposizione e classi dei componenti corrispondenti di `apps/web/src` |
| `app/src/shared/mentions.ts` | `composerMentions.ts`, `workspaceEntries.ts` |
| `app/src/shared/pastedText.ts` | `composerPastedText.ts` |

Synara è distribuito con licenza MIT. Il file `LICENSE` di quel commit indica due titolari: `Copyright (c) 2026 T3 Tools Inc.` e `Copyright (c) 2026 Emanuele Di Pietro`. La logica portata da Synara conserva questa nota.

La copia della licenza sta in [synara-LICENSE](synara-LICENSE), copiata senza modifiche da `LICENSE` al commit `9f91d59f182ec03722cb7fe8fe2244ef268c2c39`. Il suo SHA-256 è `305724dd050ca7ded99c662de813d755bc4ec3887c4543a37159c6662ca36d1b`. Trama non copia file interi di Synara, ma adatta porzioni della sua logica; per questo non c'è una licenza di terze parti da installare nei progetti configurati come per AI Hero. Il testo è ripetuto qui sotto perché resti leggibile accanto all'attribuzione.

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
