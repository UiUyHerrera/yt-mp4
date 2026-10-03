const QUALITY = {
  video: [['best', 'Máxima disponible'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']],
  audio: [['320', '320 kbps'], ['256', '256 kbps'], ['192', '192 kbps'], ['128', '128 kbps'], ['96', '96 kbps']],
};
const DEFAULT = { video: '720', audio: '320' };
const QKEY = { video: 'qualityVideo', audio: 'qualityAudio' };
const PICK_TITLE = { folderMp4: 'Carpeta para MP4', folderMp3: 'Carpeta para MP3' };
const CIRC = 2 * Math.PI * 8;
const FIREFOX = typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function';

const segEl = document.getElementById('seg');
const qualityEl = document.getElementById('quality');
const qualityLabelEl = document.getElementById('qualityLabel');
const goEl = document.getElementById('go');
const noticeEls = document.querySelectorAll('.notice');
const mainEl = document.getElementById('main');
const settingsEl = document.getElementById('settings');
const openSettingsEl = document.getElementById('openSettings');
const closeSettingsEl = document.getElementById('closeSettings');
const folderEls = { folderMp4: document.getElementById('folderMp4'), folderMp3: document.getElementById('folderMp3') };
const listEl = document.getElementById('list');
const clearEl = document.getElementById('clear');
const titleEl = document.getElementById('title');
const thumbEl = document.getElementById('thumb');

const state = { mode: 'video', qualityVideo: DEFAULT.video, qualityAudio: DEFAULT.audio, folderMp4: '', folderMp3: '' };
let tab = null;
let recording = null;
let hostNotice = '';

function videoId(u) {
  try {
    const x = new URL(u);
    if (x.hostname === 'youtu.be') return x.pathname.slice(1).split('/')[0] || null;
    if (!/(^|\.)youtube\.com$/.test(x.hostname)) return null;
    if (x.pathname === '/watch') return x.searchParams.get('v');
    if (x.pathname.startsWith('/shorts/')) return x.pathname.split('/')[2] || null;
  } catch {}
  return null;
}

function cleanTitle(t) {
  return (t || '').replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
}

function tpl(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function save(data) {
  Object.assign(state, data);
  return chrome.storage.local.set(data);
}

function paintMode() {
  const mode = state.mode;
  segEl.dataset.mode = mode;
  segEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  qualityEl.replaceChildren(...QUALITY[mode].map(([v, label]) => {
    const o = el('option', null, label);
    o.value = v;
    return o;
  }));
  qualityEl.value = state[QKEY[mode]];
  if (qualityEl.selectedIndex < 0) qualityEl.value = DEFAULT[mode];
  paintQuality();
}

function paintQuality() {
  qualityLabelEl.textContent = qualityEl.options[qualityEl.selectedIndex]?.textContent || '';
}

function paintFolders() {
  for (const [key, input] of Object.entries(folderEls)) {
    if (document.activeElement !== input) input.value = state[key] || '';
    input.title = input.value || 'Descargas';
  }
}

function showNotice(text) {
  noticeEls.forEach((n) => {
    n.textContent = text || '';
    n.hidden = !text;
  });
}

function show(view) {
  const settings = view === 'settings';
  mainEl.hidden = settings;
  settingsEl.hidden = !settings;
  const shown = settings ? settingsEl : mainEl;
  shown.classList.remove('in-right', 'in-left');
  void shown.offsetWidth;
  shown.classList.add(settings ? 'in-right' : 'in-left');
  (settings ? closeSettingsEl : openSettingsEl).focus({ preventScroll: true });
}

function row(id, j) {
  const li = el('li', 'item');
  li.dataset.id = id;
  let lead;
  if (j.state === 'downloading') {
    lead = tpl('t-ring');
    const fg = lead.querySelector('.fg');
    fg.setAttribute('stroke-dasharray', CIRC);
    fg.setAttribute('stroke-dashoffset', CIRC * (1 - (j.percent || 0) / 100));
  } else {
    lead = tpl(j.state === 'done' ? 't-ok' : 't-err');
  }
  const name = el('span', 'name', j.title || j.url);
  name.title = j.state === 'error' ? j.error || '' : j.path || j.title || '';
  const metaText = j.state === 'downloading' ? `${j.status ? `${j.status} ` : ''}${Math.round(j.percent || 0)}%` : j.state === 'error' ? 'Error' : j.meta || '';
  li.append(lead, name, el('span', j.state === 'error' ? 'meta err' : 'meta', metaText));
  if (j.state === 'done' && j.path) li.append(tpl('t-reveal'));
  if (j.state === 'error' && j.url) li.append(tpl('t-retry'));
  return li;
}

function render(jobs) {
  const list = Object.entries(jobs).sort((a, b) => b[0] - a[0]);
  if (!list.length) listEl.replaceChildren(el('li', 'empty', 'Lo que descargues aparece aquí.'));
  else listEl.replaceChildren(...list.map(([id, j]) => row(id, j)));
  clearEl.hidden = !list.some(([, j]) => j.state !== 'downloading');
  const latest = list[0] && list[0][1];
  showNotice(hostNotice || (latest && latest.state === 'error' ? latest.error : ''));
}

const UPDATE_TEXT = {
  uptodate: () => 'Estás al día. Se revisa sola cada 6 horas.',
  disabled: () => 'Las actualizaciones automáticas no están configuradas.',
  checking: () => 'Buscando actualizaciones…',
  busy: () => 'Espera a que terminen las descargas y vuelve a intentar.',
  updated: (u) => `Actualizada a la versión ${u.version}.`,
  error: (u) => u.error || 'No se pudo buscar actualizaciones.',
};

function paintUpdate(u) {
  const version = chrome.runtime.getManifest().version;
  document.getElementById('version').textContent = `Versión ${version}`;
  const hint = document.getElementById('updateHint');
  const button = document.getElementById('checkUpdate');
  let state = u && u.state;
  if (state === 'checking' && Date.now() - u.at > 180000) state = null;
  if (state === 'updated' && u.version !== version) state = null;
  hint.textContent = state ? UPDATE_TEXT[state](u) : 'Se revisa sola cada 6 horas.';
  button.disabled = state === 'checking';
}

function chips(button, shortcut) {
  const parts = shortcut ? shortcut.split('+') : ['Sin asignar'];
  button.classList.toggle('none', !shortcut);
  button.replaceChildren(...parts.map((p) => el('span', null, p)));
}

async function paintKeys() {
  const commands = await chrome.commands.getAll();
  document.querySelectorAll('.kbd').forEach((b) => {
    b.classList.remove('rec');
    const c = commands.find((x) => x.name === b.dataset.command);
    chips(b, c ? c.shortcut : '');
  });
  document.getElementById('keysHint').textContent = FIREFOX
    ? 'Toca un atajo y presiona la combinación nueva. Esc cancela.'
    : 'Toca un atajo para cambiarlo en la página de atajos del navegador.';
}

function shortcutsPage() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge://extensions/shortcuts';
  if (ua.includes('OPR/')) return 'opera://extensions/shortcuts';
  return 'chrome://extensions/shortcuts';
}

const NAMED = { Comma: 'Comma', Period: 'Period', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Space: 'Space', Insert: 'Insert', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

function comboFrom(e) {
  const letter = e.code.match(/^Key([A-Z])$/);
  const digit = e.code.match(/^Digit(\d)$/);
  let key = null;
  if (letter) key = letter[1];
  else if (digit) key = digit[1];
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  else if (NAMED[e.code]) key = NAMED[e.code];
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.metaKey) mods.push('Command');
  if (!mods.length && !key.startsWith('F')) return null;
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

document.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === 'Escape') {
    recording = null;
    paintKeys();
    return;
  }
  const combo = comboFrom(e);
  if (!combo) return;
  const name = recording;
  recording = null;
  try {
    await browser.commands.update({ name, shortcut: combo });
    showNotice('');
  } catch (err) {
    showNotice(`No se pudo usar ${combo}: ${err.message}`);
  }
  paintKeys();
});

