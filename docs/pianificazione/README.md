# Ticket del piano operativo

Bozze locali per la pubblicazione su GitHub Issues. Questi codici sono identificativi di pianificazione, non numeri di issue già create.

| Ticket | Risultato | Dipende da |
| --- | --- | --- |
| [T01](tickets/01-avvio-nativo.md) | Aprire Trama e ritrovare un progetto | Nessuno |
| [T02](tickets/02-collegare-codex.md) | Riconoscere e collegare Codex di OpenAI | T01 |
| [T03](tickets/03-collegamenti-github.md) | Riconoscere GitHub e verificare le operazioni disponibili | T02 |
| [T04](tickets/04-setup-aihero.md) | Preparare automaticamente il metodo AI Hero | T01, T02 |
| [T05](tickets/05-mappa-viva.md) | Esplorare una mappa collegata ai file reali | T01 |
| [T06](tickets/06-richiesta-piano.md) | Passare da un modulo a un piano di Codex | T02, T04, T05 |
| [T07](tickets/07-decisioni-patto.md) | Prendere una decisione e vedere quali lavori ne dipendono | T06 |
| [T08](tickets/08-sessione-isolata.md) | Eseguire una modifica in un worktree dedicato | T07 |
| [T09](tickets/09-verifiche-revisione.md) | Revisionare il comportamento su un candidato preciso | T08 |
| [T10](tickets/10-nuovo-progetto.md) | Creare un progetto partendo da un’idea | T08 |
| [T11](tickets/11-issue-pull-request.md) | Collegare una issue al lavoro e pubblicare una PR revisionata | T03, T09 |
| [T12](tickets/12-attivita-gruppo.md) | Vedere le novità condivise dal gruppo | T03, T05 |
| [T13](tickets/13-conflitti-git.md) | Ricevere un avviso per un conflitto Git riprodotto | T08, T09, T12 |
| [T14](tickets/14-intenzione-comportamento.md) | Capire le conseguenze delle modifiche del gruppo | T06, T07, T09, T12 |
| [T15](tickets/15-reazione-avvisi.md) | Aggiornare il piano e avvisare solo quando serve | T13, T14 |
| [T16](tickets/16-background-ripresa.md) | Seguire il progetto a finestra chiusa | T15 |
| [T17](tickets/17-esperienza-macos.md) | Verificare l’intero percorso con l’interfaccia Apple | T04, T10, T11, T16 |
| [T18](tickets/18-beta-riproducibile.md) | Consegnare una beta locale riproducibile dal codice pubblico | T17 |

Ogni ticket deve produrre un percorso dimostrabile. Le dipendenze descrivono ciò che deve essere verificato prima di iniziarlo. I ticket indipendenti possono procedere in parallelo con responsabilità di scrittura separate.
