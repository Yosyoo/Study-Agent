import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, ModelConfig, StudyAPI, TaskInput } from '../shared/contracts'

const api: StudyAPI = {
  getState: () => ipcRenderer.invoke('study:get-state'),
  subscribe: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState): void => callback(state)
    ipcRenderer.on('study:state', listener)
    return () => ipcRenderer.removeListener('study:state', listener)
  },
  addTask: (input: TaskInput) => ipcRenderer.invoke('study:add-task', input),
  deleteTask: id => ipcRenderer.invoke('study:delete-task', id),
  undoDeleteTask: () => ipcRenderer.invoke('study:undo-delete-task'),
  analyzePage: () => ipcRenderer.invoke('study:analyze-page'),
  openBrowser: url => ipcRenderer.invoke('study:open-browser', url),
  closeBrowser: () => ipcRenderer.invoke('study:close-browser'),
  observe: () => ipcRenderer.invoke('study:observe'),
  start: id => ipcRenderer.invoke('study:start', id),
  pause: () => ipcRenderer.invoke('study:pause'),
  resume: () => ipcRenderer.invoke('study:resume'),
  stop: () => ipcRenderer.invoke('study:stop'),
  confirm: (id, approved) => ipcRenderer.invoke('study:confirm', id, approved),
  saveModel: (config: ModelConfig) => ipcRenderer.invoke('study:save-model', config),
  setApiKey: config => ipcRenderer.invoke('study:set-key', config),
  pasteApiKey: config => ipcRenderer.invoke('study:paste-key', config),
  clearApiKey: config => ipcRenderer.invoke('study:clear-key', config),
  testModel: config => ipcRenderer.invoke('study:test-model', config),
  openDataFolder: () => ipcRenderer.invoke('study:open-data-folder'),
}
contextBridge.exposeInMainWorld('study', api)
