(() => {
  if (window.mpeasyClip) return;

  const MIN_LENGTH = 1;
  const MARGIN = 8;

  const CSS = `
    :host { all: initial; position: fixed; z-index: 2147483647; display: block; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .panel {
      --bg: rgba(0, 0, 0, .86); --fill: rgba(255, 255, 255, .14); --label: #f5f5f7; --secondary: #a1a1a6;
      --accent: #ffffff; --range: rgba(255, 255, 255, .32); --button: #0047b3; --button-press: #003c96; --focus: #4d90fe;
      background: var(--bg); color: var(--label); border-radius: 14px; padding: 10px 12px 12px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, .45); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      font-size: 13px; line-height: 1.3; user-select: none; -webkit-user-select: none;
    }
    .panel.light {
      --bg: rgba(255, 255, 255, .94); --fill: rgba(0, 0, 0, .07); --label: #1d1d1f; --secondary: #636366;
      --accent: #000000; --range: rgba(0, 0, 0, .22);
    }
    .head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
    .times { font-variant-numeric: tabular-nums; font-weight: 600; }
    .length { color: var(--secondary); font-variant-numeric: tabular-nums; }
    .close {
      margin-left: auto; width: 28px; height: 28px; border: 0; border-radius: 50%; background: var(--fill);
      color: var(--label); display: grid; place-items: center; cursor: pointer;
    }
    .track { position: relative; height: 40px; margin: 4px 10px; cursor: pointer; touch-action: none; }
    .rail { position: absolute; left: 0; right: 0; top: 17px; height: 6px; border-radius: 3px; background: var(--fill); }
    .range { position: absolute; top: 17px; height: 6px; border-radius: 3px; background: var(--range); }
    .playhead { position: absolute; top: 10px; width: 2px; height: 20px; margin-left: -1px; border-radius: 1px; background: var(--secondary); pointer-events: none; }
    .handle {
      position: absolute; top: 8px; width: 24px; height: 24px; margin-left: -12px; padding: 0; border: 0; border-radius: 50%;
      background: var(--accent); box-shadow: 0 1px 4px rgba(0, 0, 0, .5); cursor: grab; touch-action: none;
    }
    .handle::before { content: ""; position: absolute; inset: -10px; }
    .handle:active { cursor: grabbing; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .mark, .seg button, .go {
      min-height: 36px; border: 0; border-radius: 18px; cursor: pointer; font-size: 13px; font-weight: 600;
    }
    .mark { padding: 0 12px; background: var(--fill); color: var(--label); white-space: nowrap; }
    .seg { display: flex; padding: 2px; border-radius: 18px; background: var(--fill); }
    .seg button { min-height: 32px; padding: 0 12px; background: transparent; color: var(--secondary); }
    .seg button[aria-checked="true"] { background: var(--accent); color: var(--bg); }
    .panel:not(.light) .seg button[aria-checked="true"] { color: #000; }
    .go { margin-left: auto; padding: 0 18px; background: var(--button); color: #fff; }
    .go:hover { background: var(--button-press); }
    .status { margin: 6px 0 0; color: var(--secondary); min-height: 1em; }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .handle, .range, .playhead { transition: none; }
    @media (prefers-reduced-motion: no-preference) { .close, .mark, .go, .seg button { transition: background .15s, color .15s; } }
  `;

  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
  }

  function visibleVideo() {
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
    return best;
  }

  function node(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  let active = null;

  function close() {
    if (!active) return;
    active.stop();
    active = null;
  }

  function open({ url, title, mode, theme }) {
    close();
    const video = visibleVideo();
    const host = node('div', { 'data-mpeasy': 'clip' });
    const root = host.attachShadow({ mode: 'closed' });
    const style = node('style');
    style.textContent = CSS;
    const panel = node('div', { class: theme === 'light' ? 'panel light' : 'panel', role: 'dialog', 'aria-label': 'Recortar con mpeasy' });
    root.append(style, panel);
    document.documentElement.append(host);

    const head = node('div', { class: 'head' });
    const times = node('span', { class: 'times' });
    const length = node('span', { class: 'length' });
    const closeBtn = node('button', { type: 'button', class: 'close', 'aria-label': 'Cerrar', title: 'Cerrar' });
    closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    head.append(times, length, closeBtn);
    const status = node('p', { class: 'status', role: 'status' });
    panel.append(head);

    let raf = 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      host.remove();
    };
    active = { stop };
    closeBtn.addEventListener('click', close);
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'keyup', 'contextmenu']) host.addEventListener(type, (e) => e.stopPropagation());
    host.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
    });

    let anchor = video;
    const place = () => {
      const r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
      const visible = r && r.bottom > 0 && r.top < innerHeight && r.width > 0;
      if (anchor && anchor.isConnected === false) return close();
      const width = Math.min(Math.max(visible ? r.width - 16 : 360, 300), 560, innerWidth - MARGIN * 2);
      const center = visible ? r.left + r.width / 2 : innerWidth / 2;
      const bottom = visible ? Math.min(r.bottom, innerHeight) - 12 : innerHeight - 24;
      const left = Math.min(Math.max(center - width / 2, MARGIN), innerWidth - width - MARGIN);
      host.style.width = `${width}px`;
      host.style.left = `${left}px`;
      host.style.top = `${Math.max(MARGIN, bottom - host.offsetHeight)}px`;
      raf = requestAnimationFrame(place);
    };

    const duration = video ? video.duration : NaN;
    if (!video || !Number.isFinite(duration) || duration < MIN_LENGTH * 2) {
      times.textContent = video ? 'Este video no se puede recortar.' : 'No encontré un video en pantalla.';
      anchor = null;
      place();
      closeBtn.focus();
      setTimeout(close, 4000);
      return;
    }

    let start = Math.min(Math.max(0, video.currentTime), duration - MIN_LENGTH);
    let end = Math.min(duration, start + Math.max(MIN_LENGTH, Math.min(15, duration - start)));
    let format = mode === 'audio' ? 'audio' : 'video';

    const track = node('div', { class: 'track' });
    const rail = node('div', { class: 'rail' });
    const range = node('div', { class: 'range' });
    const playhead = node('div', { class: 'playhead' });
    const startHandle = node('button', { type: 'button', class: 'handle', role: 'slider', 'aria-label': 'Inicio del tramo', 'aria-valuemin': '0' });
    const endHandle = node('button', { type: 'button', class: 'handle', role: 'slider', 'aria-label': 'Fin del tramo', 'aria-valuemin': '0' });
    track.append(rail, range, playhead, startHandle, endHandle);

    const actions = node('div', { class: 'actions' });
    const markStart = node('button', { type: 'button', class: 'mark' }, 'Inicio aquí');
    const markEnd = node('button', { type: 'button', class: 'mark' }, 'Fin aquí');
    const seg = node('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Formato' });
    const mp4 = node('button', { type: 'button', role: 'radio', 'data-format': 'video' }, 'MP4');
    const mp3 = node('button', { type: 'button', role: 'radio', 'data-format': 'audio' }, 'MP3');
    seg.append(mp4, mp3);
    const go = node('button', { type: 'button', class: 'go' }, 'Descargar');
    actions.append(markStart, markEnd, seg, go);
    panel.append(track, actions, status);

    const pct = (t) => `${(t / duration) * 100}%`;
    const paint = () => {
      startHandle.style.left = pct(start);
      endHandle.style.left = pct(end);
      range.style.left = pct(start);
      range.style.width = pct(end - start);
      times.textContent = `${clock(start)} → ${clock(end)}`;
      length.textContent = `${Math.round(end - start)} s`;
      for (const [handle, value, min, max] of [[startHandle, start, 0, end - MIN_LENGTH], [endHandle, end, start + MIN_LENGTH, duration]]) {
        handle.setAttribute('aria-valuemin', String(Math.floor(min)));
        handle.setAttribute('aria-valuemax', String(Math.floor(max)));
        handle.setAttribute('aria-valuenow', String(Math.floor(value)));
        handle.setAttribute('aria-valuetext', clock(value));
      }
      mp4.setAttribute('aria-checked', String(format === 'video'));
      mp3.setAttribute('aria-checked', String(format === 'audio'));
    };
    const tickPlayhead = () => {
      playhead.style.left = pct(Math.min(video.currentTime, duration));
    };

    const setStart = (t) => {
      start = Math.min(Math.max(0, t), end - MIN_LENGTH);
      paint();
      return start;
    };
    const setEnd = (t) => {
      end = Math.max(Math.min(duration, t), start + MIN_LENGTH);
      paint();
      return end;
    };
    const preview = (t) => {
      try {
        video.currentTime = t;
      } catch {}
    };
    const timeAt = (clientX) => {
      const r = rail.getBoundingClientRect();
      return Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * duration;
    };

    const drag = (handle, setter) => (e) => {
      e.preventDefault();
      handle.focus();
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => preview(setter(timeAt(ev.clientX)));
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    };
    startHandle.addEventListener('pointerdown', drag(startHandle, setStart));
    endHandle.addEventListener('pointerdown', drag(endHandle, setEnd));
    track.addEventListener('pointerdown', (e) => {
      if (e.target === startHandle || e.target === endHandle) return;
      const t = timeAt(e.clientX);
      const nearStart = Math.abs(t - start) <= Math.abs(t - end);
      preview(nearStart ? setStart(t) : setEnd(t));
      drag(nearStart ? startHandle : endHandle, nearStart ? setStart : setEnd)(e);
    });

    const keys = (setter, get) => (e) => {
      const step = e.shiftKey ? 5 : 1;
      const moves = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
      let next = null;
      if (e.key in moves) next = get() + moves[e.key];
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = duration;
      if (next == null) return;
      e.preventDefault();
      preview(setter(next));
    };
    startHandle.addEventListener('keydown', keys(setStart, () => start));
    endHandle.addEventListener('keydown', keys(setEnd, () => end));

    markStart.addEventListener('click', () => setStart(video.currentTime));
    markEnd.addEventListener('click', () => setEnd(video.currentTime));
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      format = b.dataset.format;
      paint();
    });
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        await chrome.runtime.sendMessage({ type: 'clip-download', url, title, mode: format, start, end });
        status.textContent = `Agregado a descargas: ${clock(start)} → ${clock(end)}`;
        setTimeout(close, 1500);
      } catch {
        go.disabled = false;
        status.textContent = 'No se pudo hablar con mpeasy. Recarga la página y prueba de nuevo.';
      }
    });
    video.addEventListener('timeupdate', tickPlayhead);
    const stopBase = active.stop;
    active.stop = () => {
      video.removeEventListener('timeupdate', tickPlayhead);
      stopBase();
    };

    paint();
    tickPlayhead();
    place();
    startHandle.focus({ preventScroll: true });
  }

  window.mpeasyClip = { open, close };
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'clip-open') open(msg);
  });
})();
