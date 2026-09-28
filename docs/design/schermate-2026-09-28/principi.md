# Principi per le schermate di Trama

Proposta per la issue #314, 28 settembre 2026. Parte dal rapporto dell'audit nel commento della issue (inventario, misure, 10 problemi, mappa delle viste, pulsanti). Valgono per tutte e tre le alternative in [alternative.md](alternative.md).

## Una domanda per zona dello schermo

Ogni zona risponde a una sola domanda. Quello che risponde a un'altra domanda sta altrove, e al massimo lascia un rimando.

| Domanda della persona | Zona | Cosa ci sta | Cosa non ci sta |
|---|---|---|---|
| Dove sono? | Barra in alto | progetto, branch, apertura dei pannelli | stati, avvisi, pulsanti di decisione |
| Cosa succede adesso? | Riga di stato | una frase su cosa fa il Coordinatore e cosa farà dopo, l'obiettivo in primo piano, Attività e Pausa come icone | pulsanti di decisione, testi lunghi, conteggi |
| Cosa ci siamo detti? | Chat | messaggi, righe compatte per gli eventi, schede lunghe chiuse, rimandi ad Aspetta te | seconde copie dei pulsanti di decisione, righe che ripetono la riga di stato |
| Cosa devo fare io? | Riga sopra il composer e vista Aspetta te | la prima cosa che aspetta la persona, con il conteggio e un solo pulsante | riassunti di cose già scritte altrove |
| Cosa voglio dire? | Composer | testo, ambito, modello | misuratore del contesto sotto la soglia |
| Cosa c'è in quello che ho aperto? | Pannello del dettaglio | una vista alla volta: testata, riepilogo, elenco, dettaglio | spiegazioni lunghe in testa |
| Dove posso andare? | Navigazione | progetti e le cinque viste del progetto | badge che ripetono il conteggio di Aspetta te |

