/**
 * helpers.js — URL detection and platform identification utilities
 */

/**
 * Extracts all URLs from a given text string.
 * @param {string} text
 * @returns {string[]} Array of URLs found
 */
function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = text.match(urlRegex);
  return matches ? matches : [];
}

/**
 * Detects which supported platform the URL belongs to.
 * @param {string} url
 * @returns {'youtube'|'tiktok'|'facebook'|null}
 */
function detectPlatform(url) {
  try {
    const lower = url.toLowerCase();

    if (
      lower.includes('youtube.com/watch') ||
      lower.includes('youtu.be/') ||
      lower.includes('youtube.com/shorts/')
    ) {
      return 'youtube';
    }

    if (
      lower.includes('tiktok.com') ||
      lower.includes('vm.tiktok.com') ||
      lower.includes('vt.tiktok.com')
    ) {
      return 'tiktok';
    }

    if (
      lower.includes('facebook.com/') ||
      lower.includes('fb.watch/') ||
      lower.includes('fb.com/')
    ) {
      return 'facebook';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Returns a human-friendly platform label with emoji.
 * @param {string} platform
 * @returns {string}
 */
function platformLabel(platform) {
  switch (platform) {
    case 'youtube':  return '▶️ YouTube';
    case 'tiktok':   return '🎵 TikTok';
    case 'facebook': return '📘 Facebook';
    default:         return '🌐 Unknown';
  }
}

module.exports = { extractUrls, detectPlatform, platformLabel };
