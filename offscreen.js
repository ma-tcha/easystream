chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen' || msg.action !== 'download') return;
  const blob = new Blob(msg.chunks, { type: 'video/mp2t' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: msg.filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
