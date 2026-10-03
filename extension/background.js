const HOST = 'com.ytmp4.host';
const OLD_HOST = 'No se pudo hablar con el programa local. Corre el install.bat de esta versión y recarga la extensión.';
const COLOR = '#0066d6';
const UPDATE_MINUTES = 360;

function isVideo(u) {
  try {
    const x = new URL(u);
    if (x.hostname === 'youtu.be') return true;
    if (!/(^|\.)youtube\.com$/.test(x.hostname)) return false;
    return (x.pathname === '/watch' && x.searchParams.has('v')) || x.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

function cleanTitle(t) {
  return (t || '').replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
}

async function setJob(id, data) {
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  jobs[id] = { ...jobs[id], ...data };
  await chrome.storage.local.set({ jobs });
  refreshBadge(jobs);
}

function refreshBadge(jobs) {
  const active = Object.values(jobs).filter((j) => j.state === 'downloading');
  if (active.length) {
    const pct = Math.round(active[0].percent || 0);
    chrome.action.setBadgeBackgroundColor({ color: COLOR });
    chrome.action.setBadgeText({ text: active.length > 1 ? String(active.length) : `${pct}%` });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(async () => {
    const { jobs = {} } = await chrome.storage.local.get('jobs');
    refreshBadge(jobs);
  }, 2000);
}

function notice(text) {
  chrome.storage.local.set({ notice: text });
}

function hostError(msg) {
  return msg && msg.type === 'error' && !/^'\w+'$/.test(msg.message) ? msg.message : OLD_HOST;
}

let seq = 0;

function run(job) {
  const id = String(Date.now() * 1000 + (seq++ % 1000));
  setJob(id, { ...job, state: 'downloading', percent: 0 });
  let finished = false;
  const port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    if (msg.type === 'info') setJob(id, { title: msg.title });
    if (msg.type === 'progress') setJob(id, { percent: msg.percent });
    if (msg.type === 'done') {
      finished = true;
      setJob(id, { state: 'done', percent: 100, file: msg.file, path: msg.path });
    }
    if (msg.type === 'error') {
      finished = true;
      setJob(id, { state: 'error', error: msg.message });
    }
  });
  port.onDisconnect.addListener(() => {
    if (!finished) {
      const err = chrome.runtime.lastError?.message || 'El programa local se cerró.';
      setJob(id, { state: 'error', error: err });
    }
  });
  port.postMessage({ type: 'download', url: job.url, quality: job.quality, folder: job.folder });
}

async function queue(url, title, mode) {
  const s = await chrome.storage.local.get(['qualityVideo', 'qualityAudio', 'folderMp4', 'folderMp3', 'folder']);
  const audio = mode === 'audio';
  const kbps = s.qualityAudio || '320';
  const height = s.qualityVideo || '720';
  run({
    url,
    title: title || url,
    mode,
    quality: audio ? `mp3-${kbps}` : height,
    meta: audio ? `MP3 · ${kbps}` : height === 'best' ? 'Máxima' : `${height}p`,
    folder: (audio ? s.folderMp3 : s.folderMp4) ?? s.folder ?? '',
  });
}

async function retry(id) {
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  const job = jobs[id];
  if (!job) return;
  delete jobs[id];
  await chrome.storage.local.set({ jobs });
  run({ url: job.url, title: job.title, mode: job.mode, quality: job.quality, meta: job.meta, folder: job.folder });
}

function ask(message, onReply) {
  let answered = false;
  const port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    answered = true;
    onReply(msg);
    port.disconnect();
  });
  port.onDisconnect.addListener(() => {
    if (!answered) notice(chrome.runtime.lastError?.message || OLD_HOST);
  });
  port.postMessage(message);
}

function pickFolder(key, title, current) {
  notice('');
  ask({ type: 'pick', title, folder: current }, (msg) => {
    if (msg.type === 'folder') {
      if (msg.path) chrome.storage.local.set({ [key]: msg.path });
    } else {
      notice(hostError(msg));
    }
  });
}

async function reveal(id) {
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  const path = jobs[id]?.path;
  if (!path) return;
  notice('');
  ask({ type: 'reveal', path }, (msg) => {
    if (msg.type !== 'revealed') notice(hostError(msg));
  });
}

function setUpdate(data) {
  return chrome.storage.local.set({ update: { ...data, at: Date.now() } });
}

async function checkUpdate(manual) {
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  if (Object.values(jobs).some((j) => j.state === 'downloading')) {
    if (manual) setUpdate({ state: 'busy' });
    return;
  }
  setUpdate({ state: 'checking' });
  let answered = false;
  const port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(async (msg) => {
    answered = true;
    port.disconnect();
    if (msg.type === 'updated') {
      await setUpdate({ state: 'updated', version: msg.version });
      chrome.runtime.reload();
    } else if (msg.type === 'uptodate') {
      setUpdate({ state: msg.disabled ? 'disabled' : 'uptodate' });
    } else {
      setUpdate({ state: 'error', error: hostError(msg) });
    }
  });
  port.onDisconnect.addListener(() => {
    if (!answered) setUpdate({ state: 'error', error: chrome.runtime.lastError?.message || OLD_HOST });
  });
  port.postMessage({ type: 'update', version: chrome.runtime.getManifest().version });
}

function scheduleUpdates() {
  chrome.alarms.create('update', { delayInMinutes: 1, periodInMinutes: UPDATE_MINUTES });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'update') checkUpdate(false);
});

chrome.runtime.onInstalled.addListener(scheduleUpdates);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'update') checkUpdate(true);
  if (msg.type === 'download') queue(msg.url, msg.title, msg.mode);
  if (msg.type === 'retry') retry(msg.id);
  if (msg.type === 'reveal') reveal(msg.id);
  if (msg.type === 'pick' && ['folderMp4', 'folderMp3'].includes(msg.key)) pickFolder(msg.key, msg.title, msg.folder);
  if (msg.type === 'clear') {
    chrome.storage.local.get('jobs').then(({ jobs = {} }) => {
      for (const k of Object.keys(jobs)) if (jobs[k].state !== 'downloading') delete jobs[k];
      chrome.storage.local.set({ jobs });
      refreshBadge(jobs);
    });
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const mode = command === 'download-mp3' ? 'audio' : command === 'download-mp4' ? 'video' : null;
  if (!mode) return;
  if (!tab || !tab.url) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isVideo(tab.url)) {
    flash('!', '#d70015');
    return;
  }
  queue(tab.url, cleanTitle(tab.title), mode);
});

chrome.runtime.onStartup.addListener(async () => {
  scheduleUpdates();
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  for (const j of Object.values(jobs)) if (j.state === 'downloading') {
    j.state = 'error';
    j.error = 'Interrumpida';
  }
  await chrome.storage.local.set({ jobs });
  refreshBadge(jobs);
});
