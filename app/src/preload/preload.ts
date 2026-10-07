import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppState } from "@shared/domain";
import type { TramaBridge } from "@shared/ipc";
import { GESTURE_EVENTS, GestureClock } from "@shared/personGesture";

// The last real gesture of the person in the window (issue #597). The preload runs in its own isolated world: a script
// of the page cannot change this clock, and an event it dispatches is never trusted.
const gestures = new GestureClock();
for (const type of GESTURE_EVENTS) window.addEventListener(type, (event) => gestures.note(event, performance.now()), { capture: true });

const bridge: TramaBridge = {
  // Each action carries whether a gesture of the person started it: the main process refuses a yes without one.
  invoke: (action, payload) => ipcRenderer.invoke("trama:action", action, payload, { gesture: gestures.covers(performance.now()) }),
  getState: () => ipcRenderer.invoke("trama:state"),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on("trama:state", handler);
    return () => ipcRenderer.removeListener("trama:state", handler);
  },
  onMenu: (listener) => {
    const handler = (_event: IpcRendererEvent, command: string) => listener(command);
    ipcRenderer.on("trama:menu", handler);
    return () => ipcRenderer.removeListener("trama:menu", handler);
  },
};

contextBridge.exposeInMainWorld("trama", bridge);
