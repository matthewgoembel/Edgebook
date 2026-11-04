# Edgebook

A private trading journal for Topstep traders. It runs on a small always-on server, so it stays open in a browser tab and keeps your whole history.

GitHub holds the code. A host runs it and keeps your data on a persistent disk. Your trades, notes, screenshots and API key are never stored in this repository.

## Put it online with Railway

1. Sign in at [railway.com](https://railway.com) with GitHub and choose a paid plan. An always-on app with a disk needs one.
2. Choose **New Project**, then **Deploy from GitHub repo**, and pick this repository. It finds the `Dockerfile` by itself.
3. On the service, open **Variables** and add `EDGEBOOK_PASSWORD` with a long password of your own. The app refuses to start without it.
4. Right-click the service, add a **Volume**, and set its mount path to `/data`. This is what keeps your history. Without it, every deploy wipes your journal.
5. Open **Settings**, then **Networking**, and choose **Generate Domain**.
6. Open that address, sign in, and pin the tab. You stay signed in for 180 days on that browser.
7. In the app's Settings, add your Claude API key and your break-even range.

Every push to `main` redeploys automatically, and your data stays on the volume.

## Daily routine

1. Export your trades from Topstep, then drop the CSV into **Upload Trades**. Uploading the same trades twice is safe.
2. On the day page, paste your chart and your executions: click a box, then press Ctrl+V.
3. Write your journal, pick your mood, tick your checklist.
4. Click **Debrief this day** for the AI read of the session.

Bring in your history by uploading every older Topstep export at once. Pick the matching account for each batch, because the CSV does not say which account it came from.

## AI setup

Create a key at console.anthropic.com under API Keys and paste it into Settings. API usage is billed separately from a Claude subscription. Nothing goes to the API until you run a report or ask a question, and each report shows its cost.

## Good to know

- **Break-even range:** set it to your TradeZella value. It changes win rate, profit factor and the WIN/LOSS/BE labels.
- **Market data** comes from Yahoo's free feed. It keeps 1-minute bars for about a month and 5-minute bars for about two months, so uploading daily keeps every day charted. Older days have no bars, and the AI relies on your notes and screenshots for those.
- **Backups:** the server keeps a daily database copy on the volume, holding the last 14. Those live on the same disk as the journal, so use **Settings > Download backup** now and then to keep your own copy. That file does not include screenshots.
- **Changing your password:** update `EDGEBOOK_PASSWORD` on the host. This signs out every device.

## Run it on your own computer

Double-click **Edgebook.bat**. It runs at http://localhost:4310 with no password and keeps its data in a local `data` folder, which is separate from the hosted journal.

## Development

```bash
npm run dev
```

```bash
npm test
```
