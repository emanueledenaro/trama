# Ticket del piano operativo

Il piano è pubblicato nel repository [emanueledenaro/trama](https://github.com/emanueledenaro/trama). La [specifica principale](https://github.com/emanueledenaro/trama/issues/1) è la issue 1. I primi 18 ticket corrispondono alle issue 2-19. T19 e T20, richiesti per responsive e design, sono le issue 21 e 22.

Il file [github.json](github.json) conserva per ogni ticket numero, URL, titolo, dipendenze e documento locale. È la mappatura tra il piano nel repository e GitHub Issues. Non sostituisce una lettura live dello stato remoto e non segna un ticket come completato.

| Ticket | GitHub | Risultato | Dipende da |
| --- | --- | --- | --- |
| [T01](tickets/01-avvio-nativo.md) | [#2](https://github.com/emanueledenaro/trama/issues/2) | Aprire Trama e ritrovare un progetto | Nessuno |
| [T02](tickets/02-collegare-codex.md) | [#3](https://github.com/emanueledenaro/trama/issues/3) | Riconoscere e collegare Codex di OpenAI | T01 |
| [T03](tickets/03-collegamenti-github.md) | [#4](https://github.com/emanueledenaro/trama/issues/4) | Riconoscere GitHub e verificare le operazioni disponibili | T02 |
| [T04](tickets/04-setup-aihero.md) | [#5](https://github.com/emanueledenaro/trama/issues/5) | Preparare automaticamente il metodo AI Hero | T01, T02 |
| [T05](tickets/05-mappa-viva.md) | [#6](https://github.com/emanueledenaro/trama/issues/6) | Esplorare una mappa collegata ai file reali | T01 |
| [T06](tickets/06-richiesta-piano.md) | [#7](https://github.com/emanueledenaro/trama/issues/7) | Passare da un modulo a un piano di Codex | T02, T04, T05 |
| [T07](tickets/07-decisioni-patto.md) | [#8](https://github.com/emanueledenaro/trama/issues/8) | Prendere una decisione e vedere quali lavori ne dipendono | T06 |
| [T08](tickets/08-sessione-isolata.md) | [#9](https://github.com/emanueledenaro/trama/issues/9) | Eseguire una modifica in un worktree dedicato | T07 |
| [T09](tickets/09-verifiche-revisione.md) | [#10](https://github.com/emanueledenaro/trama/issues/10) | Revisionare il comportamento su un candidato preciso | T08 |
| [T10](tickets/10-nuovo-progetto.md) | [#11](https://github.com/emanueledenaro/trama/issues/11) | Creare un progetto partendo da un'idea | T08 |
| [T11](tickets/11-issue-pull-request.md) | [#12](https://github.com/emanueledenaro/trama/issues/12) | Collegare una issue al lavoro e pubblicare una PR revisionata | T03, T09 |
| [T12](tickets/12-attivita-gruppo.md) | [#13](https://github.com/emanueledenaro/trama/issues/13) | Vedere le novità condivise dal gruppo | T03, T05 |
| [T13](tickets/13-conflitti-git.md) | [#14](https://github.com/emanueledenaro/trama/issues/14) | Ricevere un avviso per un conflitto Git riprodotto | T08, T09, T12 |
| [T14](tickets/14-intenzione-comportamento.md) | [#15](https://github.com/emanueledenaro/trama/issues/15) | Capire le conseguenze delle modifiche del gruppo | T06, T07, T09, T12 |
| [T15](tickets/15-reazione-avvisi.md) | [#16](https://github.com/emanueledenaro/trama/issues/16) | Aggiornare il piano e avvisare solo quando serve | T13, T14 |
| [T16](tickets/16-background-ripresa.md) | [#17](https://github.com/emanueledenaro/trama/issues/17) | Seguire il progetto a finestra chiusa | T15 |
| [T17](tickets/17-esperienza-macos.md) | [#18](https://github.com/emanueledenaro/trama/issues/18) | Verificare l'intero percorso con l'interfaccia Apple | T04, T10, T11, T16, T19, T20 |
| [T18](tickets/18-beta-riproducibile.md) | [#19](https://github.com/emanueledenaro/trama/issues/19) | Consegnare una beta locale riproducibile dal codice pubblico | T17 |
| [T19](tickets/19-responsive-macos.md) | [#21](https://github.com/emanueledenaro/trama/issues/21) | Adattare le finestre e i pannelli alle dimensioni disponibili | Incremento #20 integrato |
| [T20](tickets/20-allineamento-design.md) | [#22](https://github.com/emanueledenaro/trama/issues/22) | Uniformare spazi, allineamenti e gerarchia visiva Apple | Incremento #20 integrato |

Ogni ticket richiede il percorso dimostrabile indicato nel proprio documento. Il codice presente, un test simulato o una dipendenza completata non bastano a chiuderlo. Le verifiche ancora mancanti sono riepilogate in [stato-beta.md](../stato-beta.md).
