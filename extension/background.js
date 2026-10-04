const HOST = 'com.ytmp4.host';
const OLD_HOST = 'No se pudo hablar con el programa local. Corre el install.bat de esta versión y recarga la extensión.';
const COLOR = '#0047b3';
const PAUSED_COLOR = '#48484a';
const UPDATE_MINUTES = 360;
const AUTO_CHECK_MS = 30 * 60 * 1000;
const ACTIVE = ['downloading', 'paused', 'cancelling'];

const ports = new Map();
let chain = Promise.resolve();

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

function isActive(job) {
  return ACTIVE.includes(job.state);
}

function mutateJobs(fn) {
  chain = chain
    .then(async () => {
      const { jobs = {} } = await chrome.storage.local.get('jobs');
      fn(jobs);
      await chrome.storage.local.set({ jobs });
      refreshBadge(jobs);
    })
    .catch(() => {});
  return chain;
}

function setJob(id, data) {
  return mutateJobs((jobs) => {
    if (jobs[id] || data.state === 'downloading') jobs[id] = { ...jobs[id], ...data };
  });
}

function refreshBadge(jobs) {
  const active = Object.values(jobs).filter(isActive);
  if (active.length) {
    const pct = Math.round(active[0].percent || 0);
    const allPaused = active.every((j) => j.state === 'paused');
    chrome.action.setBadgeBackgroundColor({ color: allPaused ? PAUSED_COLOR : COLOR });
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

function nativeError(fallback) {
  const raw = chrome.runtime.lastError?.message || '';
  if (/not found/i.test(raw)) return 'El programa local no está conectado. Abre install.bat (en la carpeta de la extensión) y espera a que diga Todo listo.';
  if (/forbidden/i.test(raw)) return 'El programa local no reconoce esta extensión. Abre install.bat de nuevo.';
  if (/exited/i.test(raw)) return 'El programa local se cerró de golpe. Abre install.bat de nuevo.';
  if (/communicating/i.test(raw)) return 'El programa local respondió algo raro. Abre install.bat de nuevo.';
  return raw || fallback;
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
  setJob(id, { ...job, state: 'downloading', percent: 0, status: '' });
  let finished = false;
  const port = chrome.runtime.connectNative(HOST);
  ports.set(id, port);
  const end = (data) => {
    finished = true;
    ports.delete(id);
    setJob(id, data);
  };
  port.onMessage.addListener((msg) => {
    if (finished) return;
    if (msg.type === 'info') setJob(id, { title: msg.title });
    if (msg.type === 'progress') setJob(id, { percent: msg.percent });
    if (msg.type === 'status') setJob(id, { status: msg.text });
    if (msg.type === 'paused') setJob(id, { state: 'paused' });
    if (msg.type === 'resumed') setJob(id, { state: 'downloading' });
    if (msg.type === 'done') end({ state: 'done', percent: 100, status: '', file: msg.file, path: msg.path });
    if (msg.type === 'cancelled') end({ state: 'cancelled', status: '' });
    if (msg.type === 'error') end({ state: 'error', status: '', error: msg.message });
  });
  port.onDisconnect.addListener(() => {
    ports.delete(id);
    if (!finished) {
      finished = true;
      setJob(id, { state: 'error', status: '', error: nativeError('El programa local se cerró.') });
    }
  });
  port.postMessage({ type: 'download', url: job.url, quality: job.quality, folder: job.folder });
}

async function control(id, action) {
  const port = ports.get(id);
  if (!port) {
    await mutateJobs((jobs) => {
      if (jobs[id] && isActive(jobs[id])) jobs[id] = { ...jobs[id], state: 'error', status: '', error: 'Interrumpida' };
    });
    return;
  }
  if (action === 'cancel') await setJob(id, { state: 'cancelling' });
  port.postMessage({ type: action });
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
  let job = null;
  await mutateJobs((jobs) => {
    if (jobs[id] && !isActive(jobs[id])) {
      job = jobs[id];
      delete jobs[id];
    }
  });
  if (job) run({ url: job.url, title: job.title, mode: job.mode, quality: job.quality, meta: job.meta, folder: job.folder });
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
    if (!answered) notice(nativeError(OLD_HOST));
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

let checking = false;

async function checkUpdate(manual) {
  if (checking) return;
  const { jobs = {}, update } = await chrome.storage.local.get(['jobs', 'update']);
  if (!manual && update && update.state !== 'checking' && update.state !== 'downloading' && Date.now() - update.at < AUTO_CHECK_MS) return;
  if (Object.values(jobs).some(isActive)) {
    if (manual) setUpdate({ state: 'busy' });
    return;
  }
  checking = true;
  await setUpdate({ state: 'checking' });
  let answered = false;
  const port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'update-found') {
      setUpdate({ state: 'downloading', version: msg.version });
      return;
    }
    answered = true;
    checking = false;
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
    checking = false;
    if (!answered) setUpdate({ state: 'error', error: nativeError(OLD_HOST) });
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
  if (msg.type === 'update') checkUpdate(!msg.auto);
  if (msg.type === 'download') queue(msg.url, msg.title, msg.mode);
  if (msg.type === 'retry') retry(msg.id);
  if (msg.type === 'reveal') reveal(msg.id);
  if (['pause', 'resume', 'cancel'].includes(msg.type) && msg.id) control(msg.id, msg.type);
  if (msg.type === 'pick' && ['folderMp4', 'folderMp3'].includes(msg.key)) pickFolder(msg.key, msg.title, msg.folder);
  if (msg.type === 'clear') {
    mutateJobs((jobs) => {
      for (const k of Object.keys(jobs)) if (!isActive(jobs[k])) delete jobs[k];
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

chrome.runtime.onStartup.addListener(() => {
  scheduleUpdates();
  mutateJobs((jobs) => {
    for (const j of Object.values(jobs)) {
      if (isActive(j)) {
        j.state = 'error';
        j.status = '';
        j.error = 'Interrumpida';
      }
    }
  });
});
