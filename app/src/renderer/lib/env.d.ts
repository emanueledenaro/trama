import type { TramaBridge } from "@shared/ipc";

declare global {
  interface Window {
    trama: TramaBridge;
  }
}
