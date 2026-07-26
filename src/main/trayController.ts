import { app, Menu, nativeImage, Tray } from "electron";

interface TrayControllerOptions {
  appName: string;
  getAppIconPath: () => string;
  showTodayMini: () => void;
  quickCaptureMenuItems: () => Electron.MenuItemConstructorOptions[];
  showQuickCapture: () => void;
  showMainWindow: () => void;
}

export interface TrayController {
  setup: () => void;
  isActive: () => boolean;
}

function createTrayIcon(iconPath: string): Electron.NativeImage {
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });

  const size = 16;
  const buffer = Buffer.alloc(size * size * 4, 0);
  const accent = [138, 47, 59, 255];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const inOuter = x >= 1 && x < 15 && y >= 1 && y < 15;
      const inInner = x >= 3 && x < 13 && y >= 3 && y < 13;
      if (!inOuter || inInner) continue;
      buffer[index] = accent[0];
      buffer[index + 1] = accent[1];
      buffer[index + 2] = accent[2];
      buffer[index + 3] = accent[3];
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

export function createTrayController(options: TrayControllerOptions): TrayController {
  let tray: Tray | null = null;

  return {
    setup() {
      tray = new Tray(createTrayIcon(options.getAppIconPath()));
      const contextMenu = Menu.buildFromTemplate([
        { label: "今日やることを表示", click: options.showTodayMini },
        { type: "separator" },
        ...options.quickCaptureMenuItems(),
        { type: "separator" },
        { label: `${options.appName} を開く`, click: options.showMainWindow },
        { type: "separator" },
        { label: "終了", click: () => app.quit() },
      ]);
      tray.setToolTip(options.appName);
      tray.setContextMenu(contextMenu);
      tray.on("click", options.showQuickCapture);
    },
    isActive() {
      return Boolean(tray && !tray.isDestroyed());
    },
  };
}
