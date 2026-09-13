import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  globalShortcut,
  shell,
  systemPreferences,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  maxPanelHeight,
  connectSchema,
  id,
  edgeSchema,
  cornerSchema,
  dragSchema,
  isDragMovement,
} from "../shared/contracts";
import { T3Client, safeError } from "./client";
import {
  panelBounds,
  dockAt,
  dragBounds,
  moveDock,
  type Dock,
} from "../shared/placement";
import {
  loadCredential,
  saveCredential,
  forgetCredential,
} from "./credentials";
import { answerSchema } from "../shared/questions";
import { localPairing } from "./local-pairing";
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app.whenReady().then(async () => {
    app.setName("T3 Code Notched");
    let height = 40;
    let extension = 0;
    let cornerUsageHeight = 0;
    const placementFile = join(app.getPath("userData"), "placement.json");
    const savedPlacement = await readFile(placementFile, "utf8")
      .then((text) =>
        z
          .object({
            edge: edgeSchema,
            corner: cornerSchema.optional(),
            offset: z.number().min(0).max(1),
            displayId: z.number().int(),
          })
          .parse(JSON.parse(text)),
      )
      .catch(() => null);
    let dock: Dock = savedPlacement ?? { edge: "top", offset: 0.5 };
    const notchSchema = z.array(
      z.object({
        id: z.number().int(),
        width: z.number().positive().max(800),
        height: z.number().positive().max(100),
        centerX: z.number().nonnegative(),
      }),
    );
    async function readNotches() {
      if (process.platform !== "darwin") return [];
      try {
        const binary = app.isPackaged
          ? join(process.resourcesPath, "notch-geometry")
          : join(__dirname, "../native/notch-geometry");
        const { stdout } = await promisify(execFile)(binary, [], {
          timeout: 3000,
          maxBuffer: 16384,
        });
        return notchSchema.parse(JSON.parse(stdout));
      } catch {
        return [];
      }
    }
    let notches = await readNotches();
    let display =
      screen.getAllDisplays().find((d) => d.id === savedPlacement?.displayId) ??
      screen.getAllDisplays().find((d) => notches.some((n) => n.id === d.id)) ??
      screen.getPrimaryDisplay();
    const notch = () => {
      const cutout = notches.find((n) => n.id === display.id);
      return cutout &&
        !dock.corner &&
        dock.edge === "top" &&
        Math.abs(dock.offset * display.bounds.width - cutout.centerX) <
          cutout.width / 2 + 190
        ? cutout
        : null;
    };
    const bounds = () =>
      panelBounds(
        display.bounds,
        height,
        notch(),
        dock,
        extension,
        cornerUsageHeight,
      );
    const window = new BrowserWindow({
      ...bounds(),
      title: "T3 Code Notched",
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      // Frameless macOS windows otherwise clamp y below the menu bar.
      enableLargerThanScreen: process.platform === "darwin",
      roundedCorners: false,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    if (process.platform === "darwin") {
      window.setAlwaysOnTop(true, "status");
      // Always-on-top alone does not join another app's full-screen Space.
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    const uiFile = join(__dirname, "../renderer/index.html");
    const devURL =
      !app.isPackaged && process.env.NOTCHED_DEV_URL === "http://127.0.0.1:5178"
        ? process.env.NOTCHED_DEV_URL
        : null;
    const trusted = (url: string) =>
      devURL ? url === devURL + "/" : url === pathToFileURL(uiFile).href;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    window.webContents.session.webRequest.onHeadersReceived(
      (details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              `default-src 'self'; script-src 'self'${devURL ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'${devURL ? " ws://127.0.0.1:5178" : ""}; object-src 'none'; frame-src 'none'; base-uri 'none'`,
            ],
          },
        }),
    );
    const placementState = () => ({
      notch: notch(),
      edge: dock.edge,
      corner: dock.corner ?? null,
      contentWidth: Math.max(
        1,
        panelBounds(display.bounds, 300, notch(), dock, extension).width -
          (dock.edge === "left" || dock.edge === "right" ? 48 + extension : 0) -
          2,
      ),
    });
    const client = new T3Client((state) => {
      if (!window.isDestroyed())
        window.webContents.send("notched:update", {
          ...state,
          ...placementState(),
        });
    });
    const credentialFile = join(app.getPath("userData"), "t3-credential.enc");
    const resize = (animate = false) => {
      const next = bounds();
      const current = window.getBounds();
      if (
        next.x === current.x &&
        next.y === current.y &&
        next.width === current.width &&
        next.height === current.height
      )
        return;
      window.setBounds(
        next,
        animate &&
          process.platform === "darwin" &&
          !systemPreferences.getAnimationSettings().prefersReducedMotion,
      );
    };
    const publishPlacement = () =>
      window.webContents.send("notched:update", {
        ...client.state,
        ...placementState(),
      });
    let savePlacementTimer: ReturnType<typeof setTimeout> | undefined;
    const savePlacement = () => {
      clearTimeout(savePlacementTimer);
      savePlacementTimer = setTimeout(() => {
        void writeFile(
          placementFile,
          JSON.stringify({ ...dock, displayId: display.id }),
        ).catch(() => {});
      }, 200);
    };
    let drag: {
      grab: { x: number; y: number };
      panel: ReturnType<typeof bounds>;
      displayId: number;
      moved: boolean;
    } | null = null;
    const finishDrag = () => {
      if (!drag || window.isDestroyed()) return;
      const { moved } = drag;
      drag = null;
      if (moved) dock = dockAt(display.bounds, window.getBounds());
      resize(true);
      publishPlacement();
      savePlacement();
    };
    window.on("blur", finishDrag);
    let displayRevision = 0;
    const refreshDisplays = async () => {
      drag = null;
      const revision = ++displayRevision;
      const next = await readNotches();
      if (window.isDestroyed() || revision !== displayRevision) return;
      notches = next;
      const displays = screen.getAllDisplays();
      display =
        displays.find((d) => d.id === display.id) ??
        displays.find((d) => notches.some((n) => n.id === d.id)) ??
        screen.getPrimaryDisplay();
      resize();
      window.webContents.send("notched:update", {
        ...client.state,
        ...placementState(),
      });
    };
    const toggle = () => {
      if (window.isVisible()) window.hide();
      else {
        finishDrag();
        resize();
        window.show();
        window.focus();
      }
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "T3 Code Notched",
          submenu: [
            {
              label: "Show / hide panel",
              accelerator: "CommandOrControl+Shift+Space",
              click: toggle,
            },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
      ]),
    );
    globalShortcut.register("CommandOrControl+Shift+Space", toggle);
    app.on("second-instance", () => {
      finishDrag();
      resize();
      window.show();
      window.focus();
    });
    app.on("activate", () => {
      finishDrag();
      resize();
      window.show();
      window.focus();
    });
    screen.on("display-metrics-changed", refreshDisplays);
    screen.on("display-removed", refreshDisplays);
    screen.on("display-added", refreshDisplays);
    // Only this renderer can call this narrow command set. Never expose ipcRenderer or arbitrary fetch.
    function handle(name: string, fn: (input: unknown) => unknown) {
      ipcMain.handle("notched:" + name, (event, input: unknown) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !trusted(event.senderFrame.url)
        )
          throw new Error("Untrusted sender");
        return fn(input);
      });
    }
    let connecting = false;
    async function connect(raw: unknown) {
      if (connecting)
        return { ok: false, message: "Connection already in progress." };
      connecting = true;
      try {
        const input = connectSchema.parse(raw);
        const credential = await client.connect(input);
        if (input.remember) await saveCredential(credentialFile, credential);
        else await forgetCredential(credentialFile);
        return { ok: true, message: "Connected to T3." };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error && error.message.startsWith("Secure storage")
              ? error.message
              : safeError(error),
        };
      } finally {
        connecting = false;
      }
    }
    handle("state", () => ({
      ...client.state,
      ...placementState(),
    }));
    handle("connect", connect);
    handle("local", async (raw) => {
      try {
        const options = z
          .object({
            remember: z.boolean(),
            allowAnswers: z.boolean().optional(),
          })
          .strict()
          .parse(raw);
        return await connect({ ...(await localPairing()), ...options });
      } catch (error) {
        return { ok: false, message: safeError(error) };
      }
    });
    handle("disconnect", async () => {
      client.disconnect();
      await forgetCredential(credentialFile);
    });
    handle("answer-question", (raw) =>
      client.answerQuestion(answerSchema.parse(raw)),
    );
    handle("usage", () => client.usage());
    handle("last-message", (raw) => client.lastMessage(id.parse(raw)));
    handle("resize", (raw) => {
      const size = z
        .object({
          height: z.number().int().min(40).max(maxPanelHeight),
          extension: z.number().int().min(0).max(600),
          cornerUsageHeight: z.number().int().min(0).max(240),
        })
        .strict()
        .parse(raw);
      height = size.height;
      extension = size.extension;
      cornerUsageHeight = size.cornerUsageHeight;
      if (!drag) resize(true);
      publishPlacement();
    });
    handle("drag", (raw) => {
      const input = dragSchema.parse(raw);
      if (input.phase === "start") {
        if (!window.isVisible()) return;
        const panel = window.getBounds();
        if (
          input.x < panel.x ||
          input.x > panel.x + panel.width ||
          input.y < panel.y ||
          input.y > panel.y + panel.height
        )
          return;
        drag = {
          grab: { x: input.x - panel.x, y: input.y - panel.y },
          panel,
          displayId: display.id,
          moved: false,
        };
      } else if (input.phase === "cancel") finishDrag();
      else if (drag) {
        drag.moved ||= isDragMovement(
          { x: drag.panel.x + drag.grab.x, y: drag.panel.y + drag.grab.y },
          input,
        );
        const displays = screen.getAllDisplays();
        // Do not jump across a gap between displays when the pointer leaves a screen.
        display =
          displays.find(
            (d) =>
              input.x >= d.bounds.x &&
              input.x < d.bounds.x + d.bounds.width &&
              input.y >= d.bounds.y &&
              input.y < d.bounds.y + d.bounds.height,
          ) ??
          displays.find((d) => d.id === drag?.displayId) ??
          screen.getPrimaryDisplay();
        drag.displayId = display.id;
        window.setBounds(
          dragBounds(display.bounds, drag.panel, input, drag.grab),
        );
        if (input.phase === "end") finishDrag();
      }
    });
    handle("move", (raw) => {
      const { direction, nudge } = z
        .object({ direction: edgeSchema, nudge: z.boolean() })
        .strict()
        .parse(raw);
      dock = moveDock(display.bounds, dock, direction, nudge);
      resize(true);
      publishPlacement();
      savePlacement();
    });
    handle("open-thread", async (raw) => {
      if (!client.canOpenThread(id.parse(raw)))
        return { ok: false, message: "Reconnect to open T3 Code." };
      try {
        // T3 0.0.38 has no external thread-selection route. Focus the app without a web fallback.
        if (process.platform === "darwin")
          await promisify(execFile)(
            "/usr/bin/open",
            ["-b", "com.t3tools.t3code"],
            { timeout: 10_000 },
          );
        else await shell.openExternal("t3code://app/");
        return { ok: true, message: "T3 Code opened." };
      } catch {
        return {
          ok: false,
          message:
            "Could not open T3 Code. Check that the desktop app is installed.",
        };
      }
    });
    handle("quit", () => app.quit());
    window.on("closed", () => app.quit());
    window.once("ready-to-show", () => window.show());
    if (devURL) await window.loadURL(devURL);
    else await window.loadFile(uiFile);
    const saved = await loadCredential(credentialFile);
    if (saved) void client.restore(saved).catch(() => {});
    app.on("before-quit", () => {
      client.disconnect();
      globalShortcut.unregisterAll();
    });
  });
