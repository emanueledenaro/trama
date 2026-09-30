# Conventional Commits: controllo in CI

Il repository verifica [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/#specification) a ogni pull request, nel workflow `.github/workflows/conventional-commits.yml`. Lo script è in `scripts/conventional-commits/`, senza dipendenze oltre a Node (già richiesto dal progetto).

## Cosa controlla

- **Ogni commit della pull request, compresi i merge.** La prima riga segue `<tipo>[(ambito)][!]: <descrizione>`, con tipo tra `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `style`, `revert`. Unica eccezione: un commit di merge che porta `main`, `master` o `develop` dentro il branch può tenere l'oggetto che gli dà git, per esempio "Merge branch 'main' into feature/x" (vedi sotto).
- **Il titolo della pull request**, nello stesso formato.
- **Il nome del branch**, secondo Conventional Branch 1.1.0: regole ed esempi in `docs/agents/branch-naming.md`.

Il job fallisce con un messaggio che indica il commit (con lo sha breve), il titolo o il branch non conforme, e il formato atteso.

## Merge su main

Il commit di unione su `main` ha un oggetto conforme, per esempio `feat(app): add the search palette (#123)`. L'oggetto proposto di default da GitHub ("Merge pull request #123 from ...") non è conforme: va sostituito a mano nella schermata di conferma del merge.

Per unire `main` dentro un branch di lavoro vanno bene il pulsante "Update branch" di GitHub e un `git merge` locale. L'oggetto che generano ("Merge branch 'main' into ...") è accettato, ma solo su un commit di merge e solo se il branch unito è `main`, `master` o `develop`. Un merge di un altro branch, o lo stesso oggetto su un commit normale, resta non conforme. Resta valido anche un oggetto scritto a mano:

```
git merge -m "chore: merge origin/main into <branch>" origin/main
```

Questi merge non finiscono nel CHANGELOG, che legge solo i commit di unione su `main` (`--first-parent`).

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
