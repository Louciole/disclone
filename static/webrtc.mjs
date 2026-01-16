import global from "./framework/global.mjs";
import { xhr } from "./framework/templating.mjs";

// Using public STUN servers from Google for ICE candidates, we should add TURN servers later to handle complex NATs/firewalls
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];


export class CallManager {
    constructor() {
        this.currentCall = null;
        this.localStream = null;
        this.peerConnections = {};
        this.remoteStreams = {};
        this.callType = 'audio'; // 'audio' or 'video'
        this.mode = 'p2p'; // 'p2p' or 'sfu'

        this.isMuted = false;
        this.isVideoOff = false;

        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        global.state.callManager = this;
    }


    async getLocalStream(video = false) {
        try {
            const constraints = {
                audio: true,
                video: video
            };

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.callType = video ? 'video' : 'audio';

            this.displayLocalStream();

            return this.localStream;
        } catch (error) {
            if (video && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
                try {
                    return await this.getLocalStream(false);
                } catch (audioError) {
                    throw new Error('Authorize microphone access to make calls.');
                }
            }

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                throw new Error('Authorize microphone access to make calls.');
            } else if (error.name === 'NotFoundError') {
                throw new Error('No microphone/camera found.');
            } else if (error.name === 'NotReadableError') {
                throw new Error('Microphone/camera is already in use.');
            } else {
                throw new Error('Impossible to access to camera/mic: ' + error.message);
            }
        }
    }


    async startCall(conversationId, video = false) {
        try {
            await this.getLocalStream(video);

            const response = await new Promise((resolve, reject) => {
                const onload = function() {
                    try {
                        resolve(JSON.parse(this.responseText));
                    } catch (e) {
                        reject(e);
                    }
                };
                xhr(`/startCall?conversation_id=${conversationId}&call_type=${this.callType}`,
                    onload, "POST");
            });

            this.currentCall = response;
            this.mode = response.mode;

            global.state.socket.send(JSON.stringify({
                type: "callStart",
                clientID: global.state.clientID,
                conversation_id: conversationId,
                call_type: this.callType
            }));

            this.updateCallUI();

            return response;

        } catch (error) {
            this.cleanup();
            throw error;
        }
    }


    async joinCall(callId, video = false) {
        try {
            await this.getLocalStream(video);

            const response = await new Promise((resolve, reject) => {
                const onload = function() {
                    try {
                        resolve(JSON.parse(this.responseText));
                    } catch (e) {
                        reject(e);
                    }
                };
                xhr(`/joinCall?call_id=${callId}`, onload, "POST");
            });

            this.currentCall = response.call;
            this.mode = response.call.mode;

            global.state.socket.send(JSON.stringify({
                type: "callJoin",
                clientID: global.state.clientID,
                call_id: callId
            }));


            if (this.mode === 'p2p') {
                for (const participantId of this.currentCall.participants) {
                    if (participantId !== global.user.id) {
                        await this.createPeerConnection(participantId, true);
                    }
                }
            } else {
                await this.createSFUConnection();
            }

            return response;

        } catch (error) {
            this.cleanup();
            throw error;
        }
    }

    async createPeerConnection(userId, createOffer = false) {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.peerConnections[userId] = pc;

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                global.state.socket.send(JSON.stringify({
                    type: "callIce",
                    clientID: global.state.clientID,
                    call_id: this.currentCall.id,
                    target_user: userId,
                    signal: {
                        candidate: event.candidate
                    }
                }));
            }
        };

        pc.ontrack = (event) => {
            console.log('🎥 Stream distant reçu de', userId, 'avec', event.streams[0].getTracks().length, 'tracks');
            this.remoteStreams[userId] = event.streams[0];
            this.displayRemoteStream(userId, event.streams[0]);
        };

        pc.onconnectionstatechange = () => {
            console.log(`État de connexion avec ${userId}:`, pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                this.handlePeerDisconnection(userId);
            }
        };

        if (createOffer) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            global.state.socket.send(JSON.stringify({
                type: "callOffer",
                clientID: global.state.clientID,
                call_id: this.currentCall.id,
                target_user: userId,
                signal: {
                    sdp: offer
                }
            }));
        }

        return pc;
    }

    async createSFUConnection() {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.peerConnections['sfu_server'] = pc;

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                global.state.socket.send(JSON.stringify({
                    type: "callIce",
                    clientID: global.state.clientID,
                    call_id: this.currentCall.id,
                    signal: {
                        candidate: event.candidate
                    }
                }));
            }
        };

        pc.ontrack = (event) => {
            const streamId = event.streams[0].id;
            this.remoteStreams[streamId] = event.streams[0];
            this.displayRemoteStream(streamId, event.streams[0]);
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        global.state.socket.send(JSON.stringify({
            type: "callOffer",
            clientID: global.state.clientID,
            call_id: this.currentCall.id,
            signal: {
                sdp: offer
            }
        }));

        return pc;
    }

    async handleOffer(fromUser, signal) {
        if (this.peerConnections[fromUser]) {
            this.peerConnections[fromUser].close();
            delete this.peerConnections[fromUser];
        }

        const pc = await this.createPeerConnection(fromUser, false);

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        global.state.socket.send(JSON.stringify({
            type: "callAnswer",
            clientID: global.state.clientID,
            call_id: this.currentCall.id,
            target_user: fromUser,
            signal: {
                sdp: answer
            }
        }));

    }

    async handleAnswer(fromUser, signal) {
        const pc = this.peerConnections[fromUser] || this.peerConnections['sfu_server'];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else {
        }
    }


    async handleIceCandidate(fromUser, signal) {
        const pc = this.peerConnections[fromUser] || this.peerConnections['sfu_server'];
        if (pc && signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    }

    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMuted = !audioTrack.enabled;
                this.updateCallControls();
            }
        }
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.isVideoOff = !videoTrack.enabled;
                this.updateCallControls();
            }
        }
    }

    async leaveCall() {
        if (!this.currentCall) return;

        try {
            const response = await new Promise((resolve, reject) => {
                const onload = function() {
                    try {
                        resolve(JSON.parse(this.responseText));
                    } catch (e) {
                        reject(e);
                    }
                };
                xhr(`/leaveCall?call_id=${this.currentCall.id}`, onload, "POST");
            });

            global.state.socket.send(JSON.stringify({
                type: "callLeave",
                clientID: global.state.clientID,
                call_id: this.currentCall.id
            }));
        } catch (error) {
            console.error('Error', error);
        } finally {
            this.cleanup();
        }
    }


    handlePeerDisconnection(userId) {
        console.log('Peer de-connected:', userId);

        if (this.peerConnections[userId]) {
            this.peerConnections[userId].close();
            delete this.peerConnections[userId];
        }

        if (this.remoteStreams[userId]) {
            this.removeRemoteStreamDisplay(userId);
            delete this.remoteStreams[userId];
        }
    }


    async handleModeSwitch(newMode) {
        console.log(`Changing call mode: ${this.mode} -> ${newMode}`);

        const oldMode = this.mode;
        this.mode = newMode;

        for (const userId in this.peerConnections) {
            this.peerConnections[userId].close();
        }
        this.peerConnections = {};

        if (newMode === 'sfu') {
            await this.createSFUConnection();
        } else if (newMode === 'p2p') {
            for (const participantId of this.currentCall.participants) {
                if (participantId !== global.user.id) {
                    await this.createPeerConnection(participantId, true);
                }
            }
        }

        this.updateCallUI();
    }


    displayLocalStream() {
        const localVideo = document.getElementById('local-video');
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
            localVideo.muted = true; // Éviter l'écho
        }
    }


    displayRemoteStream(userId, stream) {
        // TODO use Vesta Subscriptions and templates to handle all the display for us without direct DOM manipulation
        const container = document.getElementById('remote-videos');
        if (!container) return;

        let videoElement = document.getElementById(`remote-video-${userId}`);

        if (!videoElement) {
            const wrapper = document.createElement('div');
            wrapper.className = 'remote-video-wrapper';
            wrapper.id = `remote-wrapper-${userId}`;

            videoElement = document.createElement('video');
            videoElement.id = `remote-video-${userId}`;
            videoElement.autoplay = true;
            videoElement.playsInline = true;

            const nameLabel = document.createElement('div');
            nameLabel.className = 'video-name-label';
            nameLabel.textContent = global.users[userId]?.display || 'Utilisateur';

            wrapper.appendChild(videoElement);
            wrapper.appendChild(nameLabel);
            container.appendChild(wrapper);
        }

        videoElement.srcObject = stream;
    }


    removeRemoteStreamDisplay(userId) {
        const wrapper = document.getElementById(`remote-wrapper-${userId}`);
        if (wrapper) {
            wrapper.remove();
        }
    }

    updateCallControls() {
        // TODO Should be handled by vesta templating system
        const muteBtn = document.getElementById('call-mute-btn');
        const videoBtn = document.getElementById('call-video-btn');

        if (muteBtn) {
            muteBtn.classList.toggle('active', this.isMuted);
        }

        if (videoBtn) {
            videoBtn.classList.toggle('active', this.isVideoOff);
        }
    }

    updateCallUI() {
        console.log('Call Data');
        console.log('   - currentCall:', this.currentCall);
        console.log('   - mode:', this.mode);

        // TODO : use Discord's way to show  participants
        const participantCount = document.getElementById('call-participant-count');
        if (participantCount && this.currentCall) {
            const count = this.currentCall.participant_count ||
                         this.currentCall.participants?.length || 0;
            participantCount.textContent = count;
            console.log('   - Nombre de participants affiché:', count);
            console.log('   - participants array:', this.currentCall.participants);
        } else {
            console.log('   - Element participantCount non trouvé ou pas de currentCall');
        }
    }

    cleanup() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        for (const userId in this.peerConnections) {
            this.peerConnections[userId].close();
        }
        this.peerConnections = {};

        for (const userId in this.remoteStreams) {
            this.removeRemoteStreamDisplay(userId);
        }
        this.remoteStreams = {};

        this.currentCall = null;
        this.isMuted = false;
        this.isVideoOff = false;
        this.mode = 'p2p';

        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = null;
        }

        const container = document.getElementById('remote-videos');
        if (container) {
            container.innerHTML = '';
        }
    }
}


