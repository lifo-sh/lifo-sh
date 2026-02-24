# UI Roadmap

## Level 1: File Explorer (Current)

A standalone `FileExplorer` component in `@lifo-sh/ui` that attaches to the VFS.

### Features
- Tree view sidebar with expandable directories
- List view for directory contents (icon, name, size, modified date)
- Double-click to open folders / view files
- File viewer/editor panel for text files
- Context menu (right-click): new file, new folder, rename, delete
- Breadcrumb navigation bar
- File type icons by extension
- Reacts to VFS changes via `vfs.watch()` (or `onChange`)
- Keyboard navigation (arrow keys, Enter, Delete, Backspace)

### Architecture
- Vanilla TypeScript (no framework), consistent with existing `Terminal` class
- Takes a `VFS` instance and a container `HTMLElement`
- CSS scoped via a class prefix (`lifo-explorer-*`)
- Emits events for file open, selection change, etc.

### Demo
- New "File Explorer" tab in vite-app
- Boots a Sandbox, attaches FileExplorer to the VFS
- Side-by-side with a Terminal sharing the same Kernel so changes reflect live

---

## Level 2: Window Manager

A `Desktop` + `WindowManager` that hosts components in draggable/resizable windows.

### Features
- Window chrome: title bar, minimize, maximize, close buttons
- Drag to move, resize from edges/corners
- Z-index stacking with focus management
- Taskbar showing open windows with minimize/restore
- Snap to edges (half-screen left/right)
- Windows can host: Terminal, File Explorer, Text Editor, etc.
- Inter-window communication (double-click file in explorer -> opens in editor)

### Architecture
- `WindowManager` class manages window lifecycle
- Each window gets an `HTMLElement` container passed to the hosted component
- Event bus for cross-window messages (file open, etc.)

---

## Level 3: Desktop Environment

Full desktop metaphor built on the Window Manager.

### Features
- Desktop icons (drag to arrange, double-click to open)
- Wallpaper (configurable, stored in VFS)
- App launcher / start menu with installed apps
- System tray: clock, notifications
- Multi-workspace / virtual desktops
- File type associations (`/etc/mime.types` -> app mapping)
- Registered "apps" that can claim file types

### Architecture
- `Desktop` class orchestrates the full environment
- App registry in VFS (`/etc/apps/`) defines available apps
- MIME type -> app mapping for "open with" behavior
- Session persistence (open windows, positions) via VFS
