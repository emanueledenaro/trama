# Linguaggio visivo di Trama

Regola del 1° ottobre 2026: ogni scelta visiva di Trama ha un motivo e dice sempre la stessa cosa. Chi usa Trama deve poterlo notare. Un movimento o un colore senza un significato non entra nell'app.

Il motivo di partenza è il nome: una trama è un tessuto, fatto di fili che passano uno sopra l'altro. Il logo ha due nastri intrecciati e tutto il resto ne deriva.

| Elemento | Cosa dice | Dove |
| --- | --- | --- |
| Icona a due fili: il filo di fondo tenue e quello davanti pieno | Cosa conta nell'icona: la spunta, la X, il +. Il resto è contesto | Tutte le icone (`components/icons`, `brand/tramaIcons.ts`) |
| Filo pieno | In primo piano. La vista aperta ha l'icona con entrambi i fili pieni | Barra delle attività |
| Il filo di fondo si accende al passaggio del mouse (150 ms) | Questa vista, se la apri, viene in primo piano | Barra delle attività e barra del titolo, mai altrove |
| Aggiorna che gira piano | Trama sta rileggendo il progetto, e quando smette ha finito | Barra del titolo |
| Griglia che si tesse | Qualcuno del team, o Trama, sta lavorando adesso | Rotella di caricamento (`Spinner`) |
| Filo ritorto con la cucitura | Quanto lavoro è fatto (il filo) e quanto manca (la cucitura) | Barre di avanzamento (`ThreadBar`), slider dello sforzo |
| Foglio sulla cornice | Dove si lavora (il foglio) e cosa fa da contorno (la cornice) | Editor e pannello in basso |
| Fessura tra due schede, con il segno a due fili | Qui si prende per allargare o stringere: tutta la fessura (12 px) fa da maniglia, e al passaggio del mouse il filo davanti corre lungo il bordo | Splitter (`Sash`) tra barra laterale, conversazione, dettaglio e Attività |
| Riga che si apre in posto | Riga e contenuto sono una scheda sola: la riga fa da intestazione, niente si ripete | Schede concluse in chat, azioni richieste, riordino del contesto (`chat/Fold.tsx`) |
| Accento del provider | Chi sta lavorando: il colore del provider del dialogo | Solo gli accenti, mai lo sfondo (`temi-provider.md`) |

Il movimento è leggero e professionale: transizioni brevi (150 ms per lo stato), rotazioni lente e continue, niente rimbalzi, niente disegni che spariscono e ricompaiono. Con "riduci movimento" del sistema ogni animazione si ferma e il significato resta nei colori.

Prima di aggiungere un'animazione o un colore nuovo, si scrive qui la riga con cosa dice. Se non si sa dirlo in una riga, non serve.
