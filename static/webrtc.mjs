import global from "./framework/global.mjs";
import { xhr } from "./framework/templating.mjs";
import { setElement, pushElement, deleteVal } from "./framework/vesta.mjs";

// STUN servers for ICE candidates - TURN servers should be added for production
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

/**
 * CallManager - Manages WebRTC P2P and SFU calls
 *
 * Key Principles:
 * 1. Only the JOINER creates peer connections with offers
 * 2. Existing participants WAIT for offers from joiners
 * 3. ICE candidates are queued until remote description is set
 * 4. Glare (simultaneous offers) is resolved with user ID tiebreaker
 * 5. All state changes use Vesta's reactive system
 */
export class CallManager {
    constructor() {
        // Call state
        this.currentCall = null;
        this.mode = 'p2p'; // 'p2p' or 'sfu'
        this.callType = 'audio'; // 'audio' or 'video'
        this.callState = 'none'; // 'none', 'banner', 'calling', 'active'
        this.displayMode = 'banner-small'; // 'banner-small (in banner only audio flux)', 'banner-big (in banner, mixed media or only video)' //TODO add full screen mode and room mode

        // Media streams
        this.localStream = null;
        this.remoteStreams = {}; // userId -> MediaStream
        this.remoteParticipants = []; // Array for template rendering with status
        this.availableActions = []; // Dynamic actions based on state

        // WebRTC connections
        this.peerConnections = {}; // userId -> RTCPeerConnection
        this.iceCandidateQueues = {}; // userId -> [ICE candidates]

        // Audio/Video controls
        this.isMuted = false;
        this.isVideoOff = false;
        this.isDeafened = false;

        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        // Register this instance globally for WebSocket handlers
        global.state.callManager = this;

        // Initialize reactive properties
        setElement('global.state.callManager.callState', this.callState);
        setElement('global.state.callManager.remoteParticipants', this.remoteParticipants);
        setElement('global.state.callManager.availableActions', this.availableActions);
    }

    /**
     * Update available actions based on current call state
     */
    updateAvailableActions() {
        console.log('🔄 updateAvailableActions called, callState:', this.callState);

        switch (this.callState) {
            case 'banner':
                // Banner: show info + join button
                const call = global.convs[global.state.activeConv]?.ongoingCall;
                console.log('📋 Banner mode, call data:', call);

                this.availableActions = [
                    {
                        type: 'info',
                        icon: call?.call_type === 'video' ? 'videocam' : 'call',
                        label: 'Appel en cours'
                    },
                    {
                        type: 'join',
                        callId: call?.id,
                        isVideo: call?.call_type === 'video'
                    }
                ];
                break;

            case 'calling':
            case 'active':
                // In call: show controls
                this.availableActions = [{ type: 'controls' }];
                break;

            default:
                this.availableActions = [];
        }

        console.log('✅ availableActions set to:', this.availableActions);
        setElement('global.state.callManager.availableActions', this.availableActions);
    }

    // ==================== MEDIA STREAM MANAGEMENT ====================

