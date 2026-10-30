const HEADER_ORDER = ['referer', 'origin', 'user-agent', 'cookie', 'authorization'];

function slugTitle(title) {
  if (!title) return 'stream';
  return title.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').replace(/^-+/, '').slice(0, 60) || 'stream';
}

// URLs and headers come from visited pages: quote them so a pasted command
// can't break out of its argument.
function shQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Same, for the inside of a bash $'...' string.
function ansiEscape(value) {
  return value.replace(/[\\']/g, '\\$&');
}

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR');
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function buildCurl(stream) {
  const lines = [`curl ${shQuote(stream.url)}`, '  --compressed'];
  for (const key of HEADER_ORDER) {
    if (stream.headers[key]) lines.push(`  -H ${shQuote(`${key}: ${stream.headers[key]}`)}`);
  }
  return lines.join(' \\\n');
}

function buildFfmpeg(stream) {
  const h = stream.headers;
  const parts = [];
  if (h['user-agent']) parts.push(`User-Agent: ${ansiEscape(h['user-agent'])}\\r\\n`);
  if (h['referer'])    parts.push(`Referer: ${ansiEscape(h['referer'])}\\r\\n`);
  if (h['origin'])     parts.push(`Origin: ${ansiEscape(h['origin'])}\\r\\n`);
  const lines = ['ffmpeg'];
  if (parts.length) lines.push(`  -headers $'${parts.join('')}'`);
  lines.push(`  -i ${shQuote(stream.url)}`);
  lines.push(`  -c copy ${slugTitle(stream.title)}.mp4`);
  return lines.join(' \\\n');
}

function buildVlc(stream) {
  const h = stream.headers;
  const parts = ['vlc'];
  if (h['referer']) parts.push(`  --http-referrer ${shQuote(h['referer'])}`);
  parts.push(`  ${shQuote(stream.url)}`);
  return parts.join(' \\\n');
}

function buildYtdlp(stream) {
  const h = stream.headers;
  const parts = ['yt-dlp'];
  if (h['referer'])    parts.push(`  --add-header ${shQuote(`Referer: ${h['referer']}`)}`);
  if (h['origin'])     parts.push(`  --add-header ${shQuote(`Origin: ${h['origin']}`)}`);
  if (h['user-agent']) parts.push(`  --add-header ${shQuote(`User-Agent: ${h['user-agent']}`)}`);
  parts.push(`  -o "${slugTitle(stream.title)}.%(ext)s"`);
  parts.push(`  ${shQuote(stream.url)}`);
  return parts.join(' \\\n');
}

const COMMANDS = { curl: buildCurl, ffmpeg: buildFfmpeg, vlc: buildVlc, 'yt-dlp': buildYtdlp };

// ── Download via background service worker (bypasses CORS) ───────────────────

function startDownload(stream, idx) {
  const dlBtn  = document.getElementById(`dl-btn-${idx}`);
  const pWrap  = document.getElementById(`progress-${idx}`);
  const pBar   = document.getElementById(`progress-bar-${idx}`);
  const pText  = document.getElementById(`progress-text-${idx}`);
  const infoEl = document.getElementById(`info-${idx}`);

  dlBtn.disabled = true;
  dlBtn.textContent = 'Connexion…';
  pWrap.classList.remove('hidden');
  pBar.style.width = '0%';
  pText.textContent = '…';

  const listener = (msg) => {
    if (msg.idx !== idx) return;

    if (msg.action === 'downloadStatus') {
      pText.textContent = msg.status;

    } else if (msg.action === 'downloadInfo') {
      infoEl.textContent = `${msg.segmentCount} segments · ${formatDuration(msg.duration)}`;
      pText.textContent = `0 / ${msg.segmentCount} · 0%`;

    } else if (msg.action === 'downloadProgress') {
      const pct = Math.round((msg.current / msg.total) * 100);
      pBar.style.width = pct + '%';
      pText.textContent = `${msg.current} / ${msg.total} · ${pct}%`;

    } else if (msg.action === 'downloadDone') {
      chrome.runtime.onMessage.removeListener(listener);
      pBar.style.width = '100%';
      pText.textContent = 'Terminé';
      dlBtn.textContent = '✓ Téléchargé';
      dlBtn.classList.add('done');

    } else if (msg.action === 'downloadError') {
      chrome.runtime.onMessage.removeListener(listener);
      dlBtn.disabled = false;
      dlBtn.textContent = '⬇ Télécharger';
      pBar.style.width = '0%';
      pText.textContent = `Erreur : ${msg.error}`;
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  chrome.runtime.sendMessage({ action: 'startDownload', stream, idx });
}

// ── Render ───────────────────────────────────────────────────────────────────

function render(streams) {
  const list = document.getElementById('list');
  if (!streams.length) {
    list.innerHTML = '<div id="empty">Aucun flux M3U8 détecté.</div>';
    return;
  }

  list.innerHTML = streams.map((s, i) => `
    <div class="stream">
      <div class="stream-url" title="${escapeHtml(s.url)}">${escapeHtml(s.url)}</div>
      <div class="stream-meta">
        <span class="stream-time">${formatTime(s.ts)}</span>
        <span class="stream-info" id="info-${i}"></span>
      </div>
      <div class="progress-wrap hidden" id="progress-${i}">
        <div class="progress-track"><div class="progress-bar" id="progress-bar-${i}"></div></div>
        <span class="progress-text" id="progress-text-${i}"></span>
      </div>
      <div class="actions">
        <button class="dl-btn" id="dl-btn-${i}">⬇ Télécharger</button>
        <div class="tabs">
          ${Object.keys(COMMANDS).map((cmd, j) =>
            `<button class="tab${j === 0 ? ' active' : ''}" data-stream="${i}" data-cmd="${cmd}">${cmd}</button>`
          ).join('')}
        </div>
      </div>
      ${Object.entries(COMMANDS).map(([cmd, fn], j) => `
        <div class="cmd-block${j === 0 ? '' : ' hidden'}" id="cmd-${i}-${cmd}">
          <pre id="pre-${i}-${cmd}">${escapeHtml(fn(s))}</pre>
          <button class="copy-btn" data-pre="pre-${i}-${cmd}">Copier</button>
        </div>
      `).join('')}
    </div>
  `).join('');

  streams.forEach((s, i) => {
    document.getElementById(`dl-btn-${i}`).addEventListener('click', () => startDownload(s, i));
  });

  list.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const si = tab.dataset.stream;
      list.querySelectorAll(`.tab[data-stream="${si}"]`).forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.keys(COMMANDS).forEach(cmd => {
        document.getElementById(`cmd-${si}-${cmd}`).classList.toggle('hidden', cmd !== tab.dataset.cmd);
      });
    });
  });

  list.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById(btn.dataset.pre).textContent).then(() => {
        btn.textContent = '✓';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copier'; btn.classList.remove('copied'); }, 1500);
      });
    });
  });
}

chrome.storage.local.get({ streams: [] }, (data) => render(data.streams));

document.getElementById('clear-btn').addEventListener('click', () => {
  chrome.storage.local.set({ streams: [] }, () => render([]));
});
