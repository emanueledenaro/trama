/**
 * What the person reads when a memory write is refused (issue #305). The store answers the model in its original
 * English, word for word (ADR 0014); Trama's own paths read only the stable code and say it in plain Italian.
 */
import type { JsonRecord, MemoryTarget } from "./memoryStore";

const format = (n: number) => n.toLocaleString("it-IT");

/** The code of a refused memory result, or null when the result succeeded. */
export function memoryErrorCode(result: JsonRecord): string | null {
  if (result.success !== false) return null;
  return typeof result.code === "string" ? result.code : "unknown";
}

/** The toast of the person's own edit or approval: one Italian line, never the model's text. */
export function memoryFailureLine(result: JsonRecord, target: MemoryTarget, size: { chars: number; limit: number }): string {
  const store = target === "user" ? "Il profilo" : "La memoria del progetto";
  switch (memoryErrorCode(result)) {
    case "memory_full":
      return `${store} è ${target === "user" ? "pieno" : "piena"} (${format(size.chars)} su ${format(size.limit)} caratteri): togli o accorcia una nota prima di aggiungerne un'altra.`;
    case "no_match":
      return "Questa nota non c'è più: la memoria è cambiata.";
    case "ambiguous":
      return "Il testo indicato corrisponde a più note: correggine una alla volta.";
    case "drift":
      return "Il file della memoria è cambiato fuori da Trama: Trama non lo sovrascrive e ne ha salvato una copia accanto.";
    case "unreadable":
      return "Trama non riesce a leggere il file della memoria in questo momento. Riprova tra poco.";
    case "threat":
      return "La nota contiene istruzioni che Trama non salva in memoria.";
    case "disabled":
      return "Questa memoria è disattivata nelle impostazioni.";
    case "stale_proposal":
      return "La memoria è cambiata dopo la proposta: le voci che toccava non sono più le stesse. Scartala.";
    case "unknown_proposal":
      return "Questa proposta non c'è più.";
    default:
      return "La memoria non è stata aggiornata.";
  }
}

/** The Activity line of the Coordinator's refused memory write: short, in Italian, with the error tone. */
export function memoryActivityLine(result: JsonRecord): string {
  switch (memoryErrorCode(result)) {
    case "memory_full":
      return "Memoria non aggiornata: è piena.";
    case "no_match":
      return "Memoria non aggiornata: la nota da cambiare non c'è più.";
    case "ambiguous":
      return "Memoria non aggiornata: il testo indicato corrisponde a più note.";
    case "drift":
      return "Memoria non aggiornata: il file è cambiato fuori da Trama.";
    case "unreadable":
      return "Memoria non aggiornata: il file non si legge in questo momento.";
    case "threat":
      return "Memoria non aggiornata: la nota conteneva istruzioni che Trama non salva.";
    case "too_many_failures":
      return "Memoria non aggiornata: troppi tentativi in questo turno.";
    case "disabled":
      return "Memoria non aggiornata: è disattivata nelle impostazioni.";
    default:
      return "Memoria non aggiornata.";
  }
}
