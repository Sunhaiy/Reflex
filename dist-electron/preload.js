"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    // Add API methods here
    ping: () => electron_1.ipcRenderer.invoke('ping'),
});
//# sourceMappingURL=preload.js.map