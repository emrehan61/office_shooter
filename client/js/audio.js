const ANNOUNCER_AUDIO_URL = new URL('../audio/anouncer.mp3', import.meta.url);

const RAW_ANNOUNCER_SEGMENTS = {
    clip01: { start: 0.904036, duration: 2.692109, cooldownMs: 3500, transcript: '3, 2, 1' },
    clip02: { start: 5.932789, duration: 1.153923, cooldownMs: 1500, transcript: 'Lock and load' },
    clip03: { start: 9.107868, duration: 1.165284, cooldownMs: 5000, transcript: 'First blood' },
    clip13: { start: 42.077415, duration: 1.33263, cooldownMs: 1200, transcript: 'Kill confirmed' },
    clip27: { start: 91.091701, duration: 1.219002, cooldownMs: 3000, transcript: 'You win' },
    clip28: { start: 94.5339, duration: 1.464218, cooldownMs: 3000, transcript: 'You lose' },
    clip29: { start: 98.193356, duration: 1.487642, cooldownMs: 1200, transcript: 'Elimination' },
    clip31: { start: 104.850045, duration: 1.097007, cooldownMs: 4000, transcript: 'Game over' },
};

export const ANNOUNCER_CUES = {
    countdown: RAW_ANNOUNCER_SEGMENTS.clip01,
    lockAndLoad: RAW_ANNOUNCER_SEGMENTS.clip02,
    firstBlood: RAW_ANNOUNCER_SEGMENTS.clip03,
    killConfirmed: RAW_ANNOUNCER_SEGMENTS.clip13,
    youWin: RAW_ANNOUNCER_SEGMENTS.clip27,
    youLose: RAW_ANNOUNCER_SEGMENTS.clip28,
    elimination: RAW_ANNOUNCER_SEGMENTS.clip29,
    gameOver: RAW_ANNOUNCER_SEGMENTS.clip31,
};

export function createAnnouncer() {
    return {
        context: null,
        gainNode: null,
        buffer: null,
        loadPromise: null,
        lastPlayedAt: new Map(),
    };
}

export function snapshotMatchForAnnouncer(match = {}) {
    return {
        buyPhase: !!match.buyPhase,
        buyTimeLeftMs: Math.max(0, match.buyTimeLeftMs || 0),
        intermission: !!match.intermission,
        roundWinner: match.roundWinner || '',
        currentRound: match.currentRound || 0,
        totalRounds: match.totalRounds || 0,
    };
}

export function createKillAnnouncerState(currentRound = 0) {
    return {
        currentRound,
        firstBloodPlayed: false,
    };
}

export function getAnnouncerMatchCues(previous, next, context = {}) {
    if (!previous || !next) return [];

    const cues = [];
    const previousCountdown = previous.buyPhase ? Math.ceil(previous.buyTimeLeftMs / 1000) : null;
    const nextCountdown = next.buyPhase ? Math.ceil(next.buyTimeLeftMs / 1000) : null;

    if (next.buyPhase && nextCountdown === 3 && nextCountdown !== previousCountdown) {
        cues.push('countdown');
    }

    if (previous.buyPhase && !next.buyPhase && !next.intermission) {
        cues.push('lockAndLoad');
    }

    if (!previous.intermission && next.intermission) {
        const resultCue = getRoundResultCue(next, context.myTeam);
        if (resultCue) {
            cues.push(resultCue);
        }
    }

    return cues;
}

export function getAnnouncerKillCues(state, killEvent, myId) {
    const nextState = {
        currentRound: state?.currentRound || 0,
        firstBloodPlayed: !!state?.firstBloodPlayed,
    };
    const cues = [];

    if (!killEvent) {
        return { cues, state: nextState };
    }

    if (!nextState.firstBloodPlayed) {
        cues.push('firstBlood');
        nextState.firstBloodPlayed = true;
        return { cues, state: nextState };
    }

    if (killEvent.killer === myId) {
        cues.push('killConfirmed');
    }

    if (killEvent.victim === myId) {
        cues.push('elimination');
    }

    return { cues, state: nextState };
}

export function primeAnnouncer(announcer) {
    if (!announcer) return Promise.resolve(null);

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor || typeof fetch !== 'function') {
        return Promise.resolve(null);
    }

    if (!announcer.context) {
        announcer.context = new AudioContextCtor();
        announcer.gainNode = announcer.context.createGain();
        announcer.gainNode.gain.value = 0.9;
        announcer.gainNode.connect(announcer.context.destination);
    }

    if (announcer.context.state === 'suspended') {
        void announcer.context.resume().catch(() => {});
    }

    if (!announcer.loadPromise) {
        announcer.loadPromise = fetch(ANNOUNCER_AUDIO_URL)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`announcer audio request failed: ${response.status}`);
                }
                return response.arrayBuffer();
            })
            .then((data) => announcer.context.decodeAudioData(data.slice(0)))
            .then((buffer) => {
                announcer.buffer = buffer;
                return buffer;
            })
            .catch((error) => {
                announcer.loadPromise = null;
                console.warn('Failed to load announcer audio', error);
                return null;
            });
    }

    return announcer.loadPromise;
}

export function playAnnouncerCue(announcer, cueName, nowMs = Date.now()) {
    const cue = ANNOUNCER_CUES[cueName];
    if (!announcer || !cue) return;

    const previousPlayAt = announcer.lastPlayedAt.get(cueName) ?? -Infinity;
    if (nowMs - previousPlayAt < (cue.cooldownMs || 0)) {
        return;
    }
    announcer.lastPlayedAt.set(cueName, nowMs);

    void primeAnnouncer(announcer).then((buffer) => {
        if (!buffer || !announcer.context || !announcer.gainNode) return;

        if (announcer.context.state === 'suspended') {
            return;
        }

        const source = announcer.context.createBufferSource();
        source.buffer = buffer;
        source.connect(announcer.gainNode);
        source.start(0, cue.start, cue.duration);
    });
}

function getAudioContextCtor() {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
}

function getRoundResultCue(match, myTeam) {
    if (!match.roundWinner) {
        return match.currentRound >= match.totalRounds ? 'gameOver' : null;
    }
    if (!myTeam) return null;
    return match.roundWinner === myTeam ? 'youWin' : 'youLose';
}
