<!--
Titolo in formato Conventional Commits, per esempio `feat(app): add the search palette`.
Il testo della PR è in italiano. Regole complete in AGENTS.md e CONTRIBUTING.md.
-->

## Cosa cambia

<!-- Il comportamento nuovo o corretto, in poche righe. -->

## Verifiche

<!-- Comandi eseguiti in app/ e risultato. Un risultato AI non è un'evidenza di test. -->

- [ ] `npx tsc --noEmit -p .`
- [ ] `npx vitest run`
- [ ] `npm run build`
- [ ] `npm run ui-check` (su Linux con `xvfb-run -a`), temi chiaro e scuro se cambia l'interfaccia

## Issue collegata

Closes #
