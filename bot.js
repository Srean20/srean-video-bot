/**
 * bot.js — Telegram Video Downloader Bot
 *
 * Platforms: YouTube, TikTok, Facebook
 * Flow: URL → Quality picker → Caption? → Download → Send (with credit)
 */

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { downloadVideo, getFormats } = require('./downloaders');
const { extractUrls, detectPlatform, platformLabel } = require('./utils/helpers');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ BOT_TOKEN is not set in .env');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('🤖 Bot is running...');

// ─── Per-chat state store ─────────────────────────────────────────────────────
// State shape:
//   step: 'quality' | 'caption_choice' | 'caption_text'
//   url, platform, formats[], selectedFormat, statusMsgId
const chatStates = new Map();

// Credit appended to all downloads
const CREDIT = '🎬 Credit: KimSrean Heng\n✈️ : t.me/kimsrean20';

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
    const name = msg.from?.first_name || 'there';
    bot.sendMessage(msg.chat.id,
        `👋 Hello, *${name}*! I'm your Video Downloader Bot.\n\n` +
        `Just paste a video link and I'll:\n` +
        `1️⃣ Show available quality options\n` +
        `2️⃣ Ask if you want to add a caption\n` +
        `3️⃣ Send you the video 🎬\n\n` +
        `Supported:\n` +
        `▶️ YouTube  |  🎵 TikTok  |  📘 Facebook`,
        { parse_mode: 'Markdown' }
    );
});

// ─── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
        `📖 *How to use:*\n\n` +
        `1. Send a YouTube, TikTok, or Facebook video URL\n` +
        `2. Pick your preferred quality from the list\n` +
        `3. Choose whether to add a custom caption\n` +
        `4. Receive your video! 🎉\n\n` +
        `⚠️ *Max file size:* 50 MB (Telegram limit)\n` +
        `🔓 Only public videos are supported`,
        { parse_mode: 'Markdown' }
    );
});

// ─── /cancel ──────────────────────────────────────────────────────────────────
bot.onText(/\/cancel/, (msg) => {
    chatStates.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, '❌ Current operation cancelled. Send a new link any time!');
});

// ─── Message handler ──────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Skip commands
    if (text.startsWith('/')) return;

    const state = chatStates.get(chatId);

    // ── Waiting for the user's custom caption text ────────────────────────────
    if (state?.step === 'caption_text') {
        chatStates.delete(chatId);
        const caption = text.trim();
        await startDownload(chatId, state, caption);
        return;
    }

    // ── New URL ───────────────────────────────────────────────────────────────
    const urls = extractUrls(text);
    if (urls.length === 0) {
        if (text.trim().length > 0) {
            bot.sendMessage(chatId,
                `🔗 Please send a valid video link.\n\nSupported: YouTube, TikTok, Facebook\nType /help for info.`
            );
        }
        return;
    }

    const url = urls[0];
    const platform = detectPlatform(url);

    if (!platform) {
        bot.sendMessage(chatId,
            `❌ *Unsupported platform.*\nI support:\n▶️ YouTube | 🎵 TikTok | 📘 Facebook`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const label = platformLabel(platform);

    // Show "fetching qualities" message
    let fetchMsg;
    try {
        fetchMsg = await bot.sendMessage(chatId,
            `🔍 ${label} link detected!\nFetching available qualities...`
        );
    } catch (e) {
        console.error('Failed to send fetch msg:', e.message);
        return;
    }

    let formats, videoInfo;
    try {
        const result = await getFormats(url);
        formats = result.options;
        videoInfo = result.videoInfo;
    } catch (e) {
        bot.editMessageText(
            `❌ Could not fetch video info.\n\n${e.message}\n\nCheck the link and try again.`,
            { chat_id: chatId, message_id: fetchMsg.message_id }
        ).catch(() => { });
        return;
    }

    // Save state
    chatStates.set(chatId, {
        step: 'quality',
        url,
        platform,
        formats,
        videoInfo,
        statusMsgId: fetchMsg.message_id,
    });

    // Build quality buttons — skip disabled/note entries
    const selectableFormats = formats.filter(f => !f.disabled);
    const hasNoFfmpegNote = formats.some(f => f.disabled);

    const buttons = selectableFormats.map((f) => ([{
        text: f.label,
        callback_data: `q:${f.index}`,
    }]));
    buttons.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

    const noteText = hasNoFfmpegNote
        ? `\n\n⚠️ _Quality limited: install ffmpeg for 1080p/4K_`
        : ``;

    bot.editMessageText(
        `✅ *${label}* video found!\n\nChoose a quality:${noteText}`,
        {
            chat_id: chatId,
            message_id: fetchMsg.message_id,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons },
        }
    ).catch(() => { });
});

