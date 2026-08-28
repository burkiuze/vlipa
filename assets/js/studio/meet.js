/* Meetings: the company's video rooms, ours the whole way down.

   The call runs browser to browser. Nothing about the video passes through
   any service — not ours, and certainly not somebody else's with their own
   watermark on it. What the server does is introduce people; the mechanics of
   that are in rtc.js.

   This file is the room: a green room to set yourself up in before anybody
   can see you, a grid of faces, and a bar of controls that stay where they
   are in every other meeting app. */

import { api, can, state } from './api.js';
import { avatar } from './avatar.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';
import { createCall } from './rtc.js';

let meetings = [];
let ice = null;
let roomCap = 6;

/* The room being looked at, and the call inside it once it has started. */
let staged = null;
let call = null;
let camera = null;
let screen = null;

let live = { audio: true, video: true, sharing: false, hand: false };
let cameraOk = null;
let micOk = null;

/* Who is on screen, and who is talking. */
let others = [];
let loudest = '';

export function create() {
  dialog({
    title: 'New meeting room',
    confirm: 'Open',
    body: [
      field('Room name', el('input', { name: 'title', required: true, maxlength: 80, placeholder: 'Monday stand-up' }),
        `Anybody in the company can walk in. ${roomCap} people at once.`),
    ],
    onConfirm: async (data) => {
      await api('/api/meetings', {
        method: 'POST',
        body: { action: 'create', companyId: state.companyId, title: data.get('title') },
      });

      await load();
      toast('Room opened.');
    },
  });
}

