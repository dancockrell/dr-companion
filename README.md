# DR Companion

Modern control panel for Dragon Realms (Genie + Lich). Demo mode works without the game.

## Windows setup

1. Install **Node.js LTS** from https://nodejs.org (includes npm).
2. Unzip `dr-companion.zip` somewhere simple, e.g.:
   - `C:\Users\Admin\Desktop\dr-companion`
3. Open **Command Prompt** and run:

```bat
cd C:\Users\Admin\Desktop\dr-companion
npm install
npm run dev
```

4. When Vite prints a URL (usually `http://localhost:1420`), open it in your browser.
5. Click **Skip to demo** to try the dashboard without installing Ruby/Lich.

## Notes

- `/path/to/dr-companion` was only a placeholder — use your real folder path.
- Windows paths use backslashes: `cd C:\Users\Admin\Desktop\dr-companion`
- Demo mode does not need Genie or Lich. Live control comes later.

## Design

See `../DR_Companion_Design_Document.md` in the artifacts folder if present.