// ─── Callback query handler ───────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data;

    // Acknowledge the tap immediately
    bot.answerCallbackQuery(query.id).catch(() => { });

    if (data === 'cancel') {
        chatStates.delete(chatId);
        bot.editMessageText('❌ Cancelled. Send a new link any time!',
            { chat_id: chatId, message_id: msgId }
        ).catch(() => { });
        return;
    }

    const state = chatStates.get(chatId);
    if (!state) {
        bot.editMessageText('⚠️ Session expired. Please send the link again.',
            { chat_id: chatId, message_id: msgId }
        ).catch(() => { });
        return;
    }

    // ── Quality selected ───────────────────────────────────────────────────────
    if (data.startsWith('q:')) {
        const idx = parseInt(data.replace('q:', ''), 10);
        const selected = state.formats.find(f => f.index === idx);
        if (!selected) {
            bot.answerCallbackQuery(query.id, { text: 'Invalid option, please try again.' }).catch(() => { });
            return;
        }

        chatStates.delete(chatId);

        // Go straight to download — no caption prompt
        await startDownload(chatId, { ...state, selectedFormat: selected }, null, msgId);
        return;
    }

    // ── Caption choice ─────────────────────────────────────────────────────────
    if (data.startsWith('cap:')) {
        const wantsCaption = data === 'cap:yes';

        if (wantsCaption) {
            chatStates.set(chatId, { ...state, step: 'caption_text' });
            bot.editMessageText(
                `✏️ *Type your caption* and send it as a message:`,
                {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: 'Markdown',
                }
            ).catch(() => { });
        } else {
            chatStates.delete(chatId);
            await startDownload(chatId, state, null, msgId);
        }
        return;
    }
});

// ─── Download orchestration ───────────────────────────────────────────────────
/**
 * Initiates and handles the full download → send flow.
 *
 * @param {number} chatId
 * @param {object} state   — { url, platform, selectedFormat }
 * @param {string|null} userCaption
 * @param {number|null} existingMsgId — edit this message instead of sending new one
 */
async function startDownload(chatId, state, userCaption, existingMsgId = null) {
    const { url, platform, selectedFormat } = state;
    const label = platformLabel(platform);

    let statusMsgId = existingMsgId;

    // Send or update status message
    try {
        if (statusMsgId) {
            await bot.editMessageText(
                `⏳ Downloading *${selectedFormat.label}*...\nPlease wait.`,
                { chat_id: chatId, message_id: statusMsgId, parse_mode: 'Markdown' }
            );
        } else {
            const m = await bot.sendMessage(chatId,
                `⏳ Downloading *${selectedFormat.label}*...\nPlease wait.`,
                { parse_mode: 'Markdown' }
            );
            statusMsgId = m.message_id;
        }
    } catch (e) {
        console.error('Status message error:', e.message);
    }

    let cleanup = null;
    try {
        console.log(`[${new Date().toISOString()}] ⬇️ Downloading (${selectedFormat.label}) from ${platform}: ${url}`);

        const result = await downloadVideo(url, selectedFormat.selector);
        cleanup = result.cleanup;

        // Update status
        bot.editMessageText('📤 Download complete! Sending video...',
            { chat_id: chatId, message_id: statusMsgId }
        ).catch(() => { });

        // Send video with caption (credit only)
        await bot.sendVideo(chatId, result.filePath, {
            caption: CREDIT,
            supports_streaming: true,
        });

        // Send the original video caption as a separate copyable message
        const originalCaption = state.videoInfo?.description || state.videoInfo?.title || '';
        if (originalCaption.trim()) {
            await bot.sendMessage(chatId,
                `📋 *Caption:*\n${originalCaption}`,
                { parse_mode: 'Markdown' }
            );
        }

        // Clean up status message
        bot.deleteMessage(chatId, statusMsgId).catch(() => { });

        console.log(`[${new Date().toISOString()}] ✅ Sent: ${result.title}`);

    } catch (err) {
        console.error(`[${new Date().toISOString()}] ❌ Error:`, err.message);
        bot.editMessageText(
            `❌ *Download failed*\n\n${err.message}\n\nPlease try a lower quality or another link.`,
            { chat_id: chatId, message_id: statusMsgId, parse_mode: 'Markdown' }
        ).catch(() => {
            bot.sendMessage(chatId, `❌ Failed: ${err.message}`);
        });
    } finally {
        if (cleanup) { try { cleanup(); } catch { } }
    }
}

// ─── Polling error handler ────────────────────────────────────────────────────
bot.on('polling_error', (err) => {
    console.error('Polling error:', err.message || err);
});
