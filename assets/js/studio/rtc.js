/* The call itself: everybody in the room connected to everybody else.

   A meeting is a mesh. Each person opens one connection per other person and
   sends their camera down all of them, which is the simplest thing that
   works and the reason the room is capped at six — the outgoing bandwidth
   goes up with the number of people, and a laptop on home broadband runs out
   somewhere around there.

   Two browsers finding each other takes a short conversation — an offer, an
   answer, and a stream of network candidates as each one discovers a way it
   might be reached. That conversation goes through the server; the audio and
   video do not. Once the link is up the server hears nothing more except a
   heartbeat.

   The awkward part of WebRTC is both sides deciding to renegotiate at once,
   which used to be a fortnight of bugs. The fix is a settled one — "perfect
   negotiation": each pair decides in advance which of them gives way, by
   comparing their two ids, and the one that gives way rolls back its own
   offer rather than arguing. */

const POLL_FAST = 900;
const POLL_IDLE = 2500;

/* A connection that has said nothing for this long is stuck rather than slow,
   and is worth starting again. */
const STUCK_MS = 12000;

export function createCall({ meetingId, ask, onPeers, onStream, onGone, onState, onSaid }) {
  /* Everything about one other person in the room. */
  const peers = new Map();

  let me = '';
  let local = null;
  let running = false;
  let timer = null;
  let ice = [{ urls: ['stun:stun.l.google.com:19302'] }];

  const post = (body) => ask({ meetingId, peerId: me, ...body });

  /* ---------- one link ---------- */

  function linkTo(who) {
    if (peers.has(who.peerId)) return peers.get(who.peerId);

    const link = new RTCPeerConnection({ iceServers: ice, iceCandidatePoolSize: 2 });

    // Which of the two gives way when both offer at once. Comparing the ids
    // gives the same answer on both sides without asking anybody.
    const polite = me < who.peerId;

    const peer = {
      ...who,
      link,
      polite,
      making: false,
      ignoring: false,
      stream: null,
      since: Date.now(),
      said: { audio: true, video: true, hand: false, sharing: false },
    };

    peers.set(who.peerId, peer);

    for (const track of local ? local.getTracks() : []) link.addTrack(track, local);

    link.ontrack = (event) => {
      peer.stream = event.streams[0];
      onStream?.(peer);
    };

    link.onicecandidate = (event) => {
      if (event.candidate) post({ action: 'signal', to: who.peerId, kind: 'ice', data: event.candidate.toJSON() }).catch(() => {});
    };

    link.onnegotiationneeded = async () => {
      try {
        peer.making = true;
        await link.setLocalDescription();
        await post({ action: 'signal', to: who.peerId, kind: 'sdp', data: link.localDescription });
      } catch {
        /* the room closed under us */
      } finally {
        peer.making = false;
      }
    };

    link.onconnectionstatechange = () => {
      peer.since = Date.now();
      onState?.(peer, link.connectionState);

      // A failed link is not a lost person: the network moved, so try again
      // from scratch rather than leaving a black square on screen.
      if (link.connectionState === 'failed') restart(peer);
    };

    // The little facts about somebody that are not audio or video: whether
    // their microphone is off, whether their hand is up. A negotiated channel
    // is agreed by both sides opening the same id, so neither has to be told
    // about it — and none of it goes near the server.
    peer.channel = link.createDataChannel('vlipa', { negotiated: true, id: 0 });
    wireChannel(peer);

    onPeers?.([...peers.values()]);
    return peer;
  }

  function wireChannel(peer) {
    peer.channel.onmessage = (event) => {
      try {
        Object.assign(peer.said, JSON.parse(event.data));
        onSaid?.(peer);
      } catch { /* not ours */ }
    };
  }

  async function restart(peer) {
    try {
      peer.link.restartIce();
      await peer.link.setLocalDescription();
      await post({ action: 'signal', to: peer.peerId, kind: 'sdp', data: peer.link.localDescription });
    } catch { /* it will be dropped by the roster instead */ }
  }

  function drop(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return;

    try { peer.link.close(); } catch { /* already closed */ }
    peers.delete(peerId);
    onGone?.(peer);
    onPeers?.([...peers.values()]);
  }

  /* ---------- what arrives ---------- */

  async function take(message) {
    const peer = peers.get(message.from);
    if (!peer) return;

    try {
      if (message.kind === 'sdp') {
        const description = message.data;

        // The heart of perfect negotiation: an offer arriving while we are
        // making one of our own is a collision, and the impolite side simply
        // ignores it.
        const clashing = description.type === 'offer'
          && (peer.making || peer.link.signalingState !== 'stable');

        peer.ignoring = !peer.polite && clashing;
        if (peer.ignoring) return;

        await peer.link.setRemoteDescription(description);

        if (description.type === 'offer') {
          await peer.link.setLocalDescription();
          await post({ action: 'signal', to: peer.peerId, kind: 'sdp', data: peer.link.localDescription });
        }
      }

      if (message.kind === 'ice') {
        try {
          await peer.link.addIceCandidate(message.data);
        } catch (error) {
          // A candidate for an offer we ignored is expected, and not a fault.
          if (!peer.ignoring) throw error;
        }
      }
    } catch (error) {
      console.warn('[vlipa] signal:', error.message);
    }
  }

  /* ---------- the loop ---------- */

  async function beat() {
    if (!running) return;

    let answer;

    try {
      answer = await post({ action: 'poll' });
    } catch (error) {
      // A seat lost while the laptop slept: take another one.
      if (error.status === 409) return start(local).catch(() => {});
      onState?.(null, 'offline');
      timer = setTimeout(beat, POLL_IDLE);
      return;
    }

    const here = new Set((answer.peers || []).map((one) => one.peerId));

    for (const peerId of [...peers.keys()]) if (!here.has(peerId)) drop(peerId);

    for (const who of answer.peers || []) {
      const known = peers.get(who.peerId);

      // Somebody new: the one with the lower id offers, so exactly one offer
      // is made rather than two crossing.
      if (!known) {
        const peer = linkTo(who);
        if (!peer.polite) await restart(peer).catch(() => {});
        continue;
      }

      Object.assign(known, { name: who.name, photo: who.photo, userId: who.userId });

      // Nothing has happened on this link for long enough that it is not
      // going to on its own.
      const stuck = ['new', 'connecting', 'disconnected'].includes(known.link.connectionState)
        && Date.now() - known.since > STUCK_MS;

      if (stuck && !known.polite) {
        known.since = Date.now();
        restart(known).catch(() => {});
      }
    }

    for (const message of answer.messages || []) await take(message);

    onPeers?.([...peers.values()]);

    // Fast while anybody is still finding their way in, slow once everybody
    // is through — the mailbox is empty either way, but a call that is up
    // does not need checking every second.
    const settling = [...peers.values()].some((peer) => peer.link.connectionState !== 'connected');
    timer = setTimeout(beat, settling || (answer.messages || []).length ? POLL_FAST : POLL_IDLE);
  }

  /* ---------- the way in and out ---------- */

  async function start(stream, servers) {
    local = stream;
    if (servers?.length) ice = servers;

    const seat = await post({ action: 'join', peerId: me || undefined });
    me = seat.peerId;
    running = true;

    for (const who of seat.peers || []) {
      const peer = linkTo(who);
      if (!peer.polite) restart(peer).catch(() => {});
    }

    clearTimeout(timer);
    timer = setTimeout(beat, POLL_FAST);
    onPeers?.([...peers.values()]);

    return seat;
  }

  function say(what) {
    for (const peer of peers.values()) {
      try {
        if (peer.channel?.readyState === 'open') peer.channel.send(JSON.stringify(what));
      } catch { /* the channel closed mid-send */ }
    }
  }

  /* Swapping the camera for a shared screen, and back, without renegotiating
     the whole call: the sender keeps its place and takes a different track. */
  async function replaceVideo(track) {
    for (const peer of peers.values()) {
      const sender = peer.link.getSenders().find((one) => one.track?.kind === 'video')
        || peer.link.getSenders().find((one) => !one.track);

      if (sender) await sender.replaceTrack(track).catch(() => {});
    }
  }

  async function stop() {
    running = false;
    clearTimeout(timer);

    for (const peerId of [...peers.keys()]) drop(peerId);
    if (me) await post({ action: 'leave' }).catch(() => {});
    me = '';
  }

  return {
    start,
    stop,
    say,
    replaceVideo,
    peers: () => [...peers.values()],
    id: () => me,
  };
}