Le tre alternative mettono queste zone in punti diversi dello schermo. La tabella in [alternative.md](alternative.md#dove-sta-ogni-zona) dice dove.

## Regole trasversali

### Una sola cosa urgente in evidenza

- Nella finestra c'è un solo pulsante pieno (`data-variant="default"`). È la mossa che sblocca più lavoro: oggi "Decidi" sulla riga sopra il composer, oppure "Concedi" quando Aspetta te è aperta. Invia resta com'è.
- Quando la vista Aspetta te è aperta, la riga sopra il composer sparisce: la stessa cosa non compare due volte sullo schermo.
- Il segno più forte dello schermo è la cosa da fare, non il lavoro in primo piano. Il bordo tratteggiato blu della riga del primo piano sparisce; la cucitura (docs/brand/cucitura.md) resta per un solo accento per schermata.

### Un solo posto per le cose che aspettano la persona

- Aspetta te è la casa di ogni voce: domande, proposta di mandato, proposte di memoria, schede del Patto, candidati che cambiano l'interfaccia, azioni fermate dai divieti fissi (CONTEXT.md, ADR 0017).
- Mandato, Memoria, Patto, Squadre e Lavoro mostrano una riga di rimando ("La proposta v3 aspetta te") senza pulsanti di decisione.
- Un solo contatore di cose da fare: quello di Aspetta te. Spariscono i badge di Mandato, Memoria, Patto e Team e il badge di Issue (un totale non è una cosa da fare).
- La Panoramica usa lo stesso conteggio di Aspetta te.
- Nelle schede di decisione i pulsanti stanno in cima, subito sotto il titolo e la frase su cosa ferma. Il confronto lungo è chiuso sotto.

### Niente ripetizioni

- Ogni informazione ha una casa e al massimo un rimando, e il rimando non ripete il pulsante.
- La riga del primo piano e la riga di stato diventano una riga.
- L'avviso di divergenza non è una fascia fissa sopra la chat. Mentre il Coordinatore riallinea, è la frase della riga di stato e una riga in Lavoro con i file; se serve una scelta di prodotto diventa una voce di Aspetta te.
- Presenza, Monitor e Apprendimento hanno una sola copia: presenza e monitor in Impostazioni, apprendimento in Memoria ("Come impara").
- Un solo pulsante Aggiorna, nella testata, se aggiorna tutto il progetto (da verificare nel codice prima di togliere gli altri).

### Un solo vocabolario

Lo stesso nome ovunque: la voce della navigazione è uguale al titolo del pannello. Proposta di parole, da confermare con la persona:

| Cosa | Nome proposto | Da togliere |
|---|---|---|
| Il posto delle cose da fare | Aspetta te | Decisione richiesta, Proposte da approvare, In attesa (come nome del posto) |
| Fermare il Coordinatore | Pausa | Il Coordinatore va avanti da solo (diventa lo stato opposto della stessa leva) |
| Togliere un lavoro dal primo piano | Metti da parte | Metti in pausa |
| Fermare la condivisione della presenza | Sospendi la presenza | Metti in pausa |
| Fermare la manutenzione delle skill | Sospendi la manutenzione | Metti in pausa |
| Un piano o un candidato sostituito | Sostituito | Superato (si confonde con una verifica superata) |
| Le persone agenti del progetto | Squadre, capo squadra, ruolo condiviso | Team, figure, sviluppatori come titolo di vista |
| Regole del progetto | Regole, con Mandato, Patto e Standard del codice | Patto Vivo, Mandato del Coordinatore |
| Stato di una fetta | Da iniziare, In corso, In verifica, Ferma, Unita, Sostituita | Bloccata, In costruzione, Concluso, Fatta, libero |
| Stato di un obiettivo | Proposto, Attivo, Raggiunto, Archiviato (uno solo alla volta) | Aperto e Archiviato insieme |

Altre regole di lingua:

- Gli id (`A-4025CB6B`, `S-D4F3D9D2`) solo al passaggio del mouse o nel dettaglio tecnico.
- Testi tutti in italiano, anche errori delle verifiche, descrizioni dei modelli e manutenzione delle skill. "Ask Trama" resta il nome della skill, non l'etichetta di un pulsante.

### Icone per le azioni secondarie

Regola, coerente con `.cta-row` in `app/src/renderer/index.css` (azioni a destra, primaria e distruttiva per ultime):

- **Solo icona**, con tooltip e `aria-label`: azioni secondarie, ripetute o di navigazione (aprire, chiudere, allargare, aggiornare, copiare, espandere, mostrare nella chat, verificare di nuovo).
- **Solo testo**: la mossa principale della vista e ogni azione che decide o che non si annulla (Concedi, Rifiuta, Correggi, Revoca, Unisci, Ritira, Approva, Togli dalla squadra, Rimuovi la copia di lavoro, Ripristina, Applica, Scarta, Accedi, Salva). Stanno a destra, la primaria per ultima.
- **Icona più testo**: azioni che avviano lavoro o che la persona cerca per nome (Riprendi, Chiedi, Nuovo, Avvia, Elimina).

Tabella dell'audit, con la scelta e dove si vede nei prototipi. Le icone sono quelle Tabler già usate nel renderer, salvo dove scritto.

| Azione (dove) | Oggi | Proposta | Icona | Nei prototipi |
|---|---|---|---|---|
| Attività (riga di stato) | testo | solo icona | IconListDetails | riga di stato (A), barra di stato (B), barra in alto (C) |
| Pausa del Coordinatore | icona più testo | solo icona, tooltip "Pausa del Coordinatore" | IconPlayerPause | come sopra |
| Riprendi (in pausa) | icona più testo | icona più testo | IconPlayerPlay | |
| Metti in pausa il lavoro in primo piano | testo | voce di menu "Metti da parte" | IconChevronDown per il menu | |
| Mostra i 18 file (divergenza) | icona più testo | solo icona accanto a "18 conflitti" | IconChevronDown | Lavoro, riga del branch |
| Chiedi al Coordinatore come riallineare | testo, pieno | tolto: il Coordinatore riallinea dentro il mandato; se serve una scelta è una voce di Aspetta te | | |
| Concedi il mandato (riga di stato, chat, fascia) | testo, 3 copie | testo, una copia in Aspetta te | | Aspetta te |
| Apri il diff | testo | solo icona | IconFileDiff | Specialista, sezione Ora |
| Esame approfondito | icona più testo | solo icona | IconFocus2 | Specialista, sezione Ora |
| Mostra nella chat | icona più testo | solo icona | IconMessageCircle | Attività |
| Dettagli (sovrapposizioni) | testo | solo icona con numero | IconChevronDown | |
| Apri in Aspetta te (chat) | testo | tutta la riga cliccabile | IconHourglass | chat, riga "Proposta di mandato v3" |
| Riprendi (turno interrotto) | testo | icona più testo | IconPlayerPlay | |
| Correggi la spec (chat) | testo | testo | | |
| Rifiuta, Correggi, Concedi | testo | testo, in cima alla scheda | | Aspetta te |
| Scarta, Applica | testo | testo | | Aspetta te |
| Nuovo obiettivo, Nuova decisione, Nuova issue | icona più testo | solo icona nella testata di sezione | IconPlus | Regole, Lavoro |
| Aggiungi (Memoria) | testo | solo icona | IconPlus | Memoria |
| Modifica (Obiettivo, Decisione, nota) | testo | solo icona | IconPencil (nuova nel renderer) | Memoria |
| Ripristina (Obiettivo) | testo, pieno | testo, non pieno | | |
| Collega (Obiettivo) | testo | testo | | |
| Chiedi al Coordinatore (Modulo, Issue, Specialista) | testo o icona più testo | icona più testo "Chiedi" | IconMessageCircle | Specialista |
| Restringi, Salva correzione, Annulla, Revoca | testo | testo, dentro "Cambia il mandato" chiusa | | Regole |
| Avvia ora la revisione, Avvia il triage ora | icona più testo | icona più testo "Avvia" | IconPlayerPlay | Squadre, Lavoro automatico |
| Osservato, Non osservato (6 coppie) | testo | coppia di icone con tooltip | IconCheck, IconX | |
| Esamina di nuovo | testo | icona più testo | IconRotateClockwise | |
| Aggiorna (Gruppo, Issue, Panoramica) | icona o icona più testo | solo icona, una copia | IconRefresh | testata (A) |
| Segui in background (Gruppo) | testo | solo in Impostazioni, Monitor | IconEye | |
| Pausa della presenza | testo | "Sospendi la presenza", solo in Impostazioni | IconPlayerPause | |
| Apri su GitHub | icona più testo | solo icona | IconExternalLink | Lavoro, pull request |
| Apri, Fissa, Archivia (skill) | testo | solo icona | IconFileText, IconLock, IconArchive | Memoria |
| Elimina (skill) | testo | icona più testo | IconTrash | |
| Rivedi ora, Controlla ora | testo | solo icona | IconRotateClockwise, IconRefresh | Memoria, Come impara |
| Anteprima | testo | solo icona | IconEye | |
| Rinomina, Togli dalla squadra | testo | testo, dentro un menu | IconChevronDown per il menu | Specialista |
| Rimuovi la copia di lavoro | testo | testo | | |
| Apri il dialogo (Attività, 8) | testo | solo icona | IconMessageCircle | Attività |
| Apri la issue #21 | testo | icona più numero | IconCircleDot | |
| Mostra i precedenti | testo | icona più testo | IconChevronDown | |
| Output originale | testo | solo icona | IconTerminal2 | |
| Verifica (Collegamenti, 8) | testo | solo icona | IconRefresh | Impostazioni |
| Capacità (Collegamenti, 8) | icona più testo | solo icona | IconListDetails | Impostazioni |
| Verifica tutti | icona più testo | icona più testo | IconRefresh | Impostazioni |
| Apri la guida | testo | icona più testo | IconSchool | |
| Osserva (Monitor) | testo | icona più testo | IconEye | |
| Accedi, Prepara, Salva, Annulla | testo | testo | | Impostazioni (Accedi) |

Icone che il renderer di oggi non usa: IconPencil (modifica), IconLayoutBottombar (pannello in basso, solo alternativa B), IconBug e IconSparkles (righe del lavoro automatico). Tutte le altre dei prototipi sono già in `app/src/renderer`.

## Struttura di ogni vista

Ogni vista ha le stesse quattro parti, dall'alto:

1. **Testata**: il nome uguale alla voce di navigazione, lo stato, al massimo un'azione.
2. **Riepilogo**: una o due righe con la cosa che conta ora ("1 squadra al lavoro", "2 cose aspettano te", "3 di 6 esempi dell'obiettivo provati").
3. **Elenco**: righe compatte da 32 px, con chi, stato e un'azione a icona a destra.
4. **Dettaglio**: si apre a richiesta; le sezioni lunghe sono chiuse.

## Le 16 viste di oggi e dove vanno

Le viste della barra laterale passano da 11 a 5 per progetto: Aspetta te, Lavoro, Squadre, Regole, Memoria. Panoramica e Impostazioni restano fuori dal progetto. Dove una riga dice "le tre", la scelta è uguale in tutte le alternative; le differenze sono in [alternative.md](alternative.md).

| Vista di oggi | Destinazione | Nota |
|---|---|---|
| Panoramica dei progetti | Progetti | Una riga per progetto: cosa fa il Coordinatore e la prima cosa di Aspetta te, con lo stesso conteggio |
| Aspetta te | Aspetta te | Casa unica delle voci; pulsanti in cima alla scheda |
| Obiettivi e Obiettivo | Lavoro | L'obiettivo attivo fa da filtro e riepilogo in cima a Lavoro; archiviati chiusi in fondo; uno stato solo |
| Mappa e Modulo | Regole, sezione Mandato, "Moduli" | I moduli servono soprattutto per il perimetro; il selettore d'ambito del composer resta una scelta |
| Patto e Decisione | Regole | |
| Mandato | Regole | La proposta in attesa vive in Aspetta te; "Cambia il mandato" è una sola sezione chiusa |
| Team | Squadre | Per stato: chi lavora ora in cima; figure fisse in "Ruoli condivisi" chiusa |
| Specialista | dettaglio di Squadre | Ora, ultimo risultato, incarichi; colore e copia di lavoro in fondo; Rinomina e Togli in un menu |
| Lavoro | Lavoro | Fette, branch e pull request, issue |
| Gruppo | si scioglie | Branch e pull request in Lavoro; chi altro lavora sul repository nel riepilogo di Squadre; presenza e monitor in Impostazioni |
| Issue e Issue #N | Lavoro, sezione Issue | Il backlog di Attività diventa il filtro "Nel backlog"; l'account GitHub va in Collegamenti |
| Memoria | Memoria | Riceve "Come impara" da Impostazioni, Apprendimento |
| Impostazioni | Impostazioni | Sezioni dell'app (Generale, Collegamenti) e del progetto (Metodo, Monitor, Presenza) |
| Attività | Attività, aperta dall'icona della riga di stato | Filtro per persona e tipo; il lavoro automatico si avvia da Squadre |
| Candidato | dettaglio di Lavoro | "Cosa manca per unirlo" e l'azione principale in cima; diff chiuso |
| Esame approfondito | sezione del Candidato | Verdetto in una riga in cima; tutto schermo solo per la lettura lunga |

Candidato ed Esame non hanno un prototipo in questa fase: la loro struttura segue le quattro parti e la tabella dei pulsanti.