document.querySelectorAll('.kbd').forEach((b) => {
  b.addEventListener('click', () => {
    if (!FIREFOX) {
      chrome.tabs.create({ url: shortcutsPage() });
      return;
    }
    recording = b.dataset.command;
    b.classList.add('rec');
    b.replaceChildren(el('span', null, 'Presiona teclas…'));
  });
});

document.getElementById('checkUpdate').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'update' }));

openSettingsEl.addEventListener('click', () => show('settings'));
closeSettingsEl.addEventListener('click', () => show('main'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !recording && !settingsEl.hidden) {
    e.preventDefault();
    show('main');
  }
});

segEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.mode === state.mode) return;
  save({ mode: b.dataset.mode });
  paintMode();
});

qualityEl.addEventListener('change', () => {
  paintQuality();
  save({ [QKEY[state.mode]]: qualityEl.value });
});

for (const [key, input] of Object.entries(folderEls)) {
  input.addEventListener('input', () => {
    save({ [key]: input.value.trim() });
    input.title = input.value || 'Descargas';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
}

document.querySelectorAll('.pick').forEach((b) => {
  b.addEventListener('click', async () => {
    const key = b.dataset.key;
    await chrome.storage.local.set({ reopenSettings: true });
    chrome.runtime.sendMessage({ type: 'pick', key, title: PICK_TITLE[key], folder: folderEls[key].value.trim() });
  });
});

goEl.addEventListener('click', async () => {
  if (!tab) return;
  hostNotice = '';
  await save({ [QKEY[state.mode]]: qualityEl.value, notice: '' });
  chrome.runtime.sendMessage({ type: 'download', url: tab.url, title: cleanTitle(tab.title), mode: state.mode });
});

listEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  chrome.runtime.sendMessage({ type: b.dataset.act, id: b.closest('.item').dataset.id });
});

