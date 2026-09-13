#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--help" ]]; then
  cat <<'HELP'
Prepara Trama per la distribuzione fuori dal Mac di sviluppo.
Richiede un checkout pulito, TRAMA_SIGNING_IDENTITY con il nome completo
Developer ID Application e TRAMA_NOTARY_PROFILE già salvato nel Portachiavi.
Crea un clone del repository pubblico sul commit corrente di main o un suo
antecedente, esegue test, build Release, firma, invio ad Apple e archivio ZIP.
Gli artefatti rimangono in una nuova cartella build/Distribution/release.*.
HELP
  exit 0
fi
if [[ $# -ne 0 ]]; then echo "Usare --help oppure nessun argomento." >&2; exit 2; fi
identity="${TRAMA_SIGNING_IDENTITY:-}"
profile="${TRAMA_NOTARY_PROFILE:-}"
if [[ "$identity" != "Developer ID Application: "* || -z "$profile" ]]; then
  echo "Servono TRAMA_SIGNING_IDENTITY (Developer ID Application) e TRAMA_NOTARY_PROFILE." >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Il checkout contiene modifiche o file non tracciati. Preparare la release da un clone pulito." >&2
  exit 2
fi
if ! security find-identity -v -p codesigning | grep -F -- "\"$identity\"" >/dev/null; then
  echo "L’identità Developer ID richiesta non è disponibile nel Portachiavi." >&2
  exit 2
fi
xcrun --find notarytool >/dev/null
xcrun --find stapler >/dev/null
revision="$(git rev-parse HEAD)"
mkdir -p build/Distribution
release_dir="$(mktemp -d "$PWD/build/Distribution/release.XXXXXX")"
app="$release_dir/Trama.app"
source_dir="$release_dir/source"
git clone --no-checkout https://github.com/emanueledenaro/trama.git "$source_dir"
git -C "$source_dir" merge-base --is-ancestor "$revision" origin/main
git -C "$source_dir" checkout --detach "$revision"
(cd "$source_dir" && swift test) > "$release_dir/tests.log" 2>&1
bash "$source_dir/scripts/build-app.sh" release "$app" > "$release_dir/build.log" 2>&1
if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" || -n "$(git -C "$source_dir" status --porcelain)" ]]; then
  echo "Il clone di distribuzione è cambiato durante le verifiche. Firma e invio interrotti." >&2
  exit 1
fi
# Firma i componenti eseguibili interni prima del bundle principale.
codesign --force --options runtime --timestamp --sign "$identity" "$app/Contents/MacOS/TramaMonitor"
codesign --force --options runtime --timestamp --sign "$identity" "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --keepParent "$app" "$release_dir/Trama-submission.zip"
xcrun notarytool submit "$release_dir/Trama-submission.zip" --keychain-profile "$profile" --wait --output-format json > "$release_dir/notarization.json"
notary_status="$(plutil -extract status raw -o - "$release_dir/notarization.json")"
if [[ "$notary_status" != "Accepted" ]]; then
  echo "Notarizzazione non accettata. Consultare $release_dir/notarization.json." >&2
  exit 1
fi
xcrun stapler staple "$app"
xcrun stapler validate "$app"
codesign --verify --deep --strict "$app"
spctl --assess --type execute "$app"
ditto -c -k --keepParent "$app" "$release_dir/Trama.zip"
printf '%s\n' "$revision" > "$release_dir/source-commit.txt"
(cd "$release_dir" && shasum -a 256 Trama.zip > SHA256SUMS)
printf 'Archivio firmato e notarizzato: %s/Trama.zip\n' "$release_dir"
printf 'Resta da verificare installazione e percorso completo su un secondo Mac.\n'
