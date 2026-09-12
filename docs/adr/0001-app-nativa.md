# App macOS nativa

Stato: accettata, 12 settembre 2026.

Trama usa SwiftUI e i controlli Apple, con SF Symbols e tema di sistema. Il riferimento visivo determina la composizione della mappa e dei pannelli; i controlli sono quelli nativi di macOS.

Swift Package Manager separa la libreria TramaCore dall'app Trama. Foundation gestisce lettura del repository, persistenza locale e il processo Codex App Server. Il progetto non richiede dipendenze esterne per compilare.

La prima versione legge repository locali e conserva decisioni sul computer. I flussi Codex mostrano solo eventi ricevuti dal processo ufficiale. GitHub Issues è il tracker del progetto; l'integrazione in-app può essere sviluppata separatamente dal tracker.