clearEl.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'clear' }));

chrome.storage.onChanged.addListener((c) => {
  if (c.jobs) render(c.jobs.newValue || {});
  if (c.update) paintUpdate(c.update.newValue);
  if (c.notice) {
    hostNotice = c.notice.newValue || '';
    showNotice(hostNotice);
  }
  let repaint = false;
  for (const k of Object.keys(folderEls)) {
    if (c[k] && c[k].newValue !== state[k]) {
      state[k] = c[k].newValue || '';
      repaint = true;
    }
  }
  if (repaint) paintFolders();
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
  const id = t && videoId(t.url);
  if (id) {
    tab = t;
    titleEl.textContent = cleanTitle(t.title);
    const img = new Image();
    img.alt = '';
    img.onload = () => thumbEl.replaceChildren(img);
    img.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
  } else {
    titleEl.textContent = 'Abre un video de YouTube para descargarlo.';
    titleEl.classList.add('off');
    goEl.disabled = true;
  }
});

chrome.storage.local.get(null).then((data) => {
  const migrate = {};
  if (!data.mode && data.quality) {
    if (String(data.quality).startsWith('mp3')) {
      migrate.mode = 'audio';
      migrate.qualityAudio = String(data.quality).split('-')[1] || DEFAULT.audio;
    } else {
      migrate.mode = 'video';
      migrate.qualityVideo = data.quality;
    }
  }
  if (data.folder && data.folderMp4 == null) migrate.folderMp4 = data.folder;
  if (data.folder && data.folderMp3 == null) migrate.folderMp3 = data.folder;
  if (Object.keys(migrate).length) chrome.storage.local.set(migrate);
  const merged = { ...data, ...migrate };
  for (const k of Object.keys(state)) if (merged[k] != null) state[k] = merged[k];
  if (!QUALITY[state.mode]) state.mode = 'video';
  paintMode();
  paintFolders();
  hostNotice = merged.notice || '';
  render(merged.jobs || {});
  paintUpdate(merged.update);
  if (merged.reopenSettings) {
    chrome.storage.local.set({ reopenSettings: false });
    mainEl.hidden = true;
    settingsEl.hidden = false;
  }
});

paintKeys();
