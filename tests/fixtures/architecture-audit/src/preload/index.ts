const api = {
  files: {},
  task: {},
};

contextBridge.exposeInMainWorld("api", api);
