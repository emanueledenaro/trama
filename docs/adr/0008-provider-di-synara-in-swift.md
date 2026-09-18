# Trama collega gli stessi nove provider di Synara, riscritti in Swift

Stato: accettata il 17 settembre 2026 da Emanuele. Implementazione da verificare con i ticket P01-P09 (#80-#88).

La specifica del verticale prevedeva un solo adattatore completo, Codex, e rimandava Claude a un ticket successivo. Synara, progetto open source con licenza MIT, ha già nove adattatori provati da test: Codex, Claude Agent, Cursor, Antigravity, Grok, Droid, OpenCode, Pi e Devin. Il Product Owner vuole la stessa copertura in Trama, riusando la logica già messa alla prova invece di reinventarla.

Decisione: Trama avrà gli stessi nove provider. La logica di Synara si riscrive in Swift, senza includere il server Node di Synara né librerie TypeScript. Codex resta collegato direttamente al suo app-server, con le ottimizzazioni di Synara. Cursor, Grok, Droid e Devin condividono un solo client Swift per l'Agent Client Protocol. I provider entrano dopo la forma comune dell'adattatore (V08) e prima della prova finale (V09): prima Claude Agent, poi gli altri sette, un ticket per provider.

Alternative scartate: includere e avviare il server Node di Synara dentro Trama (più rapido, ma Trama porterebbe Node con sé, Codex passerebbe da un intermediario e l'ADR 0001 andrebbe rivisto); una soluzione mista con Codex e Claude in Swift e il resto tramite Node (due architetture da mantenere).

Conseguenze: Claude si collega parlando con il programma claude, perché il pacchetto TypeScript usato da Synara non esiste in Swift. Pi in Synara gira dentro il processo tramite librerie TypeScript: il suo ticket parte solo dopo aver verificato un canale nativo, altrimenti torna a Emanuele. Antigravity non ha approvazioni interattive né eventi d'uso dei token, e i limiti si mostrano. Le prove reali richiedono gli account dei provider; Codex usa solo gpt-5.6-luna. La logica portata da Synara conserva l'attribuzione e la licenza MIT dei suoi titolari. Quale provider usino il Coordinatore e gli specialisti oltre a Codex resta una scelta di prodotto da fare prima di V09.
