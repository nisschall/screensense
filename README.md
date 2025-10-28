## ScreenSense v1.1

ScreenSense is a Windows tray application that sits in the system tray, captures a full-screen screenshot on demand, and optionally sends it to an AI model for a quick description. The app is built with Electron and Node.js.

### Features
- Background tray app with quick toggle for AI processing.
- Global shortcuts (fallbacks: `Ctrl+Shift+S`, `Ctrl+Alt+S`) and tray action to capture screenshots from anywhere.
- Full-screen capture using `screenshot-desktop`, stored in your Pictures folder.
- Optional OpenAI Vision integration for one-line screenshot summaries.
- Floating, closeable popup at the top of the screen showing capture details with options to enhance the AI summary or delete the screenshot.
- Notifications for capture success, AI status, and errors, plus persistent summaries in `ai_results.json`.

### Getting Started
1. Install dependencies:
   ```powershell
   npm install
   ```
2. Provide an OpenAI API key (if you plan to use AI):
   ```powershell
   setx OPENAI_API_KEY "sk-your-key"
   ```
   Restart the app after setting the key so the environment variable is available.  
   Alternatively, create a `.env` file in the project root (or install directory) containing:
   ```env
   OPENAI_API_KEY=sk-your-key
   ```
3. Start the app in development mode:
   ```powershell
   npm run dev
   ```
   The ScreenSense icon appears in the system tray. Right-click the icon to access the context menu.

### Configuration
Settings live in `config.json` at the project root. Default values:
```json
{
  "ai_enabled": true,
  "ai_model": "gpt-4o-mini",
  "screenshot_folder": "C:/Users/Default/Pictures/ScreenSense",
  "log_limit": 100,
  "openai_api_key_env": "OPENAI_API_KEY",
  "capture_shortcut": ["Ctrl+Shift+S", "Ctrl+Alt+S"],
  "ai_enhance_prompt": "Provide a more detailed description of the screen, highlighting important text, UI elements, and context."
}
```

- `ai_enabled`: toggle AI usage on launch. You can also switch from the tray menu.
- `ai_model`: any compatible OpenAI Vision model id.
- `screenshot_folder`: root folder for saved captures and `ai_results.json`.
- `log_limit`: maximum entries retained in `ai_results.json`.
- `openai_api_key_env`: environment variable the app reads for the API key.
- `capture_shortcut`: supply a string or array of strings; the app tries each shortcut until one registers successfully.
- `ai_enhance_prompt`: prompt override used when the popup’s **Enhance** button is pressed for a richer summary.

Any manual edits to `config.json` are picked up automatically while the app runs.

### Building
Create a production build with:
```powershell
npm run build
```
Installer artifacts output to `dist/`. Ensure you have an icon file at `build/icon.ico` (and optionally `icon-on.png` and `icon-off.png`) prior to building.

### Logging
- Application log: managed by `electron-log` (open via tray menu -> *View Log*).
- AI summaries: saved to `<screenshot_folder>/ai_results.json` and capped based on `log_limit`.

### Troubleshooting
- **Shortcut fails to register**: make sure the key combo isn't used by another app; adjust `capture_shortcut` in `config.json` and restart.
- **Notifications missing**: verify notifications are enabled in Windows settings and that the app ID `com.screensense.app` is registered.
- **AI disabled warning**: confirm the `OPENAI_API_KEY` environment variable is present if AI is toggled on.

### License
MIT
