/**
 * downloaders/index.js — Video downloader using yt-dlp
 *
 * Supports YouTube, TikTok, Facebook.
 * Works WITHOUT ffmpeg using single-file (pre-muxed) format selection.
 *
 * Root cause of YouTube/FB issues: without ffmpeg, only pre-muxed formats work.
 * YouTube has only 1 pre-muxed stream (360p). We expose this honestly to users
 * and provide a "Best Available" that lets yt-dlp pick the best single file.
 */

const { execFile, execSync } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10);
const MAX_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ─── Check tool availability at startup ───────────────────────────────────────
let hasFfmpeg = false;
try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    hasFfmpeg = true;
} catch { hasFfmpeg = false; }

function getYtDlpCmd() {
    try {
        execSync('yt-dlp --version', { stdio: 'ignore' });
        return { cmd: 'yt-dlp', args_prefix: [] };
    } catch {
        return { cmd: 'python3', args_prefix: ['-m', 'yt_dlp'] };
    }
}

console.log(`[downloader] ffmpeg: ${hasFfmpeg ? '✅ available' : '❌ not found (using pre-muxed only)'}`);

// ─── Build format selectors ───────────────────────────────────────────────────
/**
 * Build a yt-dlp format selector for a given max height.
 * Without ffmpeg, we use "best" which picks the best single-file (pre-muxed) format.
 * With ffmpeg, we can merge separate video+audio streams for higher quality.
 *
 * @param {number|null} maxHeight — null means "no restriction"
 * @returns {string}
 */
function makeSelector(maxHeight) {
    if (hasFfmpeg) {
        if (maxHeight === null) {
            return `bestvideo+bestaudio/best`;
        }
        return `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`;
    } else {
        // No ffmpeg: "best" picks the best single pre-muxed file
        // Adding height restriction where possible
        if (maxHeight === null) {
            return `best`;
        }
        return `best[height<=${maxHeight}]/best`;
    }
}

// ─── getFormats ────────────────────────────────────────────────────────────────
/**
 * Fetches available quality options for a URL.
 * Returns an array of format objects for display as inline keyboard buttons.
 *
 * Strategy:
 * 1. Run yt-dlp -j to get real format list
 * 2. Extract unique heights from pre-muxed formats (or all video formats if ffmpeg available)
 * 3. Fall back to preset tiers if real format info unavailable
 *
 * @param {string} url
 * @returns {Promise<{options: Array, videoInfo: {title: string, description: string}}>}
 */
