import { app } from "electron";
import { registerIpcHandlers } from "./ipcHandlers";
import { createLauncherWindow, getLauncherWindow } from "./windows";

app.whenReady().then(() => {
  registerIpcHandlers();
  createLauncherWindow();

  // macOS convention — kept even though v1 only ships a Windows build, per
  // the plan's note that another platform can be added cheaply later.
  app.on("activate", () => {
    if (!getLauncherWindow()) createLauncherWindow();
  });
});

// Closing the game window never quits the app — it re-shows the launcher
// (see windows.ts). The only real path to quitting is closing the launcher
// window itself while no game window is open, which is what fires this.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
