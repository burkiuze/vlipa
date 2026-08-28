/* Meetings: the company's video rooms.

   Video and audio run on Jitsi Meet: free, no account, and it brings the TURN
   servers a serverless deployment cannot. What is kept here is the room list:
   who opened it, what it is called, who is joining.

   The call itself is driven through Jitsi's external API rather than dropped
   in as a bare frame. That buys the two things a bare frame cannot have: a
   green room before you walk in — camera and microphone chosen while nobody
   can see you yet — and a control bar of our own, so muting, turning the
   camera off, sharing a screen and hanging up are where they are in every
   other meeting app rather than wherever Jitsi last moved them. */

import { api, can, state } from './api.js';
import { $, clear, dialog, el, field, toast, when } from './dom.js';

let meetings = [];
let host = 'meet.jit.si';

/* The room being looked at, and the call inside it once it has started. */
let staged = null;
let call = null;
let live = { audio: true, video: true, sharing: false, people: 1, hand: false };

/* The green room's own preview stream, which is stopped the moment the real
   call takes the camera. */
let preview = null;

function link(meeting) {
  return `https://${host}/${meeting.room}`;
}

export function create() {
  dialog({
    title: 'New meeting room',
    confirm: 'Open',
    body: [
      field('Room name', el('input', { name: 'title', required: true, maxlength: 80, placeholder: 'Monday stand-up' }),
        'A random tail is added to the address so nobody can guess their way in.'),
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
    if (staged?.id === meeting.id) hangUp();
    await load();
  } catch (error) {
    toast(error.message, 'bad');
  }
}

/* ---------- Jitsi's own script, fetched once ---------- */

let loading = null;

function jitsi() {
  if (window.JitsiMeetExternalAPI) return Promise.resolve(window.JitsiMeetExternalAPI);

  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://${host}/external_api.js`;
      script.async = true;
      script.onload = () => resolve(window.JitsiMeetExternalAPI);
      script.onerror = () => { loading = null; reject(new Error('Could not reach the video service.')); };
      document.head.appendChild(script);
    });
  }

  return loading;
}

/* ---------- the green room ---------- */

/* Whether this machine has a camera we are allowed to use. Unknown until we
   ask; once the answer is no it stays no, because asking again on every
   redraw is how a green room ends up in a loop. */
let cameraOk = null;

/* The camera, shown to you and nobody else, so nothing is a surprise once you
   are in the room. A refused camera is not an error: plenty of meetings are
   attended with it off. */
async function startPreview(video) {
  stopPreview();

  if (cameraOk === false || !live.video) return cameraOk !== false;

  try {
    preview = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = preview;
    cameraOk = true;
    return true;
  } catch {
    cameraOk = false;
    return false;
  }
}

function stopPreview() {
  preview?.getTracks().forEach((track) => track.stop());
  preview = null;
}

/* ---------- the call ---------- */

async function enter(mount) {
  const Api = await jitsi();

  // The preview holds the camera; Jitsi wants it next.
  stopPreview();

  call = new Api(host, {
    roomName: staged.room,
    parentNode: mount,
    userInfo: { displayName: state.user.name || state.user.email },
    configOverwrite: {
      // Straight in: the choices Jitsi's own front door asks for were made in
      // the green room a moment ago.
      prejoinPageEnabled: false,
      startWithAudioMuted: !live.audio,
      startWithVideoMuted: !live.video,
      disableDeepLinking: true,
      toolbarButtons: [],
    },
    interfaceConfigOverwrite: {
      TOOLBAR_BUTTONS: [],
      SHOW_JITSI_WATERMARK: false,
      SHOW_WATERMARK_FOR_GUESTS: false,
      MOBILE_APP_PROMO: false,
      DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
    },
  });

  // Jitsi is the one that knows what actually happened — a mute can come from
  // a keyboard shortcut, or from the moderator — so the bar follows it rather
  // than the other way round.
  call.addListener('audioMuteStatusChanged', ({ muted }) => { live.audio = !muted; paintBar(); });
  call.addListener('videoMuteStatusChanged', ({ muted }) => { live.video = !muted; paintBar(); });
  call.addListener('screenSharingStatusChanged', ({ on }) => { live.sharing = Boolean(on); paintBar(); });
  call.addListener('raiseHandUpdated', ({ id, handRaised }) => {
    if (id === call.getMyUserId?.()) { live.hand = Boolean(handRaised); paintBar(); }
  });

  const count = () => { live.people = call.getNumberOfParticipants?.() || 1; paintBar(); };
  call.addListener('participantJoined', count);
  call.addListener('participantLeft', count);
  call.addListener('videoConferenceJoined', count);
  call.addListener('readyToClose', hangUp);
}

function hangUp() {
  try { call?.dispose(); } catch { /* already gone */ }

  call = null;
  staged = null;
  stopPreview();
  live = { audio: true, video: cameraOk !== false, sharing: false, people: 1, hand: false };
  draw();
}

const command = (name) => { try { call?.executeCommand(name); } catch { /* the call ended */ } };

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

