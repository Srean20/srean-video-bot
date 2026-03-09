# 🎬 Telegram Video Downloader Bot

A Telegram bot that downloads videos from **YouTube**, **TikTok**, and **Facebook** and sends them directly in chat.

## Features

- ▶️ YouTube (videos, Shorts)
- 🎵 TikTok (videos, reels)
- 📘 Facebook (public videos)
- ✅ Automatic platform detection
- 🤖 Real-time progress messages
- 🗑️ Auto-cleanup of temp files
- ⚠️ Friendly errors for unsupported/oversized videos

---

## Prerequisites

1. **Node.js** (v16+): https://nodejs.org
2. **yt-dlp** (video downloader):
   ```bash
   brew install yt-dlp
   ```
3. **ffmpeg** (for merging video+audio):
   ```bash
   brew install ffmpeg
   ```

---

## Setup & Run

```bash
# 1. Install Node dependencies
cd /Users/kimsrean/Downloads/Bot-Telegram
npm install

# 2. Start the bot
node bot.js
```

The bot will print `🤖 Bot is running...` when ready.

---

## Project Structure

```
Bot-Telegram/
├── bot.js              # Main bot logic
├── downloaders/
│   └── index.js        # yt-dlp wrapper
├── utils/
│   └── helpers.js      # URL detection helpers
├── .env                # Bot token (keep secret!)
├── package.json
└── README.md
```

---

## Usage (in Telegram)

1. Open your bot in Telegram
2. Send `/start`
3. Paste any supported video URL
4. Wait for the bot to download and send the video 🎉

---

## Notes

- Maximum video size: **50 MB** (Telegram bot limit)
- Only **public** videos are supported
- The bot downloads the best quality that fits within 50 MB

---

## Keep Running (Optional)

Use `pm2` to keep the bot running in the background:

```bash
npm install -g pm2
pm2 start bot.js --name "video-bot"
pm2 save
pm2 startup
```
