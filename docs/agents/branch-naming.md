# Nomi dei branch: Conventional Branch

I nomi dei branch seguono [Conventional Branch 1.1.0](https://conventionalbranch.org/): `<tipo>/<descrizione>`. Il controllo gira nello stesso workflow `.github/workflows/conventional-commits.yml`, con lo script `scripts/conventional-commits/` (nessuna dipendenza oltre a Node).

## Branch di tronco

`main`, `master` e `develop` non hanno prefisso.

## Tipi ammessi dalla specifica

- `feature` o `feat`
- `bugfix` o `fix`
- `hotfix`
- `release`
- `chore`
- prefissi per agenti AI: `ai`, `claude`, `codex`, `copilot`, `cursor`

In questo repository persone e agenti usano i prefissi di tipo (`feature/`, `bugfix/`, `hotfix/`), non i prefissi con il nome dell'agente. `feature` è preferito a `feat`, `bugfix` a `fix`.

## Regole della descrizione

- solo lettere minuscole (`a-z`), cifre (`0-9`), trattini e punti;
- i punti si usano solo nelle versioni di `release/`, per esempio `release/v1.2.0`;
- niente trattini o punti consecutivi, niente all'inizio o alla fine della descrizione;
- niente spazi o underscore;
- il numero della issue è facoltativo ma consigliato dentro la descrizione, per esempio `feature/issue-142-assignment-contract`.

## Esempi

Validi: `feature/add-login-page`, `bugfix/fix-header-bug`, `hotfix/security-patch`, `release/v1.2.0`, `chore/update-dependencies`, `claude/security-patch`, `main`.

Non validi: `Feature/Add-Login` (maiuscole), `feature/new--login` (trattini consecutivi), `feature/-new-login` (trattino iniziale), `release/v1.-2.0` (trattino accanto al punto), `fix/header_bug` (underscore), `docs/old-tickets-audit` (tipo non previsto dalla specifica), `feature/` (descrizione vuota).

## Test

```
node --test scripts/conventional-commits/lib.test.mjs
```

I casi di test riprendono le fixture ufficiali di conformità della specifica, con esempi validi e non validi.
