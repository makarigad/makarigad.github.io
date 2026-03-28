const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true, // This hides the top menu so operators can't click around
    webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true
}
  })

  // This tells the app to open your main dashboard file
  win.loadFile('index.html') 
  
  // This makes it open in full screen
  win.maximize() 
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})