async function getFormats(url) {
    const { cmd, args_prefix } = getYtDlpCmd();
    const args = [
        ...args_prefix,
        url,
        '-j',
        '--no-warnings',
        '--no-playlist',
        '--socket-timeout', '30',
    ];

    let videoHeights = [];
    let videoInfo = { title: '', description: '' };
    try {
        const { stdout } = await execFileAsync(cmd, args, { timeout: 45_000 });

        // Parse JSON robustly — yt-dlp sometimes has extra text; try trim, then line-by-line
        let info = null;
        try {
            info = JSON.parse(stdout.trim());
        } catch {
            // Try finding JSON on any line
            for (const line of stdout.split('\n').reverse()) {
                try { info = JSON.parse(line.trim()); break; } catch { }
            }
        }

        if (info) {
            // Capture original video title & description
            videoInfo.title = (info.title || info.fulltitle || '').trim();
            videoInfo.description = (info.description || '').trim();

            if (Array.isArray(info.formats)) {
                const fmts = info.formats;

                if (hasFfmpeg) {
                    const videoFmts = fmts
                        .filter(f => f.vcodec && f.vcodec !== 'none' && f.height && f.ext !== 'mhtml')
                        .sort((a, b) => (b.height || 0) - (a.height || 0));
                    const seen = new Set();
                    for (const f of videoFmts) {
                        if (!seen.has(f.height)) { seen.add(f.height); videoHeights.push(f.height); }
                    }
                } else {
                    const premuxed = fmts
                        .filter(f =>
                            f.vcodec && f.vcodec !== 'none' &&
                            f.acodec && f.acodec !== 'none' &&
                            f.height && f.ext !== 'mhtml'
                        )
                        .sort((a, b) => (b.height || 0) - (a.height || 0));
                    const seen = new Set();
                    for (const f of premuxed) {
                        if (!seen.has(f.height)) { seen.add(f.height); videoHeights.push(f.height); }
                    }
                }
            }
        }
    } catch (err) {
        console.warn(`[getFormats] Failed to get JSON info: ${err.message}`);
    }

    // Build quality options
    const options = [];

    // Always put "Best Available" first
    options.push({
        index: 0,
        selector: makeSelector(null),
        label: '🏆 Best Available',
    });

    if (videoHeights.length > 0) {
        // Real quality tiers from actual format list
        for (let i = 0; i < Math.min(videoHeights.length, 5); i++) {
            const h = videoHeights[i];
            options.push({
                index: i + 1,
                selector: makeSelector(h),
                label: `📹 ${h}p`,
            });
        }
    } else {
        // Fallback presets when real format info is unavailable
        const presets = hasFfmpeg
            ? [1080, 720, 480, 360]
            : [720, 480, 360]; // fewer options without ffmpeg
        for (let i = 0; i < presets.length; i++) {
            options.push({
                index: i + 1,
                selector: makeSelector(presets[i]),
                label: `📹 ${presets[i]}p`,
            });
        }
    }

    if (!hasFfmpeg) {
        // Warn user that high quality needs ffmpeg
        options.push({
            index: options.length,
            selector: makeSelector(null),
            label: '⚠️ Note: High quality needs ffmpeg',
            disabled: true,
        });
    }

    console.log(`[getFormats] ${url.substring(0, 40)}... → ${options.length} options, heights: [${videoHeights.join(', ')}]`);
    return { options, videoInfo };
}

// ─── downloadVideo ─────────────────────────────────────────────────────────────
/**
 * Downloads a video using the given yt-dlp format selector.
 *
 * @param {string} url
 * @param {string} selector
 * @returns {Promise<{filePath: string, title: string, cleanup: Function}>}
 */
async function downloadVideo(url, selector) {
    const format = selector || makeSelector(null);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgbot-'));
    const outputTemplate = path.join(tmpDir, '%(title).80s.%(ext)s');

    const { cmd, args_prefix } = getYtDlpCmd();
    const args = [
        ...args_prefix,
        url,
        '-f', format,
        '--no-playlist',
        '--socket-timeout', '60',
        '--no-warnings',
        '-o', outputTemplate,
    ];

    console.log(`[download] cmd: ${cmd} -f "${format}" ${url.substring(0, 60)}`);

    try {
        const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 300_000 });
        if (stderr) console.warn(`[download] stderr:`, stderr.substring(0, 200));
    } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        const msg = (err.stderr || err.stdout || err.message || 'Unknown error').substring(0, 300);
        throw new Error(`Download failed: ${msg}`);
    }

    const files = fs.readdirSync(tmpDir);
    if (files.length === 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error(
            'Download completed but no file was saved.\n' +
            (hasFfmpeg ? '' : 'Tip: install ffmpeg for higher quality options.')
        );
    }

    // Pick the largest file (in case of partial downloads in dir)
    const filePath = files
        .map(f => ({ name: f, size: fs.statSync(path.join(tmpDir, f)).size }))
        .sort((a, b) => b.size - a.size)[0];

    const fullPath = path.join(tmpDir, filePath.name);
    const size = filePath.size;

    if (size > MAX_BYTES) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error(
            `Video is too large (${(size / 1024 / 1024).toFixed(1)} MB). ` +
            `Max is ${MAX_FILE_SIZE_MB} MB. Please choose a lower quality.`
        );
    }

    const title = path.basename(filePath.name, path.extname(filePath.name));
    console.log(`[download] ✅ File: ${filePath.name} (${(size / 1024 / 1024).toFixed(1)} MB)`);

    return {
        filePath: fullPath,
        title,
        cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
}

module.exports = { downloadVideo, getFormats, hasFfmpeg };
