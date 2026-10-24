# Blackout

Blackout is a browser extension that blacks out unwanted topics, people and
spoilers on web pages. You define filter profiles of terms and matching rules;
when a news card, video tile or feed post matches, Blackout blacks it out while
keeping the page layout intact. You can reveal a blocked item on demand, and
profiles can expire on their own (handy for spoilers).

Everything runs on your device. The extension makes no network requests of any
kind, has no account or backend, and sends no analytics. Chrome comes first;
the same source is kept portable for other Chromium browsers, Firefox and Safari.

## Build

Run from Windows PowerShell:

```powershell
npm install
npm run build
```

`npm run build` writes the unpacked Chrome package to `dist\chrome`. The
placeholder icons are checked in; to regenerate them run `npm run icons`.

Run the tests (this builds first):

```powershell
npm test
```

## Load it unpacked in Chrome

1. Build the package with `npm run build`.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `dist\chrome` folder in this repo.
5. Open any page and check the console for `[blackout] loaded`.
