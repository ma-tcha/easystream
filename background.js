const KEEP_HEADERS = ['referer', 'origin', 'user-agent', 'cookie', 'authorization'];

// Resolve the real HLS playlist URL from a request, or null if it isn't one.
// - A direct playlist has a path ending in `.m3u8` (query string ignored).
// - Analytics pings (e.g. JWPlayer `ping.gif`) aren't playlists themselves but
//   carry the real media URL, percent-encoded, in a `mu` param — recover that.
function resolveM3U8Url(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }

  if (u.pathname.toLowerCase().endsWith('.m3u8')) return rawUrl;

  const mu = u.searchParams.get('mu');
  if (mu && /^https?:\/\/\S+\.m3u8(\?|$)/i.test(mu)) return mu;

  return null;
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const streamUrl = resolveM3U8Url(details.url);
    if (!streamUrl) return;

    const headers = {};
    if (details.requestHeaders) {
      for (const h of details.requestHeaders) {
        const key = h.name.toLowerCase();
        if (KEEP_HEADERS.includes(key)) headers[key] = h.value;
      }
    }

    const saveEntry = (title) => {
      const entry = { url: streamUrl, headers, title: title || '', ts: Date.now() };
      chrome.storage.local.get({ streams: [] }, (data) => {
        if (data.streams.some(s => s.url === entry.url)) return;
        data.streams.unshift(entry);
        chrome.storage.local.set({ streams: data.streams.slice(0, 100) });
      });
    };

    if (details.tabId >= 0) {
      chrome.tabs.get(details.tabId, (tab) => {
        saveEntry(tab && tab.title ? tab.title : '');
      });
    } else {
      saveEntry('');
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);