function showPermissionError(message) {
    console.error('Permission error:', message);

    const notification = document.createElement('div');
    notification.className = 'permission-error-notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ED4245;
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9999;
        max-width: 350px;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Auto-supprimer après 5 secondes
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}
window.showPermissionError = showPermissionError;

// Appel vocal - VERSION ULTRA SIMPLE
window.startVoiceCall = async function(conversationId) {
    const callManager = global.state.callManager;
    if (!callManager) {
        showPermissionError('Reload page.');
        return;
    }

    try {
        await callManager.startCall(conversationId, false);
        showCallView();
    } catch (error) {
        showPermissionError(error.message);
    }
};

window.startVideoCall = async function(conversationId) {
    const callManager = global.state.callManager;
    if (!callManager) {
        showPermissionError('Reload page.');
        return;
    }

    try {
        await callManager.startCall(conversationId, true);
        showCallView();
    } catch (error) {
        showPermissionError(error.message);
    }
};

window.joinCall = async function(callId, hasVideo = false) {
    console.log('Joining call', callId, hasVideo);

    const callManager = global.state.callManager;
    if (!callManager) {
        showPermissionError('ReloadPage.');
        return;
    }

    try {
        await callManager.joinCall(callId, hasVideo);
        showCallView();
    } catch (error) {
        showPermissionError(error.message);
    }
};

window.leaveCall = async function() {
    const callManager = global.state.callManager;
    if (callManager) {
        await callManager.leaveCall();
        hideCallView();
    }
};

window.toggleMute = function() {
    // TODO use mute() in controls.mjs
    const callManager = global.state.callManager;
    if (callManager) {
        callManager.toggleMute();
    }
};

window.toggleVideo = function() {
    // TODO should go in controls.mjs
    const callManager = global.state.callManager;
    if (callManager) {
        callManager.toggleVideo();
    }
};

// TODO should implement the deafen function in controls.mjs as well

function showCallView() {
    const callView = document.getElementById('call-view');
    if (callView) {
        callView.style.display = 'flex';
    }
}

function hideCallView() {
    const callView = document.getElementById('call-view');
    if (callView) {
        callView.style.display = 'none';
    }
}

export default CallManager;

