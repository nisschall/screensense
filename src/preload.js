const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  ipcRenderer.on(channel, callback);
  return () => {
    ipcRenderer.off(channel, callback);
  };
}

contextBridge.exposeInMainWorld('screensense', {
  onUpdate(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => handler(payload);
    return subscribe('popup:update', listener);
  },
  requestEnhance() {
    return ipcRenderer.invoke('popup:enhance');
  },
  requestAction(action) {
    return ipcRenderer.invoke('popup:action', action);
  },
  requestResource(resource) {
    return ipcRenderer.invoke('popup:resource', resource);
  },
  requestDelete() {
    return ipcRenderer.invoke('popup:delete');
  },
  requestClose() {
    ipcRenderer.send('popup:close');
  }
});