async function close(meeting) {
  if (!window.confirm(`Close the room "${meeting.title}"?`)) return;

  try {
    await api('/api/meetings', { method: 'POST', body: { action: 'close', companyId: state.companyId, id: meeting.id } });
    if (staged?.id === meeting.id) await hangUp();
    await load();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

/* ---------- the camera and the microphone ---------- */

/* Asked for once, kept for the whole call, and handed to every connection.
   A refused camera is not an error — plenty of meetings are attended with it
   off, and plenty of machines have no camera at all. */
async function openCamera() {
  if (camera) return camera;

  const want = { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } };

  try {
    camera = await navigator.mediaDevices.getUserMedia(want);
    cameraOk = camera.getVideoTracks().length > 0;
    micOk = camera.getAudioTracks().length > 0;
    return camera;
  } catch {
    // Everything at once was refused; try the microphone on its own, which is
    // enough to be in a meeting.
    try {
      camera = await navigator.mediaDevices.getUserMedia({ audio: true });
      cameraOk = false;
      micOk = true;
      live.video = false;
      return camera;
    } catch {
      cameraOk = false;
      micOk = false;
      live.video = false;
      live.audio = false;
      camera = new MediaStream();
      return camera;
    }
  }
}

function closeCamera() {
  camera?.getTracks().forEach((track) => track.stop());
  screen?.getTracks().forEach((track) => track.stop());
  camera = null;
  screen = null;
}

/* The switches work by turning the track off rather than dropping it: the
   connection stays up, and turning the camera back on is instant. */
function applySwitches() {
  camera?.getAudioTracks().forEach((track) => { track.enabled = live.audio; });
  if (!screen) camera?.getVideoTracks().forEach((track) => { track.enabled = live.video; });

  call?.say(live);
  paintBar();
  paintTiles();
}

/* ---------- who is talking ---------- */

/* The tile of whoever is speaking gets a ring round it. Worked out from the
   audio itself rather than from anything the other end says. */
let listener = null;

function listenForSpeech() {
  stopListening();

  const context = new (window.AudioContext || window.webkitAudioContext)();
  const meters = new Map();

  const watch = (id, stream) => {
    const audio = stream?.getAudioTracks?.() || [];
    if (!audio.length || meters.has(id)) return;

    const source = context.createMediaStreamSource(new MediaStream(audio));
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    meters.set(id, { analyser, data: new Uint8Array(analyser.frequencyBinCount) });
  };

  const tick = () => {
    watch('me', camera);
    for (const peer of others) watch(peer.peerId, peer.stream);

    let best = '';
    let most = 12;   // below this is a quiet room, not a speaker

    for (const [id, meter] of meters) {
      meter.analyser.getByteFrequencyData(meter.data);

      let sum = 0;
      for (const value of meter.data) sum += value;
      const level = sum / meter.data.length;

      if (level > most) { most = level; best = id; }
    }

    if (best !== loudest) {
      loudest = best;
      paintTiles();
    }
  };

  listener = { context, meters, timer: setInterval(tick, 400) };
}

function stopListening() {
  if (!listener) return;
  clearInterval(listener.timer);
  listener.context.close().catch(() => {});
  listener = null;
}

/* ---------- joining and leaving ---------- */

async function enter() {
  const stream = await openCamera();

  call = createCall({
    meetingId: staged.id,
    ask: (body) => api('/api/meetings', { method: 'POST', body: { companyId: state.companyId, ...body } }),
    onPeers: (list) => { others = list; paintTiles(); paintBar(); },
    onStream: () => paintTiles(),
    onGone: () => paintTiles(),
    onSaid: () => paintTiles(),
    onState: () => paintTiles(),
  });

  await call.start(stream, ice);
  applySwitches();
  listenForSpeech();

  drawStage();
  document.querySelector('.meetstage')?.requestFullscreen?.().catch(() => {});
}

async function hangUp() {
  stopListening();
  await call?.stop();

  call = null;
  staged = null;
  others = [];
  loudest = '';
  live = { audio: true, video: cameraOk !== false, sharing: false, hand: false };

  closeCamera();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  draw();
}

/* Sharing a screen swaps the track the connection is already sending, so
   nothing has to be renegotiated and nobody's picture drops. */
async function toggleShare() {
  if (screen) {
    screen.getTracks().forEach((track) => track.stop());
    screen = null;
    live.sharing = false;

    await call?.replaceVideo(camera?.getVideoTracks()[0] || null);
    applySwitches();
    return;
  }

  try {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    return;   // they changed their mind at the picker, which is not an error
  }

  const track = screen.getVideoTracks()[0];
  track.onended = () => { if (screen) toggleShare(); };

  live.sharing = true;
  await call?.replaceVideo(track);
  applySwitches();
}

/* ---------- what it all looks like ---------- */

const ICONS = {
  mic: 'M12 4a2.6 2.6 0 0 1 2.6 2.6v5a2.6 2.6 0 0 1-5.2 0v-5A2.6 2.6 0 0 1 12 4zM5.6 11.4a6.4 6.4 0 0 0 12.8 0M12 17.8V21M8.5 21h7',
  micOff: 'M9.4 6.2A2.6 2.6 0 0 1 14.6 6.6v4M14.6 14.2a2.6 2.6 0 0 1-5.2-1.2v-2M5.6 11.4a6.4 6.4 0 0 0 9.8 5.4M18.4 11.4a6.4 6.4 0 0 1-.5 2.5M12 17.8V21M8.5 21h7M4 3l16 18',
  cam: 'M3.5 7.5h11v9h-11zM14.5 11.5l6-3.4v7.8l-6-3.4z',
  camOff: 'M3.5 7.5h8.4M3.5 7.5v9h11v-3.6M14.5 11.5l6-3.4v7.8l-3-1.7M4 3l16 18',
  share: 'M4 5.5h16v10H4zM9.5 19.5h5M12 15.5v4M9.4 11.6 12 9l2.6 2.6M12 9.4V13',
  stopShare: 'M4 5.5h16v10H4zM9.5 19.5h5M12 15.5v4M4 3l16 18',
  hand: 'M9 11V5.6a1.3 1.3 0 0 1 2.6 0V11m0-.6V4.6a1.3 1.3 0 0 1 2.6 0V11m0-.4V6.4a1.3 1.3 0 0 1 2.6 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.4-2.6L6 15.4l-.6-1.1a1.3 1.3 0 0 1 2.2-1.4L9 14.4',
  leave: 'M4.6 12.4c4-3.7 10.8-3.7 14.8 0l1.4-2.3c-5-4.6-12.6-4.6-17.6 0zM9.5 15.4l1.3-1.8a4 4 0 0 1 2.4 0l1.3 1.8',
  people: 'M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a2.5 2.5 0 1 0 0-5M17 14c2.3.4 4 2.2 4 5',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};

const icon = (name) => `<svg viewBox="0 0 24 24" fill="none"><path d="${ICONS[name]}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function control({ id, on, onIcon, offIcon, label, danger = false, disabled = false, onclick }) {
  return el('button', {
    class: `meetkey${on ? '' : ' meetkey--off'}${danger ? ' meetkey--end' : ''}`,
    id,
    type: 'button',
    title: label,
    'aria-label': label,
    'aria-pressed': String(on),
    disabled,
    html: icon(on ? onIcon : offIcon),
    onclick,
  });
}

/* One face. A tile carries the picture when there is one and the person's
   initial when there is not, and says who it is either way. */
function tile({ id, name, photo, stream, muted = false, mirror = false, said, statusText = '' }) {
  const video = el('video', { class: 'tile__video', autoplay: true, playsinline: true, muted });

  if (stream) {
    video.srcObject = stream;
    video.play?.().catch(() => {});
  }

  const showing = Boolean(stream) && (said ? said.video || said.sharing : true);

  return el('div', {
    class: `tile${loudest === id ? ' is-talking' : ''}${said?.sharing ? ' tile--screen' : ''}`,
    'data-peer': id,
  }, [
    showing ? video : null,

    showing ? null : el('div', { class: 'tile__off' }, [
      avatar({ name, photo }, 76),
    ]),

    el('div', { class: 'tile__name' }, [
      said && !said.audio ? el('span', { class: 'tile__muted', html: icon('micOff') }) : null,
      el('b', { text: name }),
      said?.hand ? el('span', { class: 'tile__hand', text: '✋' }) : null,
    ]),

    statusText ? el('div', { class: 'tile__state', text: statusText }) : null,
  ]);
}

const SAYING = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  disconnected: 'Reconnecting…',
  failed: 'Could not connect',
  closed: '',
  connected: '',
};

function paintTiles() {
  const grid = $('meetGrid');
  if (!grid || !call) return;

  const mine = state.user.name || state.user.email;

  const nodes = [
    tile({
      id: 'me',
      name: `${mine} (you)`,
      photo: state.user.photo,
      stream: screen || camera,
      muted: true,
      mirror: !screen,
      said: { ...live, video: screen ? true : live.video },
    }),

    ...others.map((peer) => tile({
      id: peer.peerId,
      name: peer.name,
      photo: peer.photo,
      stream: peer.stream,
      said: peer.said,
      statusText: SAYING[peer.link.connectionState] ?? '',
    })),
  ];

  grid.dataset.count = String(nodes.length);
  clear(grid).append(...nodes);
}

/* The bar is redrawn rather than patched: it has six buttons in it. */
function paintBar() {
  const bar = $('meetBar');
  if (!bar) return;

  // The heading counts the room too, and is drawn once — so it is the count
  // rather than the heading that gets refreshed.
  const heading = $('meetCount');
  if (heading) heading.textContent = `${others.length + 1} of ${roomCap}`;

  clear(bar).append(
    el('div', { class: 'meetbar__count' }, [
      el('span', { class: 'meetkey__ico', html: icon('people') }),
      el('b', { text: String(others.length + 1) }),
    ]),

    el('div', { class: 'meetbar__keys' }, [
      control({
        id: 'meetMic', on: live.audio, onIcon: 'mic', offIcon: 'micOff',
        disabled: micOk === false,
        label: micOk === false ? 'No microphone on this machine'
          : live.audio ? 'Turn the microphone off' : 'Turn the microphone on',
        onclick: () => { if (micOk !== false) { live.audio = !live.audio; applySwitches(); } },
      }),
      control({
        id: 'meetCam', on: live.video, onIcon: 'cam', offIcon: 'camOff',
        disabled: cameraOk === false,
        label: cameraOk === false ? 'No camera on this machine'
          : live.video ? 'Turn the camera off' : 'Turn the camera on',
        onclick: () => { if (cameraOk !== false) { live.video = !live.video; applySwitches(); } },
      }),
      control({
        id: 'meetShare', on: !live.sharing, onIcon: 'share', offIcon: 'stopShare',
        disabled: !navigator.mediaDevices?.getDisplayMedia,
        label: live.sharing ? 'Stop sharing your screen' : 'Share your screen',
        onclick: toggleShare,
      }),
      control({
        id: 'meetHand', on: !live.hand, onIcon: 'hand', offIcon: 'hand',
        label: live.hand ? 'Put your hand down' : 'Raise your hand',
        onclick: () => { live.hand = !live.hand; applySwitches(); },
      }),
      control({
        id: 'meetEnd', on: true, onIcon: 'leave', offIcon: 'leave', danger: true,
        label: 'Leave the meeting',
        onclick: hangUp,
      }),
    ]),

    el('div', { class: 'meetbar__side' }, [
      el('button', {
        class: 'meetkey meetkey--plain', type: 'button', title: 'Full screen',
        html: icon('full'),
        onclick: () => {
          const stage = document.querySelector('.meetstage');
          if (!document.fullscreenElement) stage?.requestFullscreen?.();
          else document.exitFullscreen?.();
        },
      }),
    ]),
  );
}

/* The green room: your own camera, the two switches, and the way in. */
function greenRoom() {
  const video = el('video', { class: 'green__video', autoplay: true, muted: true, playsinline: true });
  const off = el('div', { class: 'green__off', hidden: true }, [avatar(state.user, 88)]);

  const show = () => {
    const on = live.video && cameraOk !== false;
    video.hidden = !on;
    off.hidden = on;
  };

  const switches = el('div', { class: 'green__keys' }, [
    control({
      on: live.audio, onIcon: 'mic', offIcon: 'micOff',
      disabled: micOk === false,
      label: micOk === false ? 'No microphone on this machine'
        : live.audio ? 'Join muted' : 'Join with your microphone on',
      onclick: () => { if (micOk !== false) { live.audio = !live.audio; drawStage(); } },
    }),
    control({
      on: live.video && cameraOk !== false, onIcon: 'cam', offIcon: 'camOff',
      disabled: cameraOk === false,
      label: cameraOk === false ? 'No camera on this machine'
        : live.video ? 'Join with your camera off' : 'Join with your camera on',
      onclick: () => { if (cameraOk !== false) { live.video = !live.video; drawStage(); } },
    }),
  ]);

  const mount = el('div', { class: 'green' }, [
    el('div', { class: 'green__stage' }, [video, off, switches]),
    el('div', { class: 'green__side' }, [
      el('h3', { text: staged.title }),
      el('p', { class: 'muted', text: 'Nobody can see or hear you yet. Set the camera and microphone how you want them, then walk in.' }),
      el('button', {
        class: 'btn btn--lg', type: 'button', text: 'Join now',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          button.textContent = 'Joining…';

          try {
            await enter();
          } catch (error) {
            button.disabled = false;
            button.textContent = 'Join now';
            toast(error.message, 'bad');
          }
        },
      }),
      el('div', { class: 'spread' }, [
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: 'Copy link',
          onclick: () => {
            navigator.clipboard?.writeText(`${window.location.origin}/studio#/meetings`);
            toast('Link copied.');
          },
        }),
        el('button', { class: 'ghostlink', type: 'button', text: 'Back', onclick: hangUp }),
      ]),
    ]),
  ]);

  // The camera is opened here so the picture is honest before anybody joins.
  // Until it answers, nothing is known about the devices — so when the answer
  // arrives and it changes what the switches should say, the room is drawn
  // again. Once, because the second call has the answer already.
  const asking = cameraOk === null;

  openCamera().then((stream) => {
    video.srcObject = stream;
    video.play?.().catch(() => {});

    if (asking) drawStage();
    else show();
  }).catch(() => show());

  show();
  return mount;
}

