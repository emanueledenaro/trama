# V08 - Forma dell'adattatore provider con Codex come unico adattatore

Ticket: #71. Riferimento: `docs/reference/synara-funzioni.md`, sezioni 5, 7, 8, 9.

## Cosa e implementato

- `ProviderAdapter.swift`: il protocollo comune, `ProviderKind` per i nove provider,
  `ProviderCapabilities` con i cinque flag di V08 piu cambio modello, rollback, compattazione,
  import del thread, steering, scoperta di skill, comandi e plugin; `ProviderAccessState` con i tre
  stati; `ModelSelection` come unione discriminata con opzioni proprie per provider;
  `ProviderEvent` come formato normalizzato unico; `ProviderConformance` che lega ogni flag al
  metodo che lo realizza (le cinque coppie di Synara piu i flag di V08); `ProviderAdapterRegistry`.
- `ProviderCatalogue.swift`: i nove provider con le capacita dichiarate dalla sezione 7. Solo Codex
  e disponibile; gli altri otto sono descrizioni per P02-P09.
- `CodexEventNormalizer.swift`: la mappatura degli eventi Codex verso `ProviderEvent`, con `raw`
  conservato e `unmapped` visibile.
- `CodexProviderAdapter.swift`: l'adattatore Codex, con `checkAccess`, `listModels`, `startSession`,
  `sendTurn`, `interruptTurn`, `stopSession`, `events`, `steerTurn`, `rollbackThread`,
  `compactThread`, `listSkills`; `CodexAccessProbe` legge `model_provider` da `config.toml`.
- `ProviderStatusStore.swift`: cache dello stato su disco, un file per provider, ordine fisso,
  scrittura atomica con modo `0o600`, lettura indulgente, un solo controllo alla volta con un giro
  di follow-up.
- `ModelCatalogCache.swift`: fresco 10 minuti, vecchio 24 ore, ripetizione del fallimento 30
  secondi, timeout 45 secondi, 64 voci; chiave a cinque campi; volo singolo; risposta vuota
  autorevole; sfratto LRU.
- `ProviderSessionDirectory.swift`: le regole di `upsert` e `ProviderIdleReaper` (30 minuti, 5
  minuti).
- `ProviderStallWatchdog.swift`: la valutazione pura del watchdog e i metodi Codex che contano come
  progresso.
- `CodexClient.swift`: inizializzazione con volo singolo, `steerTurn`, `compactThread`,
  `rollbackThread`; il timeout del turno diventa un watchdog di inattivita che si azzera a ogni
  progresso.
- La timeline (`CoordinatorSession`, `TeamSession`, `SpecialistRuntime`) consuma solo `ProviderEvent`.
- La schermata dei collegamenti (`ProviderConnectionsList`) mostra ogni provider con la stessa
  forma: nome, stato di accesso e capacita. Lo stato arriva dalla cache su disco, scritta a ogni
  verifica del collegamento.

## Coperto dai test

165 test verdi, tra cui:

- catalogo dei nove provider, ordine fisso, capacita per provider, conformita e registro;
- normalizzazione di ogni evento Codex, con `raw` e `unmapped`;
- `CodexAccessProbe` e i tre stati di accesso, compreso `model_provider` personalizzato che non
  tocca Codex;
- cache dello stato su disco, permessi `0o600`, ordine, un solo controllo con follow-up;
- cache dei modelli: fresco senza riscoperta, voli concorrenti uniti, chiavi diverse, risposta vuota
  autorevole, finestra di ripetizione, timeout, sfratto LRU;
- regole di `upsert` e reaper;
- watchdog puro e turno silenzioso abbandonato;
- avvii concorrenti che condividono una sola inizializzazione; avvio a freddo senza `model/list`;
  ripiego di ripresa solo per thread inesistente;
- l'adattatore Codex su trasporto simulato: accesso, catalogo, steering, compattazione, rollback;
- `SpecialistRuntimeTests` verde dopo il passaggio a `ProviderEvent`, senza cambi di comportamento
  osservabile.

## Non verificato per il blocco di Codex

Codex e bloccato fino al 19 settembre 2026 alle 14:59. Restano non verificati, e non sono sostituiti
da fixture:

- il collegamento e lo scollegamento reali dell'account ChatGPT;
- l'avvio e la ripresa reali del thread del Coordinatore;
- il valore del watchdog di inattivita misurato sui turni lunghi del Coordinatore (il valore
  predefinito e quello di Synara, 900 s con controllo ogni 15 s);
- i nomi e il comportamento reali di `thread/compact`, `thread/rollback` e `turn/steer` contro un
  Codex vivo;
- la scoperta dei plugin di Codex: la dichiarazione del catalogo segue Synara, l'adattatore non la
  rivendica perche il trasporto di Trama non la espone.

## Deviazioni motivate

- L'adattatore Codex dichiara `supportsPluginDiscovery` e `supportsPluginMentions` falsi: il
  trasporto di Trama non espone i plugin, e un flag vero senza il metodo fallirebbe il controllo di
  conformita. Il catalogo conserva invece il valore di Synara, che descrive il provider per P02-P09.
- I metodi obbligatori sono quelli del verticale di V08 piu `streamEvents`; i nove metodi in piu di
  Synara (`listSessions`, `hasSession`, `readThread`, `respondToRequest`, `respondToUserInput`,
  `stopAll`) arriveranno con i ticket che li usano.
- `ProviderEvent` porta ancora `ContextUsageSnapshot` e `ContextCompactionState` come payload del
  contesto, perche sono gia la forma normalizzata di Codex in Trama. La generalizzazione appartiene
  a P02+.
