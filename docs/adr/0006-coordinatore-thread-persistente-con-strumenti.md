# Il Coordinatore è un thread Codex persistente governato dagli strumenti di Trama

Stato: accettata il 16 settembre 2026, intervista sull'incremento verticale del Coordinatore (Q8 e Q9). Implementazione da verificare.

Il Coordinatore attuale apre un thread Codex effimero a ogni messaggio, riceve solo la richiesta e le decisioni del Patto, e può soltanto leggere file. Non ricorda la conversazione, non conosce mandato, ticket e cronologia, non ha iniziativa. Il Product Owner lo ha giudicato inutilizzabile rispetto alla specifica.

Decisione: il Coordinatore di un progetto è un solo thread Codex persistente, ripreso a ogni apertura del progetto e dopo un riavvio. Trama gli fornisce strumenti propri (leggere issue, Patto, mandato e cronologia; creare e governare specialisti; assegnare incarichi; lanciare controlli; chiedere una decisione alla persona). Il modello ragiona e decide entro il mandato; Trama applica il mandato al confine di ogni strumento e rifiuta le azioni non autorizzate. Senza componente Codex collegato il Coordinatore non risponde: non esiste un orchestratore Swift di riserva che ne imiti il ruolo.

Gli specialisti sono thread Codex avviati e posseduti da Trama, ciascuno nel proprio worktree, con istruzioni scritte dal Coordinatore e modello scelto per l'incarico. Non si usa la delega multi-agente nativa di Codex, che genera thread figli decisi dal modello: la schermata Team, lo stop, il cambio di priorità e la correzione del perimetro richiedono che Trama conosca e controlli ogni specialista.

Alternative scartate: un orchestratore Swift che chiama Codex per i singoli passi (prevedibile, ma senza memoria né iniziativa); la delega multi-agente nativa (meno codice, ma Trama vede e controlla meno). Entrambe restano possibili come estensioni quando il protocollo esporrà più controllo.

Fatti alla base: la CLI Codex 0.154.0 espone thread/resume, thread/list e thread/read per i thread persistenti, item/tool/call e DynamicToolSpec per gli strumenti forniti dal client, e permette di cambiare modello, cwd e sandbox a ogni turno.
