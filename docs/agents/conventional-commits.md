# Conventional Commits: controllo in CI

Il repository verifica [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/#specification) a ogni pull request, nel workflow `.github/workflows/conventional-commits.yml`. Lo script è in `scripts/conventional-commits/`, senza dipendenze oltre a Node (già richiesto dal progetto).

## Cosa controlla

- **Ogni commit della pull request, compresi i merge.** La prima riga segue `<tipo>[(ambito)][!]: <descrizione>`, con tipo tra `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`, `revert`.
- **Il titolo della pull request**, nello stesso formato.
- **Il nome del branch**, secondo Conventional Branch 1.1.0: regole ed esempi in `docs/agents/branch-naming.md`.

Il job fallisce con un messaggio che indica il commit (con lo sha breve), il titolo o il branch non conforme, e il formato atteso.

## Merge su main

Il commit di unione su `main` ha un oggetto conforme, per esempio `feat(app): add the search palette (#123)`. L'oggetto proposto di default da GitHub ("Merge pull request #123 from ...") non è conforme: va sostituito a mano nella schermata di conferma del merge.

Per unire `main` dentro un branch di lavoro, usare:

```
git merge -m "chore: merge origin/main into <branch>" origin/main
```

invece del pulsante "Update branch" dell'interfaccia di GitHub, che genera un oggetto di merge non conforme ("Merge branch 'main' into ...").

## Hook locale facoltativo

Per bloccare un commit non conforme prima che arrivi in CI:

```
git config core.hooksPath scripts/conventional-commits/hooks
```

L'hook (`scripts/conventional-commits/hooks/commit-msg`) usa solo Node, nessuna dipendenza aggiuntiva. Per rimuoverlo:

```
git config --unset core.hooksPath
```

## Test

```
node --test scripts/conventional-commits/lib.test.mjs
```

I test coprono esempi di input conforme e non conforme, sia per i commit sia per i nomi di branch.

## Cosa non fa

Il controllo vale da ora in poi: non riscrive la cronologia esistente. Non valida il corpo o il footer `BREAKING CHANGE:` dei commit, solo la prima riga.
