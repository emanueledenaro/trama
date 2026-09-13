# Prerequisiti della distribuzione

Verifica del 13 settembre 2026, collegata al ticket #19.

La lettura delle identità di firma fuori dalla sandbox ha trovato un’identità Apple Development e nessuna Developer ID Application. La prima non soddisfa il requisito di distribuzione previsto dallo script. Nessuna chiave privata è stata letta o esportata.

È stato preparato scripts/package-release.sh. Richiede identità Developer ID e nome del profilo di notarizzazione nel Portachiavi. Parte da un commit pubblicato nella storia di main, crea un clone separato, esegue test e build Release e ricontrolla lo stato del clone prima di firmare. Conserva log e risposta Apple; l’archivio finale viene prodotto soltanto dopo Accepted, stapling e verifica Gatekeeper.

Verifiche eseguite: sintassi Bash, pagina di aiuto, uscita con codice 2 quando mancano i prerequisiti; packaging Debug in build/PackagingCheck/Trama.app con il nuovo parametro di destinazione, verifica codesign della firma ad hoc. Le revisioni Standards e Spec hanno richiesto isolamento del sorgente e test prima della firma; entrambi sono presenti nella versione finale.

Non sono stati eseguiti firma Developer ID, invio ad Apple, notarizzazione, Gatekeeper della build distribuibile o installazione su secondo Mac. Il ticket rimane aperto e nessun archivio viene descritto come beta scaricabile verificata.
