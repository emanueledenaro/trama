# Pubblicazione e verifica della roadmap del Coordinatore

La specifica e la simulazione del primo utilizzo sono state approvate da Emanuele prima della pubblicazione. Il piano estende la base pubblicata `ad38e76`; le modifiche UI ulteriori di #22 restano locali e fuori da questo incremento documentale.

## Controlli eseguiti

- Riletti corpo e commenti delle 22 issue precedenti: la specifica #1 e 21 ticket operativi.
- Confrontati tutti i 135 criteri con il raccordo aggiornato. Il testo dei requisiti originali è preservato; vengono aggiunte le responsabilità del nuovo piano.
- Creati 16 ticket autonomi, da #33 a #48, con obiettivo, criteri, dipendenze, componenti precedenti da conservare e prova di completamento.
- Verificata la coerenza esatta fra criteri JSON e Markdown e l'assenza di cicli nel grafo dei nuovi ticket.
- Conservato il piano iniziale byte per byte in un documento storico.
- Completate revisioni Standards e Spec. Corretti stati di pubblicazione anticipati, un criterio con prova incompleta, divergenza fra formati e due dipendenze mancanti.
- Aggiornati la specifica #1 e tutti i ticket precedenti senza chiuderne alcuno. Le sole spunte aggiunte sono #8 C3, invalidazione selettiva, e #23 C2, selettore nativo dei modelli.
- Riletti i testi effettivi di tutte le 38 issue dopo le scritture: coincidono con quelli previsti e tutte le issue precedenti conservano lo stato aperto.
- Registrate e rilette le dipendenze native dei nuovi ticket e dei ticket precedenti. #18 comprende anche #21, #22, #42, #47 e #48 fra i blocchi della verifica finale.

## Prove pregresse usate per le due spunte

#8 C3 usa la prova nell'app di Orders diventato Da rivalutare e Catalog rimasto Risposta disponibile dopo la modifica di una decisione, con implementazione e test della PR #31.

#23 C2 usa il selettore nativo con nome e descrizione osservato nella PR #29. C3, persistenza senza alterare la configurazione globale, rimane senza nuova spunta: il riavvio è documentato ma manca una prova esplicita sulla configurazione globale.

Questa riconciliazione non è un nuovo test del prodotto. I nuovi ticket restano da implementare e le regressioni coinvolte dovranno essere ripetute su ciascun candidato. Nessuna funzionalità del Coordinatore è dichiarata completa dalla pubblicazione dei ticket.

## Collegamenti

- [Specifica vigente](https://github.com/emanueledenaro/trama/issues/1).
- [Primo incremento del Coordinatore](https://github.com/emanueledenaro/trama/issues/33).
- [Aggiornamento dei ticket nel futuro prodotto](https://github.com/emanueledenaro/trama/issues/42).
- [Configurazione guidata](https://github.com/emanueledenaro/trama/issues/44).
- [Tutorial completo](https://github.com/emanueledenaro/trama/issues/46).
- [Trama sviluppa Trama](https://github.com/emanueledenaro/trama/issues/48).

La CI della base pubblicata è stata riletta con esito positivo. Il commit e la CI di questo incremento documentale devono essere verificati separatamente dopo la sua pubblicazione.
