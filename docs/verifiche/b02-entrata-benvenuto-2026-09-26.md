# B02: entrata, benvenuto e scelta del progetto (26 settembre 2026)

Verifiche eseguite su Linux, in un container senza Codex reale e senza `gh`, sul branch `feature/issue-200-launch-welcome` con `origin/main` a `1bc0a45`. Le schermate vengono da `scripts/ui-check.mjs` con l'app-server Codex di prova.

## Cosa è stato provato

- Test di unità: `shared/onboarding.test.ts` (prima apertura, schermata iniziale, passi della configurazione, ripresa, scelta del metodo AI Hero, lettura del repository da clonare, stato dei progetti recenti), `renderer/lib/launchIntro.test.ts` (durata sotto 1,5 secondi, chiusura appena l'app è pronta, movimento ridotto), `main/core/overview.test.ts` (colleghi attivi ricalcolati al momento della lettura).
- ui-check: l'entrata si chiude da sola entro 1,5 secondi dal benvenuto; i fotogrammi sono presi rigiocando l'animazione e fermandola a tempi fissi; con `prefers-reduced-motion` l'entrata non ha animazioni. Il benvenuto compare al primo avvio, i tre passi hanno lo stato della guida, "Rimanda" lascia il passo saltato e la guida lo mostra, "Rivedi il benvenuto" riprende dal passo saltato. Dopo il riavvio il benvenuto non ricompare. Scelta del progetto con l'azione principale per ultima, a 1280x820 e 720x640, in chiaro e in scuro, senza scorrimento orizzontale; recenti con percorso, ultimo lavoro, stato e colleghi attivi; clonazione con un indirizzo non valido rifiutato; l'esempio si apre con l'esercizio. Cambiare progetto non rigioca l'entrata.

## Non verificato

- La clonazione reale da GitHub, con `gh` e con `git`: nel container non c'è rete verso GitHub né `gh`.
- L'accesso reale a Codex o a un altro provider dal passo del benvenuto.

## Schermate

Entrata, tema chiaro:

![Entrata in chiaro](b02-entrata-benvenuto/01-entrata-chiaro.png)

Entrata con i temi scuri di Claude e Codex, e con il movimento ridotto:

![Entrata in scuro e con movimento ridotto](b02-entrata-benvenuto/02-entrata-scuro-e-movimento-ridotto.png)

Benvenuto:

![Benvenuto, finestra larga](b02-entrata-benvenuto/03-benvenuto-largo.png)
![Benvenuto, finestra stretta](b02-entrata-benvenuto/04-benvenuto-stretto.png)

Passi della configurazione:

![Passo del provider](b02-entrata-benvenuto/05-passo-provider.png)
![Passo del provider, stretto e scuro](b02-entrata-benvenuto/06-passo-provider-stretto-scuro.png)
![Passi di GitHub e AI Hero](b02-entrata-benvenuto/07-passi-github-ai-hero.png)
![Passo di AI Hero, finestra stretta](b02-entrata-benvenuto/08-passo-ai-hero-stretto.png)

Scelta del progetto:

![Primo avvio, finestra larga](b02-entrata-benvenuto/09-scelta-progetto-primo-avvio-largo.png)
![Primo avvio, finestra stretta](b02-entrata-benvenuto/10-scelta-progetto-primo-avvio-stretto.png)
![Progetti recenti, finestra larga](b02-entrata-benvenuto/11-scelta-progetto-recenti-largo.png)
![Progetti recenti, finestra stretta](b02-entrata-benvenuto/12-scelta-progetto-recenti-stretto.png)
![Clona, guida e ripresa](b02-entrata-benvenuto/13-clona-guida-ripresa.png)
![Progetto di esempio con l'esercizio](b02-entrata-benvenuto/14-esempio-esercizio.png)