/* The stage is the room: the green room before you are in it, the grid and
   the control bar after. */
function drawStage() {
  const stage = $('meetStage');
  if (!stage || !staged) return;

  if (call) {
    clear(stage).append(
      el('div', { class: 'meetstage__bar' }, [
        el('b', { text: staged.title }),
        el('span', { class: 'meetstage__room', id: 'meetCount' }),
      ]),
      el('div', { class: 'meetgrid', id: 'meetGrid' }),
      el('div', { class: 'meetbar', id: 'meetBar' }),
    );

    paintTiles();
    paintBar();
    return;
  }

  clear(stage).append(greenRoom());
}

function draw() {
  const view = clear($('view'));

  view.appendChild(el('div', { class: 'toolbar' }, [
    el('h3', { text: `${meetings.length} ${meetings.length === 1 ? 'room' : 'rooms'}` }),
    can('meeting.manage') ? el('button', { class: 'btn', type: 'button', text: '+ New room', onclick: create }) : null,
  ]));

  if (staged) {
    view.appendChild(el('div', { class: `meetstage${call ? ' is-live' : ''}`, id: 'meetStage' }));
    drawStage();
  }

  if (!meetings.length) {
    view.appendChild(el('p', { class: 'empty', text: 'No rooms yet. Open one, and whoever is in the company can walk in.' }));
    return;
  }

  view.appendChild(el('div', { class: 'cards' }, meetings.map((meeting) => el('article', { class: 'card' }, [
    el('h4', { text: meeting.title }),
    el('p', { class: 'muted', text: `Opened by ${meeting.createdByName || 'someone'} · ${when(meeting.createdAt)}` }),
    el('div', { class: 'spread' }, [
      el('button', {
        class: 'btn btn--sm', type: 'button', text: staged?.id === meeting.id ? 'In this one' : 'Join',
        disabled: staged?.id === meeting.id,
        onclick: () => {
          staged = meeting;
          draw();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      }),
      can('meeting.manage') ? el('button', {
        class: 'ghostlink ghostlink--bad', type: 'button', text: 'Close', onclick: () => close(meeting),
      }) : null,
    ]),
  ]))));

  view.appendChild(el('p', { class: 'footnote', text:
    'The video goes browser to browser — it never passes through vlipa. On a network that will not allow a direct '
    + 'connection the room says so instead of hanging; a relay can be configured for those.' }));
}

async function load() {
  // Never from a moment ago. Somebody opens a room and says "join" in the
  // same breath, and a list ten seconds behind is a list without it in.
  const data = await api(`/api/meetings?companyId=${encodeURIComponent(state.companyId)}`, { fresh: true });

  meetings = data.meetings || [];
  ice = data.ice || ice;
  roomCap = data.room || roomCap;

  draw();
}

export async function show() {
  clear($('view')).appendChild(el('p', { class: 'empty', text: 'Loading rooms…' }));
  await load();
}

/* Leaving the page ends the call rather than leaving it running behind you. */
export function leave() {
  if (staged) hangUp();
}

export function summary() {
  return { meetings: meetings.length };
}
