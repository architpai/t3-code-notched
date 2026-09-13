import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, ViewState } from "../shared/contracts";
const bridge: Bridge = {
  getState: () => ipcRenderer.invoke("notched:state"),
  subscribe: (listener) => {
    const handler = (_event: unknown, state: ViewState) => listener(state);
    ipcRenderer.on("notched:update", handler);
    return () => ipcRenderer.removeListener("notched:update", handler);
  },
  connect: (input) => ipcRenderer.invoke("notched:connect", input),
  connectLocal: (remember, allowAnswers = true) =>
    ipcRenderer.invoke("notched:local", { remember, allowAnswers }),
  answerQuestion: (input) =>
    ipcRenderer.invoke("notched:answer-question", input),
  disconnect: () => ipcRenderer.invoke("notched:disconnect"),
  usage: () => ipcRenderer.invoke("notched:usage"),
  lastMessage: (threadId) =>
    ipcRenderer.invoke("notched:last-message", threadId),
  movePanel: (direction, nudge) =>
    ipcRenderer.invoke("notched:move", { direction, nudge }),
  resize: (height, extension = 0, cornerUsageHeight = 0) =>
    ipcRenderer.invoke("notched:resize", {
      height,
      extension,
      cornerUsageHeight,
    }),
  dragPanel: (input) => ipcRenderer.invoke("notched:drag", input),
  openThread: (threadId) => ipcRenderer.invoke("notched:open-thread", threadId),
  quit: () => ipcRenderer.invoke("notched:quit"),
};
contextBridge.exposeInMainWorld("notched", bridge);
