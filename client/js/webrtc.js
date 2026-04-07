export function createRTC() {
    return {
        pc: null,
        dc: null,
        ready: false,
        _timeoutId: null,
    };
}

export function startRTC(rtc, ws, onOpen, onMessage, onClose) {
    stopRTC(rtc);

    const pc = new RTCPeerConnection();
    rtc.pc = pc;

    const dc = pc.createDataChannel('game', {
        ordered: false,
        maxRetransmits: 0,
    });
    dc.binaryType = 'arraybuffer';
    rtc.dc = dc;

    dc.onopen = () => {
        rtc.ready = true;
        if (onOpen) onOpen();
    };

    dc.onclose = () => {
        rtc.ready = false;
        if (onClose) onClose();
    };

    dc.onmessage = (e) => {
        if (onMessage) onMessage(e.data);
    };

    pc.onicecandidate = (e) => {
        if (e.candidate && ws.readyState === 1) {
            ws.send(JSON.stringify({
                t: 'rtc-ice',
                candidate: JSON.stringify(e.candidate.toJSON()),
            }));
        }
    };

    pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                    t: 'rtc-offer',
                    sdp: pc.localDescription.sdp,
                }));
            }
        })
        .catch(() => {
            stopRTC(rtc);
        });

    rtc._timeoutId = setTimeout(() => {
        if (!rtc.ready) {
            stopRTC(rtc);
        }
    }, 5000);
}

export function handleSignaling(rtc, msg) {
    if (!rtc.pc) return;

    if (msg.t === 'rtc-answer') {
        rtc.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(() => {});
    } else if (msg.t === 'rtc-ice') {
        const candidate = JSON.parse(msg.candidate);
        rtc.pc.addIceCandidate(candidate).catch(() => {});
    }
}

export function sendRTC(rtc, data) {
    if (rtc.ready && rtc.dc && rtc.dc.readyState === 'open') {
        rtc.dc.send(data);
        return true;
    }
    return false;
}

export function stopRTC(rtc) {
    if (rtc._timeoutId) {
        clearTimeout(rtc._timeoutId);
        rtc._timeoutId = null;
    }
    if (rtc.dc) {
        try { rtc.dc.close(); } catch {}
        rtc.dc = null;
    }
    if (rtc.pc) {
        try { rtc.pc.close(); } catch {}
        rtc.pc = null;
    }
    rtc.ready = false;
}
