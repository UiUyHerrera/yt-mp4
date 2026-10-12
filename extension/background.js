const HOST = 'com.ytmp4.host';
const OLD_HOST = 'No se pudo hablar con el programa local. Corre el install.bat de esta versión y recarga la extensión.';
const COLOR = '#0047b3';
const PAUSED_COLOR = '#48484a';
const UPDATE_MINUTES = 360;
const AUTO_CHECK_MS = 30 * 60 * 1000;
const ACTIVE = ['queued', 'downloading', 'paused', 'cancelling'];
const RUNNING = ['downloading', 'paused', 'cancelling'];
const MAX_PARALLEL = 3;
const MAX_LIST = 200;
const FIREFOX = typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function';

const ports = new Map();
let chain = Promise.resolve();

function platformOf(u) {
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase();
    const path = x.pathname;
    if (host === 'youtu.be') return path.length > 1 ? 'youtube' : null;
    if (/(^|\.)youtube\.com$/.test(host)) return (path === '/watch' && x.searchParams.has('v')) || (path === '/playlist' && x.searchParams.has('list')) || /^\/shorts\/[^/]+/.test(path) ? 'youtube' : null;
    if (host === 'fb.watch') return path.length > 1 ? 'facebook' : null;
    if (/(^|\.)facebook\.com$/.test(host)) {
      if (/^\/watch\/?$/.test(path)) return x.searchParams.has('v') ? 'facebook' : null;
      return /^\/(reel|reels)\/[^/]+|\/videos\/[^/]+|^\/share\/[rv]\/[^/]+/.test(path) ? 'facebook' : null;
    }
    if (/(^|\.)instagram\.com$/.test(host)) return /^\/(reels?|p|tv)\/[^/]+/.test(path) ? 'instagram' : null;
    if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return path.length > 1 ? 'tiktok' : null;
    if (/(^|\.)tiktok\.com$/.test(host)) return /^\/@[^/]*\/video\/\d+|^\/t\/[^/]+/.test(path) ? 'tiktok' : null;
  } catch {}
  return null;
}

function playlistOf(u) {
  if (platformOf(u) !== 'youtube') return null;
  const x = new URL(u);
  const list = x.searchParams.get('list');
  if (!list || !/^[\w-]{2,64}$/.test(list)) return null;
  return { list, only: x.pathname === '/playlist' };
}

const FALLBACK_TITLE = { facebook: 'Reel de Facebook', instagram: 'Reel de Instagram', tiktok: 'Video de TikTok' };

function cleanTitle(t, u) {
  const title = (t || '')
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/ - YouTube$/, '')
    .replace(/\s*\|\s*Facebook$/, '')
    .replace(/\s*•\s*Instagram.*$/, '')
    .replace(/\s*\|\s*TikTok$/, '')
    .trim();
  const platform = platformOf(u);
  if (!title || /^(Facebook|Instagram|TikTok|Reels?|Watch)$/i.test(title)) return FALLBACK_TITLE[platform] || title;
  return title;
}

function visibleTiktok() {
  let best = null;
  let bestArea = 0;
  for (const video of document.querySelectorAll('video')) {
    const r = video.getBoundingClientRect();
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (w > 0 && h > 0 && w * h > bestArea) {
      best = video;
      bestArea = w * h;
    }
  }
  let scope = best;
  while (scope && scope.parentElement && scope.parentElement.querySelectorAll('video').length === 1) scope = scope.parentElement;
  if (!scope) return null;
  let cover = null;
  let coverArea = 0;
  for (const img of scope.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    if (r.width >= 100 && r.height >= 100 && r.width * r.height > coverArea) {
      cover = img;
      coverArea = r.width * r.height;
    }
  }
  const desc = scope.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
  const title = (desc && desc.textContent) || (cover && cover.alt) || '';
  const thumb = best.poster || (cover && cover.currentSrc) || '';
  const author = [...scope.querySelectorAll('a[href^="/@"]')].map((a) => a.pathname.match(/^\/@([\w.-]+)\/?$/)).find(Boolean);
  const user = author ? author[1] : '';
  const link = [...scope.querySelectorAll('a[href*="/video/"]')].find((a) => /\/video\/\d+/.test(a.pathname));
  if (link) return { url: link.href, title, thumb, user };
  const ids = [scope, ...scope.querySelectorAll('[id]')].map((n) => (n.id || '').match(/\d{15,}/)).filter(Boolean);
  if (!ids.length) return null;
  return { url: `https://www.tiktok.com/@${user}/video/${ids[0][0]}`, title, thumb, user };
}

function tiktokTitle(text, url, user) {
  const title = cleanTitle(String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200), url);
  if (title !== FALLBACK_TITLE.tiktok) return title;
  return /^[\w.-]+$/.test(user || '') ? `Video de @${user}` : title;
}

