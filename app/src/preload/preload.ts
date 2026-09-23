import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppState } from "@shared/domain";
import type { TramaBridge } from "@shared/ipc";

const bridge: TramaBridge = {
  invoke: (action, payload) => ipcRenderer.invoke("trama:action", action, payload),
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
