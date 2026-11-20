/*
 * Безопасный мост между окном и главным процессом (contextBridge).
 * Окно получает только этот ограниченный набор функций window.mansur.*, а не весь Node.js —
 * так вредный код на странице не сможет читать файлы или украсть токен.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mansur', {
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: patch => ipcRenderer.invoke('settings:set', patch),
  login: data => ipcRenderer.invoke('auth:login', data),
  socialProviders: server => ipcRenderer.invoke('auth:providers', server),
  socialLogin: data => ipcRenderer.invoke('auth:oauth', data),
  socialCancel: () => ipcRenderer.invoke('auth:oauth-cancel'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  api: (method, url, body) => ipcRenderer.invoke('api', { method, url, body }),
  uploadBackground: file => ipcRenderer.invoke('me:background', file),
  runAgent: data => ipcRenderer.invoke('agent:run', data),
  runExisting: task => ipcRenderer.invoke('agent:run-existing', task),
  stopAgent: slot => ipcRenderer.invoke('agent:stop', slot ?? null),
  team: () => ipcRenderer.invoke('agents:team'),
  teamState: () => ipcRenderer.invoke('agents:state'),
  answerConfirm: (id, ok) => ipcRenderer.invoke('agent:confirm-answer', { id, ok }),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  open: target => ipcRenderer.invoke('shell:open', target),
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    resizeStart: edge => ipcRenderer.invoke('win:resize-start', edge),
    resizeEnd: () => ipcRenderer.invoke('win:resize-end'),
    zoom: z => ipcRenderer.invoke('win:zoom', z),
  },
  on: (channel, cb) => {
    // Окно может подписаться только на разрешённые события.
    const allowed = ['agent:event', 'agent:state', 'agent:done', 'agent:confirm', 'auth:expired', 'win:anim', 'win:state', 'win:zoom'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