async function resolveTab(tab) {
  if (!tab || !tab.url) return null;
  const platform = platformOf(tab.url);
  let host = '';
  try {
    host = new URL(tab.url).hostname.toLowerCase();
  } catch {}
  const onTiktok = /(^|\.)tiktok\.com$/.test(host);
  if (platform && !onTiktok) return { url: tab.url, title: cleanTitle(tab.title, tab.url), list: playlistOf(tab.url) };
  if (!onTiktok) return null;
  let found = null;
  try {
    [{ result: found }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: visibleTiktok });
  } catch {}
  const pageUrl = platform === 'tiktok' ? tab.url : found && platformOf(found.url) === 'tiktok' ? found.url : null;
  if (!pageUrl) return null;
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  const user = found?.user || (url.pathname.match(/^\/@([\w.-]+)\//) || [])[1];
  const thumb = /^https:\/\//.test(found?.thumb || '') && found.thumb.length < 2000 ? found.thumb : '';
  return { url: url.href, title: tiktokTitle(found?.title || (platform === 'tiktok' ? tab.title : ''), url.href, user), thumb };
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

function newId() {
  return String(Date.now() * 1000 + (seq++ % 1000));
}

function enqueue(items) {
  return mutateJobs((jobs) => {
    for (const job of items) jobs[newId()] = { ...job, state: 'queued', percent: 0, status: '' };
  }).then(pump);
}

function pump() {
  const starting = [];
  return mutateJobs((jobs) => {
    const running = Object.values(jobs).filter((j) => RUNNING.includes(j.state)).length;
    const waiting = Object.keys(jobs).filter((id) => jobs[id].state === 'queued').sort();
    for (const id of waiting.slice(0, Math.max(0, MAX_PARALLEL - running))) {
      jobs[id] = { ...jobs[id], state: 'downloading' };
      starting.push([id, jobs[id]]);
    }
  }).then(() => starting.forEach(([id, job]) => start(id, job)));
}

function start(id, job) {
  let finished = false;
  const port = chrome.runtime.connectNative(HOST);
  ports.set(id, port);
  const end = (data) => {
    finished = true;
    ports.delete(id);
    setJob(id, data).then(() => finish(id)).then(pump);
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
    if (!finished) end({ state: 'error', status: '', error: nativeError('El programa local se cerró.') });
  });
  port.postMessage({ type: 'download', url: job.url, title: job.hint || '', quality: job.quality, folder: job.folder, subfolder: job.subfolder || '', trim: !!job.trim });
}

async function finish(id) {
  const { jobs = {}, notify } = await chrome.storage.local.get(['jobs', 'notify']);
  const job = jobs[id];
  if (!job || notify === false || job.state === 'cancelled') return;
  if (!job.batch) {
    const done = job.state === 'done';
    chrome.notifications.create(`job:${id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: done ? 'Descarga lista' : 'No se pudo descargar',
      message: done ? job.title || job.file || '' : job.error || job.title || '',
      ...(done && !FIREFOX ? { buttons: [{ title: 'Abrir carpeta' }] } : {}),
    });
    return;
  }
  const batch = Object.entries(jobs).filter(([, j]) => j.batch === job.batch);
  if (batch.some(([, j]) => isActive(j))) return;
  const done = batch.filter(([, j]) => j.state === 'done');
  const failed = batch.filter(([, j]) => j.state === 'error').length;
  if (!done.length && !failed) return;
  const last = done.sort((a, b) => b[0] - a[0])[0];
  chrome.notifications.create(last ? `job:${last[0]}` : `batch:${job.batch}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${job.subfolder || 'Lista'}: ${done.length} de ${batch.length} descargadas`,
    message: failed ? `${failed} no se ${failed === 1 ? 'pudo' : 'pudieron'} descargar.` : 'Todo descargado.',
    ...(last && !FIREFOX ? { buttons: [{ title: 'Abrir carpeta' }] } : {}),
  });
}

async function control(id, action) {
  const port = ports.get(id);
  if (!port) {
    await mutateJobs((jobs) => {
      const job = jobs[id];
      if (!job) return;
      if (job.state === 'queued' && action === 'cancel') jobs[id] = { ...job, state: 'cancelled', status: '' };
      else if (RUNNING.includes(job.state)) jobs[id] = { ...job, state: 'error', status: '', error: 'Interrumpida' };
    });
    return pump();
  }
  if (action === 'cancel') await setJob(id, { state: 'cancelling' });
  port.postMessage({ type: action });
}

async function cancelAll() {
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  const ids = Object.keys(jobs).filter((id) => isActive(jobs[id]));
  for (const id of ids.filter((i) => jobs[i].state === 'queued')) await control(id, 'cancel');
  for (const id of ids.filter((i) => jobs[i].state !== 'queued' && jobs[i].state !== 'cancelling')) await control(id, 'cancel');
}

async function settingsFor(mode) {
  const s = await chrome.storage.local.get(['qualityVideo', 'qualityAudio', 'folderMp4', 'folderMp3', 'folder', 'trimSilence']);
  const audio = mode === 'audio';
  const kbps = s.qualityAudio || '320';
  const height = s.qualityVideo || '720';
  return {
    mode,
    quality: audio ? `mp3-${kbps}` : height,
    meta: audio ? `MP3 · ${kbps}` : height === 'best' ? 'Máxima' : `${height}p`,
    folder: (audio ? s.folderMp3 : s.folderMp4) ?? s.folder ?? '',
    trim: audio && !!s.trimSilence,
  };
}

async function queue(url, title, mode) {
  if (!platformOf(url)) return;
  if (playlistOf(url)?.only) return queueList(url, mode);
  const base = await settingsFor(mode);
  return enqueue([{ ...base, url, title: title || url, hint: title || '', platform: platformOf(url) }]);
}

async function queueList(url, mode) {
  if (!playlistOf(url)) return;
  const base = await settingsFor(mode);
  const id = newId();
  await setJob(id, { kind: 'list', url, title: 'Lista de YouTube', mode, platform: 'youtube', meta: base.meta, state: 'downloading', percent: 0, status: 'Leyendo la lista' });
  ask({ type: 'list', url, limit: MAX_LIST }, async (msg) => {
    const entries = msg.type === 'list' && Array.isArray(msg.entries) ? msg.entries.filter((e) => e && platformOf(e.url) === 'youtube').slice(0, MAX_LIST) : [];
    if (!entries.length) {
      await setJob(id, { state: 'error', status: '', error: msg.type === 'error' ? msg.message : 'La lista está vacía o es privada.' });
      return;
    }
    await mutateJobs((jobs) => delete jobs[id]);
    const name = String(msg.title || 'Lista').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Lista';
    const batch = newId();
    await enqueue(entries.map((e) => {
      const entryTitle = String(e.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return { ...base, url: e.url, title: entryTitle || e.url, hint: entryTitle, platform: 'youtube', batch, subfolder: name };
    }));
  }, () => setJob(id, { state: 'error', status: '', error: nativeError(OLD_HOST) }));
}

async function retry(id) {
  let job = null;
  await mutateJobs((jobs) => {
    if (jobs[id] && !isActive(jobs[id]) && jobs[id].url) {
      job = jobs[id];
      delete jobs[id];
    }
  });
  if (!job) return;
  if (job.kind === 'list') return queueList(job.url, job.mode);
  const { url, title, hint, mode, platform, quality, meta, folder, subfolder, trim, batch } = job;
  return enqueue([{ url, title, hint: hint ?? title, mode, platform, quality, meta, folder, subfolder, trim, batch }]);
}

function ask(message, onReply, onFail = () => notice(nativeError(OLD_HOST))) {
  let answered = false;
  const port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    answered = true;
    onReply(msg);
    port.disconnect();
  });
  port.onDisconnect.addListener(() => {
    if (!answered) onFail();
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

const SITE_PATTERNS = ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts/*', '*://*.youtube.com/playlist*', '*://youtu.be/*', '*://*.facebook.com/*', '*://fb.watch/*', '*://*.instagram.com/*', '*://*.tiktok.com/*'];
const LIST_PATTERNS = ['*://*.youtube.com/*list=*'];
const MENUS = [
  ['link-video', 'Descargar MP4', 'link'],
  ['link-audio', 'Descargar MP3', 'link'],
  ['link-list-video', 'Descargar lista completa en MP4', 'link'],
  ['link-list-audio', 'Descargar lista completa en MP3', 'link'],
  ['page-video', 'Descargar MP4', 'page'],
  ['page-audio', 'Descargar MP3', 'page'],
  ['page-list-video', 'Descargar lista completa en MP4', 'page'],
  ['page-list-audio', 'Descargar lista completa en MP3', 'page'],
];

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title, scope] of MENUS) {
      const patterns = id.includes('-list-') ? LIST_PATTERNS : SITE_PATTERNS;
      chrome.contextMenus.create(scope === 'link'
        ? { id, title, contexts: ['link'], targetUrlPatterns: patterns }
        : { id, title, contexts: ['page', 'video'], documentUrlPatterns: patterns });
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  const mode = id.endsWith('-audio') ? 'audio' : 'video';
  const url = id.startsWith('link-') ? info.linkUrl : info.pageUrl || tab?.url;
  if (id.includes('-list-')) {
    if (playlistOf(url)) return queueList(url, mode);
  } else if (id.startsWith('link-')) {
    if (platformOf(url)) return queue(url, '', mode);
  } else {
    const target = await resolveTab(tab);
    if (target) return queue(target.url, target.title, mode);
  }
  flash('!', '#d70015');
});

function openFromNotification(notificationId) {
  chrome.notifications.clear(notificationId);
  if (notificationId.startsWith('job:')) reveal(notificationId.slice(4));
}

chrome.notifications.onClicked.addListener(openFromNotification);
chrome.notifications.onButtonClicked?.addListener(openFromNotification);

chrome.runtime.onInstalled.addListener(scheduleUpdates);
setupMenus();

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'resolve') {
    chrome.tabs.get(msg.tabId).then(resolveTab, () => null).then(reply);
    return true;
  }
  if (msg.type === 'update') checkUpdate(!msg.auto);
  if (msg.type === 'download') queue(msg.url, msg.title, msg.mode);
  if (msg.type === 'download-list') queueList(msg.url, msg.mode);
  if (msg.type === 'cancel-all') cancelAll();
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
  const target = await resolveTab(tab);
  if (!target) {
    flash('!', '#d70015');
    return;
  }
  queue(target.url, target.title, mode);
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