    /**
     * Get local media stream (audio/video)
     */
    async getLocalStream(video = false) {
        try {
            const constraints = { audio: true, video: video };

            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.callType = video ? 'video' : 'audio';
            setElement('global.state.callManager.callType', this.callType);

            this.displayLocalStream();
            console.log(`✅ Local ${this.callType} stream acquired`);

            return this.localStream;
        } catch (error) {
            // Fallback: if video fails, try audio only
            if (video && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
                console.warn('Video permission denied, falling back to audio only');
                try {
                    return await this.getLocalStream(false);
                } catch (audioError) {
                    throw new Error('Microphone access required to make calls.');
                }
            }

            // Handle various getUserMedia errors
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                throw new Error('Microphone/camera permission denied.');
            } else if (error.name === 'NotFoundError') {
                throw new Error('No microphone/camera found.');
            } else if (error.name === 'NotReadableError') {
                throw new Error('Microphone/camera is already in use.');
            } else {
                throw new Error(`Media access error: ${error.message}`);
            }
        }
    }

    displayLocalStream() {
        const localVideo = document.getElementById('local-video');
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
            localVideo.muted = true; // Prevent echo
        }
    }

    /**
     * Play outgoing call ringtone
     */
    playOutgoingRingtone() {
        const ringtone = document.getElementById('outgoing-call-tone');
        if (ringtone) {
            ringtone.currentTime = 0;
            ringtone.play().catch(e => console.log('Cannot play outgoing ringtone:', e));
        }
    }

    /**
     * Stop outgoing call ringtone
     */
    stopOutgoingRingtone() {
        const ringtone = document.getElementById('outgoing-call-tone');
        if (ringtone) {
            ringtone.pause();
            ringtone.currentTime = 0;
        }
    }

    // ==================== CALL LIFECYCLE ====================

    /**
     * Start a new call
     */
    async startCall(conversationId, video = false) {
        try {
            await this.getLocalStream(video);

            // Create call on server
            const response = await this._httpRequest('POST', `/startCall?conversation_id=${conversationId}&call_type=${this.callType}`);

            // Update state reactively
            this.currentCall = response;
            this.mode = response.mode;
            this.callState = 'calling';
            setElement('global.state.callManager.currentCall', response);
            setElement('global.state.callManager.mode', response.mode);
            setElement('global.state.callManager.callState', 'calling');

            // Get conversation members and add them as 'calling' participants
            const conv = global.convs[conversationId];
            if (conv && conv.members) {
                this.remoteParticipants = conv.members
                    .filter(userId => userId !== global.user.id)
                    .map(userId => ({ userId, status: 'calling' }));
                setElement('global.state.callManager.remoteParticipants', this.remoteParticipants);
            }

            // Update available actions
            this.updateAvailableActions();

            // Play outgoing call ringtone
            this.playOutgoingRingtone();

            // Notify server via WebSocket
            this._sendWebSocketMessage({
                type: "callStart",
                conversation_id: conversationId,
                call_type: this.callType
            });

            console.log(`✅ Call started (ID: ${response.id}, mode: ${this.mode})`);
            return response;

        } catch (error) {
            console.error('❌ Failed to start call:', error);
            this.cleanup();
            throw error;
        }
    }

    /**
     * Join an existing call
     */
    async joinCall(callId, video = false) {
        try {
            await this.getLocalStream(video);

            // Join call on server
            const response = await this._httpRequest('POST', `/joinCall?call_id=${callId}`);

            // Update state reactively
            this.currentCall = response.call;
            this.mode = response.call.mode;
            this.callState = 'active';
            setElement('global.state.callManager.currentCall', response.call);
            setElement('global.state.callManager.mode', response.call.mode);
            setElement('global.state.callManager.callState', 'active');

            // Initialize remote participants with 'connected' status
            this.remoteParticipants = response.call.participants
                .filter(userId => userId !== global.user.id)
                .map(userId => ({ userId, status: 'connected' }));
            setElement('global.state.callManager.remoteParticipants', this.remoteParticipants);

            // Update available actions
            this.updateAvailableActions();

            // Notify server via WebSocket
            this._sendWebSocketMessage({
                type: "callJoin",
                call_id: callId
            });

            // IMPORTANT: As the joiner, WE create offers to all existing participants
            if (this.mode === 'p2p') {
                for (const participantId of this.currentCall.participants) {
                    if (participantId !== global.user.id) {
                        console.log(`📤 Creating peer connection to user ${participantId} (we are joiner)`);
                        await this.createPeerConnection(participantId, true);
                    }
                }
            } else if (this.mode === 'sfu') {
                await this.createSFUConnection();
            }

            console.log(`✅ Joined call (ID: ${callId}, mode: ${this.mode})`);
            return response;

        } catch (error) {
            console.error('❌ Failed to join call:', error);
            this.cleanup();
            throw error;
        }
    }

    /**
     * Leave the current call
     */
    async leaveCall() {
        if (!this.currentCall) return;

        try {
            const callId = this.currentCall.id;

            // Notify server via HTTP
            await this._httpRequest('POST', `/leaveCall?call_id=${callId}`);

            // Notify server via WebSocket
            this._sendWebSocketMessage({
                type: "callLeave",
                call_id: callId
            });

            console.log(`✅ Left call (ID: ${callId})`);
        } catch (error) {
            console.error('❌ Error leaving call:', error);
        } finally {
            this.cleanup();
        }
    }

    // ==================== PEER CONNECTION MANAGEMENT ====================

    /**
     * Create a WebRTC peer connection
     * @param {number} userId - The user to connect to
     * @param {boolean} createOffer - Whether to create and send an offer
     */
    async createPeerConnection(userId, createOffer = false) {
        console.log(`🔗 Creating peer connection to user ${userId} (createOffer: ${createOffer})`);

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.peerConnections[userId] = pc;
        this.iceCandidateQueues[userId] = []; // Initialize queue

        // Add local tracks to connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // ICE candidate handler
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this._sendWebSocketMessage({
                    type: "callIce",
                    call_id: this.currentCall.id,
                    target_user: userId,
                    signal: { candidate: event.candidate }
                });
            }
        };

        // Remote track handler
        pc.ontrack = (event) => {
            console.log(`📥 Received remote track from user ${userId}`);
            const stream = event.streams[0];
            this.remoteStreams[userId] = stream;
            this.displayRemoteStream(userId, stream);

            // Update participant status to 'active' when we receive their stream
            const participant = this.remoteParticipants.find(p => p.userId === userId);
            if (participant && participant.status !== 'active') {
                participant.status = 'active';
                setElement('global.state.callManager.remoteParticipants', this.remoteParticipants);
            }

            // Listen for track enable/disable to update avatar display
            stream.getTracks().forEach(track => {
                track.addEventListener('enabled', () => {
                    if (track.kind === 'video') {
                        this._updateVideoDisplay(userId, stream);
                    }
                });
                track.addEventListener('mute', () => {
                    if (track.kind === 'video') {
                        this._updateVideoDisplay(userId, stream);
                    }
                });
                track.addEventListener('unmute', () => {
                    if (track.kind === 'video') {
                        this._updateVideoDisplay(userId, stream);
                    }
                });
            });
        };

        // Connection state monitoring
        pc.onconnectionstatechange = () => {
            console.log(`🔄 Connection state with ${userId}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                this.handlePeerDisconnection(userId);
            } else if (pc.connectionState === 'connected') {
                console.log(`✅ Connected to user ${userId}`);
            }
        };

        // ICE connection state monitoring
        pc.oniceconnectionstatechange = () => {
            console.log(`🧊 ICE state with ${userId}: ${pc.iceConnectionState}`);
        };

        // Create and send offer if we're the initiator
        if (createOffer) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            this._sendWebSocketMessage({
                type: "callOffer",
                call_id: this.currentCall.id,
                target_user: userId,
                signal: { sdp: offer }
            });

            console.log(`📤 Offer sent to user ${userId}`);
        }

        return pc;
    }

    /**
     * Create SFU server connection
     */
    async createSFUConnection() {
        console.log('🔗 Creating SFU server connection');

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.peerConnections['sfu_server'] = pc;
        this.iceCandidateQueues['sfu_server'] = [];

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // ICE candidate handler
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this._sendWebSocketMessage({
                    type: "callIce",
                    call_id: this.currentCall.id,
                    signal: { candidate: event.candidate }
                });
            }
        };

        // Remote track handler
        pc.ontrack = (event) => {
            const streamId = event.streams[0].id;
            console.log(`📥 Received remote track from SFU (stream: ${streamId})`);
            this.remoteStreams[streamId] = event.streams[0];
            this.displayRemoteStream(streamId, event.streams[0]);
        };

        // Create and send offer to SFU
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        this._sendWebSocketMessage({
            type: "callOffer",
            call_id: this.currentCall.id,
            signal: { sdp: offer }
        });

        console.log('📤 Offer sent to SFU server');
        return pc;
    }

    // ==================== SIGNALING HANDLERS ====================

    /**
     * Handle incoming WebRTC offer
     */
    async handleOffer(fromUser, signal) {
        console.log(`📨 Received offer from user ${fromUser}`);

        try {
            const existingPc = this.peerConnections[fromUser];

            // Handle offer glare (both sides sent offers simultaneously)
            if (existingPc && existingPc.signalingState === 'have-local-offer') {
                console.warn(`⚠️ Offer glare with user ${fromUser}`);

                // Tiebreaker: lower user ID wins
                if (global.user.id < fromUser) {
                    console.log(`  → We win (${global.user.id} < ${fromUser}), ignoring their offer`);
                    return;
                } else {
                    console.log(`  → They win (${fromUser} < ${global.user.id}), accepting their offer`);
                    existingPc.close();
                    delete this.peerConnections[fromUser];
                }
            } else if (existingPc) {
                console.log(`♻️ Closing existing connection with ${fromUser} (state: ${existingPc.signalingState})`);
                existingPc.close();
                delete this.peerConnections[fromUser];
            }

            // Create peer connection (without sending offer)
            const pc = await this.createPeerConnection(fromUser, false);

            // Set remote description
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

            // Process queued ICE candidates
            await this.processIceCandidateQueue(fromUser);

            // Create and send answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this._sendWebSocketMessage({
                type: "callAnswer",
                call_id: this.currentCall.id,
                target_user: fromUser,
                signal: { sdp: answer }
            });

            console.log(`✅ Answer sent to user ${fromUser} (state: ${pc.signalingState})`);
        } catch (error) {
            console.error(`❌ Error handling offer from ${fromUser}:`, error);
        }
    }

    /**
     * Handle incoming WebRTC answer
     */
    async handleAnswer(fromUser, signal) {
        console.log(`📨 Received answer from user ${fromUser}`);

        const pc = this.peerConnections[fromUser] || this.peerConnections['sfu_server'];

        if (!pc) {
            console.warn(`⚠️ Received answer from ${fromUser} but no peer connection exists`);
            return;
        }

        // Verify we're in the correct state
        if (pc.signalingState !== 'have-local-offer') {
            console.warn(`⚠️ Received answer from ${fromUser} but state is '${pc.signalingState}' (expected 'have-local-offer'). Ignoring.`);
            return;
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

            // Process queued ICE candidates
            await this.processIceCandidateQueue(fromUser);

            console.log(`✅ Answer processed from user ${fromUser}`);
        } catch (error) {
            console.error(`❌ Error processing answer from ${fromUser}:`, error);
        }
    }

    /**
     * Handle incoming ICE candidate
     */
    async handleIceCandidate(fromUser, signal) {
        const pc = this.peerConnections[fromUser] || this.peerConnections['sfu_server'];

        if (!pc) {
            console.warn(`⚠️ ICE candidate from ${fromUser} but no connection exists`);
            return;
        }

        if (!signal.candidate) {
            return;
        }

        try {
            // Only add if remote description is set, otherwise queue
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                console.log(`✅ ICE candidate added for ${fromUser}`);
            } else {
                this.iceCandidateQueues[fromUser] = this.iceCandidateQueues[fromUser] || [];
                this.iceCandidateQueues[fromUser].push(signal.candidate);
                console.log(`📥 ICE candidate queued for ${fromUser} (waiting for remote description)`);
            }
        } catch (error) {
            console.error(`❌ Error adding ICE candidate from ${fromUser}:`, error);
        }
    }

    /**
     * Process queued ICE candidates after remote description is set
     */
    async processIceCandidateQueue(userId) {
        const queue = this.iceCandidateQueues[userId];
        if (!queue || queue.length === 0) {
            return;
        }

        const pc = this.peerConnections[userId];
        if (!pc) {
            return;
        }

        console.log(`📤 Processing ${queue.length} queued ICE candidates for ${userId}`);

        for (const candidate of queue) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error(`❌ Error adding queued ICE candidate:`, error);
            }
        }

        // Clear queue
        this.iceCandidateQueues[userId] = [];
    }

    // ==================== PARTICIPANT MANAGEMENT ====================

    /**
     * Handle when a participant joins the call
     */
    async handleParticipantJoined(callData, newUserId) {
        console.log(`👋 Participant ${newUserId} joined`);

        // Update call data
        this.currentCall = callData;
        setElement('global.state.callManager.currentCall', callData);

        // If we were in 'calling' state and someone joined, transition to 'active'
        if (this.callState === 'calling' && newUserId !== global.user.id) {
            this.callState = 'active';
            setElement('global.state.callManager.callState', 'active');

            // Stop outgoing ringtone
            this.stopOutgoingRingtone();

            // Update available actions
            this.updateAvailableActions();

            // Update participant status from 'calling' to 'connected'
            const participant = this.remoteParticipants.find(p => p.userId === newUserId);
            if (participant) {
                participant.status = 'connected';
            } else {
                // Add new participant if not already in list
                this.remoteParticipants.push({ userId: newUserId, status: 'connected' });
            }
            setElement('global.state.callManager.remoteParticipants', this.remoteParticipants);
        } else if (newUserId !== global.user.id) {
            // Add participant if not already present
            const exists = this.remoteParticipants.find(p => p.userId === newUserId);
            if (!exists) {
                this.remoteParticipants.push({ userId: newUserId, status: 'connected' });
                setElement('global.state.callManager.remoteParticipants', this.remoteParticipants);
            }
        }

        // Handle mode change
        if (this.mode !== callData.mode) {
            console.log(`🔄 Mode changed: ${this.mode} → ${callData.mode}`);
            await this.handleModeSwitch(callData.mode);
        }

        // CRITICAL: Do NOT create peer connection here!
        // The joiner will send us an offer, we wait for it
        if (this.mode === 'p2p' && newUserId && newUserId !== global.user.id) {
            console.log(`✋ Waiting for offer from user ${newUserId} (they are the joiner)`);
        }
    }

    /**
     * Handle when a participant leaves the call
     */
    handleParticipantLeft(callData, leftUserId) {
        console.log(`👋 Participant ${leftUserId} left`);

        // Update call data
        this.currentCall = callData;
        setElement('global.state.callManager.currentCall', callData);

        // Clean up their connection and streams
        this.handlePeerDisconnection(leftUserId);

        // Handle mode change if needed
        if (callData.mode && this.mode !== callData.mode) {
            console.log(`🔄 Mode changed after participant left: ${this.mode} → ${callData.mode}`);
            this.handleModeSwitch(callData.mode);
        }
    }

    /**
     * Handle peer disconnection
     */
    handlePeerDisconnection(userId) {
        console.log(`🔌 Disconnecting from user ${userId}`);

        // Close and remove peer connection
        if (this.peerConnections[userId]) {
            this.peerConnections[userId].close();
            delete this.peerConnections[userId];
        }

        // Remove remote stream and UI element
        if (this.remoteStreams[userId]) {
            this.removeRemoteStreamDisplay(userId);
            delete this.remoteStreams[userId];
        }

        // Clear ICE candidate queue
        if (this.iceCandidateQueues[userId]) {
            delete this.iceCandidateQueues[userId];
        }
    }

    /**
     * Handle mode switch (P2P ↔ SFU)
     */
    async handleModeSwitch(newMode) {
        console.log(`🔄 Switching mode: ${this.mode} → ${newMode}`);

        this.mode = newMode;
        setElement('global.state.callManager.mode', newMode);

        // Close all existing connections
        for (const userId in this.peerConnections) {
            this.peerConnections[userId].close();
        }
        this.peerConnections = {};
        this.iceCandidateQueues = {};

        // Recreate connections in new mode
        if (newMode === 'sfu') {
            await this.createSFUConnection();
        } else if (newMode === 'p2p') {
            // Create connections to all participants
            for (const participantId of this.currentCall.participants) {
                if (participantId !== global.user.id) {
                    await this.createPeerConnection(participantId, true);
                }
            }
        }
    }


    // ==================== UI MANAGEMENT ====================

    /**
     * Display remote user's video stream
     */
    displayRemoteStream(userId, stream) {
        // Wait for template to render the element, then attach stream
        requestAnimationFrame(() => {
            const videoElement = document.getElementById(`remote-video-${userId}`);
            const participantElement = document.getElementById(`participant-${userId}`);

            if (videoElement && stream) {
                videoElement.srcObject = stream;
                videoElement.muted = this.isDeafened;

                // Check if stream has active video tracks
                const hasVideo = stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;

                // Add/remove class based on whether we have video
                if (participantElement) {
                    if (hasVideo) {
                        participantElement.classList.add('has-stream');
                    } else {
                        participantElement.classList.remove('has-stream');
                    }
                }

                console.log(`✅ Attached stream to user ${userId}, hasVideo: ${hasVideo}`);
            }
        });
    }

    /**
     * Remove remote user's video display
     */
    removeRemoteStreamDisplay(userId) {
        console.log(`🗑️ Removing video element for user ${userId}`);

        // Remove from participants array - framework will remove DOM element
        const participant = this.remoteParticipants.find(p => p.userId === userId);
        if (participant) {
            deleteVal('global.state.callManager.remoteParticipants', participant);
        }
    }

    /**
     * Update video display based on whether stream has active video tracks
     * @private
     */
    _updateVideoDisplay(userId, stream) {
        const wrapper = document.getElementById(`remote-wrapper-${userId}`);
        if (!wrapper) return;

        // Check if stream has active video tracks
        const videoTracks = stream.getVideoTracks();
        const hasVideo = videoTracks.length > 0 && videoTracks[0].enabled && !videoTracks[0].muted;

        if (hasVideo) {
            wrapper.classList.add('has-stream');
        } else {
            wrapper.classList.remove('has-stream');
        }

        console.log(`🎥 Video display updated for user ${userId}: hasVideo=${hasVideo}`);
    }

    // ==================== AUDIO/VIDEO CONTROLS ====================

    toggleMute() {
        if (!this.localStream) return;

        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            this.isMuted = !audioTrack.enabled;
            this.updateCallControls();
            console.log(`🎤 Mute: ${this.isMuted}`);
        }
    }

    toggleVideo() {
        if (!this.localStream) return;

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            this.isVideoOff = !videoTrack.enabled;
            this.updateCallControls();
            console.log(`📹 Video off: ${this.isVideoOff}`);
        }
    }

    toggleDeafen() {
        this.isDeafened = !this.isDeafened;

        // Mute/unmute all remote video elements
        for (const userId in this.remoteStreams) {
            const videoElement = document.getElementById(`remote-video-${userId}`);
            if (videoElement) {
                videoElement.muted = this.isDeafened;
            }
        }

        // Mute/unmute remote audio elements
        const audioContainer = document.getElementById('remote-audio-container');
        if (audioContainer) {
            audioContainer.querySelectorAll('audio').forEach(audio => {
                audio.muted = this.isDeafened;
            });
        }

        this.updateCallControls();
        console.log(`🔇 Deafen: ${this.isDeafened}`);
    }

    updateCallControls() {
        setElement('global.state.callManager.isMuted', this.isMuted);
        setElement('global.state.callManager.isVideoOff', this.isVideoOff);
        setElement('global.state.callManager.isDeafened', this.isDeafened);
    }


    cleanup() {
        console.log('🧹 Cleaning up call manager');

        // Stop ringtones
        this.stopOutgoingRingtone();

        // Stop all local media tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log(`⏹️ Stopped ${track.kind} track`);
            });
            this.localStream = null;
        }

        // Close all peer connections
        for (const userId in this.peerConnections) {
            this.peerConnections[userId].close();
            console.log(`🔌 Closed connection to ${userId}`);
        }
        this.peerConnections = {};

        // Clear ICE candidate queues
        this.iceCandidateQueues = {};

        // Remove all remote streams and UI
        for (const userId in this.remoteStreams) {
            this.removeRemoteStreamDisplay(userId);
        }
        this.remoteStreams = {};
        this.remoteParticipants = [];
        this.availableActions = [];

        // Reset state
        this.currentCall = null;
        this.mode = 'p2p';
        this.callType = 'audio';
        this.callState = 'none';
        this.isMuted = false;
        this.isVideoOff = false;
        this.isDeafened = false;

        // Update reactive state
        setElement('global.state.callManager.currentCall', null);
        setElement('global.state.callManager.mode', 'p2p');
        setElement('global.state.callManager.callType', 'audio');
        setElement('global.state.callManager.callState', 'none');
        setElement('global.state.callManager.isMuted', false);
        setElement('global.state.callManager.isVideoOff', false);
        setElement('global.state.callManager.isDeafened', false);
        setElement('global.state.callManager.remoteParticipants', []);
        setElement('global.state.callManager.availableActions', []);

        // Clear local video element
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.srcObject = null;
        }

        console.log('✅ Cleanup complete');
    }

    // ==================== HELPER METHODS ====================

    /**
     * Send WebSocket message to server
     */
    _sendWebSocketMessage(data) {
        if (!global.state.websocket) {
            console.error('❌ WebSocket not available');
            return;
        }

        const message = {
            ...data,
            clientID: global.state.clientID
        };

        global.state.websocket.send(JSON.stringify(message));
    }

    /**
     * Make HTTP request to server
     */
    async _httpRequest(method, url) {
        return new Promise((resolve, reject) => {
            const onload = function() {
                try {
                    resolve(JSON.parse(this.responseText));
                } catch (e) {
                    reject(e);
                }
            };
            xhr(url, onload, method);
        });
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

/**
 * Check if user is currently in a call
 */
window.isInCall = function(callId) {
    const callManager = global.state.callManager;
    return callManager && callManager.currentCall && callManager.currentCall.id === callId;
};

/**
 * Load the call state for a conversation
 */
window.loadCallState = async function(conversationId) {
    try {
        const response = await fetch(`/getCallState?conversation_id=${conversationId}`);
        const callState = await response.json();

        console.log('📞 loadCallState result:', callState);

        // Check if there's an active call (API returns call object with id, or null/empty)
        if (callState && callState.id) {
            setElement(`global.convs[${conversationId}].ongoingCall`, callState);

            // Set callState to 'banner' if we're not in this call
            const callManager = global.state.callManager;
            if (callManager && (!callManager.currentCall || callManager.currentCall.id !== callState.id)) {
                console.log('📢 Setting banner state with participants:', callState.participants);

                callManager.callState = 'banner';
                setElement('global.state.callManager.callState', 'banner');

                // Populate remote participants for banner display
                callManager.remoteParticipants = callState.participants.map(userId => ({
                    userId: userId,
                    status: 'connected'
                }));
                setElement('global.state.callManager.remoteParticipants', callManager.remoteParticipants);

                // Update available actions
                callManager.updateAvailableActions();

                console.log('✅ Banner state set:', {
                    callState: callManager.callState,
                    participants: callManager.remoteParticipants,
                    actions: callManager.availableActions
                });
            }
        } else {
            console.log('📭 No active call in this conversation');
            setElement(`global.convs[${conversationId}].ongoingCall`, null);

            // Reset callManager to 'none' state if not in a call
            const callManager = global.state.callManager;
            if (callManager && !callManager.currentCall) {
                callManager.callState = 'none';
                callManager.remoteParticipants = [];
                callManager.availableActions = [];
                setElement('global.state.callManager.callState', 'none');
                setElement('global.state.callManager.remoteParticipants', []);
                setElement('global.state.callManager.availableActions', []);
            }
        }
    } catch (error) {
        console.error('Failed to load call state:', error);
    }
};

/**
 * Handle call button click - either join existing call or start new one
 */
window.handleCallButtonClick = async function(conversationId, isVideo) {
    const conv = global.convs[conversationId];

    // Check if there's an ongoing call in this conversation
    if (conv?.ongoingCall && conv.ongoingCall.active) {
        // Join the existing call
        await joinExistingCall(conv.ongoingCall.id, isVideo);
    } else {
        // Start a new call
        if (isVideo) {
            await startVideoCall(conversationId);
        } else {
            await startVoiceCall(conversationId);
        }
    }
};

/**
 * Join an existing call from the banner
 */
window.joinExistingCall = async function(callId, hasVideo = false) {
    console.log('Joining existing call', callId, hasVideo);

    const callManager = global.state.callManager;
    if (!callManager) {
        showPermissionError('Reload page.');
        return;
    }

    try {
        await callManager.joinCall(callId, hasVideo);
        // Display is handled automatically by callState = 'active'
    } catch (error) {
        showPermissionError(error.message);
    }
};

window.startVoiceCall = async function(conversationId) {
    const callManager = global.state.callManager;

    try {
        await callManager.startCall(conversationId, false);
        // Display is handled automatically by callState = 'calling'
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
        // Display is handled automatically by callState = 'calling'
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
    } catch (error) {
        showPermissionError(error.message);
    }
};

window.leaveCall = async function() {
    const callManager = global.state.callManager;
    if (callManager) {
        await callManager.leaveCall();
    }
};

export default CallManager;






























