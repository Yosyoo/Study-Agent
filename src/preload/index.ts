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
  openBrowser: url => ipcRenderer.invoke('study:open-browser', url),
  closeBrowser: () => ipcRenderer.invoke('study:close-browser'),
  observe: () => ipcRenderer.invoke('study:observe'),
  start: id => ipcRenderer.invoke('study:start', id),
  pause: () => ipcRenderer.invoke('study:pause'),
  resume: () => ipcRenderer.invoke('study:resume'),
  stop: () => ipcRenderer.invoke('study:stop'),
  confirm: (id, approved) => ipcRenderer.invoke('study:confirm', id, approved),
  saveModel: (config: ModelConfig) => ipcRenderer.invoke('study:save-model', config),
  setApiKey: () => ipcRenderer.invoke('study:set-key'),
  pasteApiKey: () => ipcRenderer.invoke('study:paste-key'),
  clearApiKey: () => ipcRenderer.invoke('study:clear-key'),
  testModel: () => ipcRenderer.invoke('study:test-model'),
  openDataFolder: () => ipcRenderer.invoke('study:open-data-folder'),
}
contextBridge.exposeInMainWorld('study', api)