function control({ id, on, onIcon, offIcon, label, danger = false, onclick }) {
  return el('button', {
    class: `meetkey${on ? '' : ' meetkey--off'}${danger ? ' meetkey--end' : ''}`,
    id,
    type: 'button',
    title: label,
    'aria-label': label,
    'aria-pressed': String(on),
    html: icon(on ? onIcon : offIcon),
    onclick,
  });
}

/* The bar is redrawn rather than patched: it has six buttons in it. */
function paintBar() {
  const bar = $('meetBar');
  if (!bar) return;

  clear(bar).append(
    el('div', { class: 'meetbar__count' }, [
      el('span', { class: 'meetkey__ico', html: icon('people') }),
      el('b', { text: String(live.people) }),
    ]),

    el('div', { class: 'meetbar__keys' }, [
      control({
        id: 'meetMic', on: live.audio, onIcon: 'mic', offIcon: 'micOff',
        label: live.audio ? 'Turn the microphone off' : 'Turn the microphone on',
        onclick: () => command('toggleAudio'),
      }),
      control({
        id: 'meetCam', on: live.video, onIcon: 'cam', offIcon: 'camOff',
        label: live.video ? 'Turn the camera off' : 'Turn the camera on',
        onclick: () => command('toggleVideo'),
      }),
      control({
        id: 'meetShare', on: !live.sharing, onIcon: 'share', offIcon: 'stopShare',
        label: live.sharing ? 'Stop sharing your screen' : 'Share your screen',
        onclick: () => command('toggleShareScreen'),
      }),
      control({
        id: 'meetHand', on: !live.hand, onIcon: 'hand', offIcon: 'hand',
        label: live.hand ? 'Put your hand down' : 'Raise your hand',
        onclick: () => command('toggleRaiseHand'),
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
  const off = el('div', { class: 'green__off', hidden: true }, [
    el('span', { class: 'green__initial', text: (state.user.name || state.user.email || '?').trim().charAt(0).toUpperCase() }),
  ]);

  const show = () => { video.hidden = !live.video; off.hidden = live.video; };

  const switches = el('div', { class: 'green__keys' }, [
    control({
      on: live.audio, onIcon: 'mic', offIcon: 'micOff',
      label: live.audio ? 'Join muted' : 'Join with your microphone on',
      onclick: () => { live.audio = !live.audio; drawStage(); },
    }),
    control({
      on: live.video, onIcon: 'cam', offIcon: 'camOff',
      label: cameraOk === false
        ? 'No camera on this machine'
        : (live.video ? 'Join with your camera off' : 'Join with your camera on'),
      onclick: () => {
        if (cameraOk === false) return;
        live.video = !live.video;
        drawStage();
      },
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
            const frame = clear($('meetFrame'));
            await enter(frame);
            drawStage();
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
          onclick: () => { navigator.clipboard?.writeText(link(staged)); toast('Link copied.'); },
        }),
        el('a', { class: 'ghostlink', href: link(staged), target: '_blank', rel: 'noopener', text: 'Open in a new tab' }),
        el('button', { class: 'ghostlink', type: 'button', text: 'Back', onclick: hangUp }),
      ]),
    ]),
  ]);

  show();

  // Redrawn once, and only when the answer changed something: a machine with
  // no camera would otherwise redraw, ask again, fail again, and never stop.
  startPreview(video).then((got) => {
    if (got || !live.video) return;
    live.video = false;
    drawStage();
  });

  return mount;
}

/* The stage is the room: the green room before you are in it, the call and
   the control bar after. */
function drawStage() {
  const stage = $('meetStage');
  if (!stage || !staged) return;

  const frame = $('meetFrame') || el('div', { class: 'meetstage__frame', id: 'meetFrame' });

  if (call) {
    clear(stage).append(
      el('div', { class: 'meetstage__bar' }, [
        el('b', { text: staged.title }),
        el('span', { class: 'meetstage__room', text: staged.room }),
      ]),
      frame,
      el('div', { class: 'meetbar', id: 'meetBar' }),
    );

    paintBar();
    return;
  }

  clear(stage).append(greenRoom(), frame);
  frame.hidden = true;
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
    view.appendChild(el('p', { class: 'empty', text: 'No rooms yet. Open one, share the address with the team, turn your camera on.' }));
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
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: 'Copy link',
        onclick: () => { navigator.clipboard?.writeText(link(meeting)); toast('Link copied.'); },
      }),
      can('meeting.manage') ? el('button', {
        class: 'ghostlink ghostlink--bad', type: 'button', text: 'Close', onclick: () => close(meeting),
      }) : null,
    ]),
  ]))));

  view.appendChild(el('p', { class: 'footnote', text:
    'Video calls run on Jitsi Meet. Anyone with the room address can walk in, so keep the link inside the team.' }));
}

async function load() {
  const data = await api(`/api/meetings?companyId=${encodeURIComponent(state.companyId)}`);

  meetings = data.meetings || [];
  host = data.host || host;

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
