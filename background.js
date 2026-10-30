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

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseM3U8(text, baseUrl) {
  const lines = text.split('\n');
  const segments = [];
  let totalDuration = 0;
  let isMaster = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXT-X-STREAM-INF:')) { isMaster = true; continue; }
    if (t.startsWith('#EXTINF:'))           { totalDuration += parseFloat(t.slice(8)); continue; }
    if (t && !t.startsWith('#')) {
      segments.push(t.startsWith('http') ? t : baseUrl + t);
    }
  }
  return { segments, totalDuration, isMaster };
}

function slug(title) {
  if (!title) return 'stream';
  return title.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'stream';
}

// Build fetch options — uses `referrer` option (not headers) so Referer is sent
function makeFetchInit(headers) {
  const init = { headers: {} };
  if (headers['origin'])  init.headers['Origin'] = headers['origin'];
  if (headers['referer']) {
    init.referrer = headers['referer'];
    init.referrerPolicy = 'unsafe-url';
  }
  return init;
}

// ── Offscreen document (creates blob + triggers download in a real page context)

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

async function ensureOffscreen() {
  if (typeof chrome.offscreen === 'undefined') return false;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [OFFSCREEN_URL]
    });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['BLOBS'],
        justification: 'Download HLS segments as a single file'
      });
    }
    return true;
  } catch { return false; }
}

async function triggerDownload(chunks, filename) {
  const ok = await ensureOffscreen();
  if (ok) {
    // Offscreen page creates Blob + <a download> click — reliable in all MV3 Chrome
    chrome.runtime.sendMessage(
      { target: 'offscreen', action: 'download', chunks, filename },
      () => { chrome.runtime.lastError; }
    );
  } else {
    // Fallback: older Chrome without offscreen API
    const blob = new Blob(chunks, { type: 'video/mp2t' });
    const url  = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

// ── Download engine ───────────────────────────────────────────────────────────

async function runDownload(stream, idx) {
  const notify = (data) => chrome.runtime.sendMessage({ idx, ...data }).catch(() => {});

  try {
    const baseUrl   = stream.url.substring(0, stream.url.lastIndexOf('/') + 1);
    const fetchInit = makeFetchInit(stream.headers);

    notify({ action: 'downloadStatus', status: 'Récupération playlist…' });

    const m3u8Resp = await fetch(stream.url, fetchInit);
    if (!m3u8Resp.ok) throw new Error(`Playlist HTTP ${m3u8Resp.status}`);

    let { segments, totalDuration, isMaster } = parseM3U8(await m3u8Resp.text(), baseUrl);

    if (isMaster && segments.length) {
      const childUrl  = segments[0];
      const childBase = childUrl.substring(0, childUrl.lastIndexOf('/') + 1);
      const childResp = await fetch(childUrl, fetchInit);
      if (!childResp.ok) throw new Error(`Sous-playlist HTTP ${childResp.status}`);
      ({ segments, totalDuration } = parseM3U8(await childResp.text(), childBase));
    }

    notify({ action: 'downloadInfo', segmentCount: segments.length, duration: totalDuration });

    const chunks = [];
    for (let i = 0; i < segments.length; i++) {
      const r = await fetch(segments[i], fetchInit);
      if (!r.ok) throw new Error(`Segment ${i + 1} — HTTP ${r.status}`);
      chunks.push(await r.arrayBuffer());
      notify({ action: 'downloadProgress', current: i + 1, total: segments.length });
    }

    notify({ action: 'downloadStatus', status: 'Enregistrement…' });
    await triggerDownload(chunks, slug(stream.title) + '.ts');
    notify({ action: 'downloadDone' });

  } catch (err) {
    notify({ action: 'downloadError', error: err.message });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startDownload') {
    runDownload(msg.stream, msg.idx);
    sendResponse({ ok: true });
  }
  return false;
});
