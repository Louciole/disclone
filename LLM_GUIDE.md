# 📘 LLM Developer Guide - Discord Clone Project

## Project Overview

**Project**: Discord Clone (Mycelium)  
**Type**: Real-time communication platform  
**Stack**: Python (Vesta framework) + Vanilla JavaScript  
**Database**: PostgreSQL  
**Features**: Text messaging, voice/video calls, channels, user management

---

## 🏗️ Architecture

### Backend (Python)
- **Framework**: Vesta (custom Python web framework)
- **Server**: `server.py` - Main application server
- **Call Management**: `callManager.py` - Handles WebRTC calls
- **Database**: PostgreSQL with direct SQL queries
- **Authentication**: UniAuth integration + JWT tokens
- **WebSockets**: Built-in support for real-time communication

### Frontend (JavaScript)
- **Framework**: Vesta Frontend (custom reactive framework)
- **Location**: `/static/` directory
- **Templating**: HTML templates in `/static/templates/`
- **Styling**: Single `style.css` file
- **Modules**: ES6 modules (`.mjs` files)

### Testing
- **Location**: `/tests/` directory
- **Command Backend**: `vesta test`
- **Command Frontend**: `npm test` or `node tests/frontend/callManager.test.mjs`
- **Structure**: Each feature has its own test folder (e.g., `/tests/calls/`)

---

## 🧪 Testing Framework

### Frontend Testing (Node.js)

**Simple unit tests with native Node.js - no complex frameworks!**

#### Running Frontend Tests

**Tests Unitaires** (rapides, mocks):
```bash
npm test
# ou
node tests/frontend/callManager.test.mjs
```

**Tests d'Intégration** (vrais serveur + WebSocket):
```bash
# 1. Démarrer le serveur d'abord (WSL)
wsl source venv/bin/activate && python server.py

# 2. Lancer les tests d'intégration
npm run test:integration
```

#### Tests Unitaires (Mocks)

**Test Structure** (`tests/frontend/*.test.mjs`):
```javascript
// Import native assert module
import assert from 'assert';

// Define test function
function test(name, fn) {
    try {
        fn();
        console.log(`✅ PASS: ${name}`);
    } catch (error) {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Error: ${error.message}`);
    }
}

// For async tests
async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`✅ PASS: ${name}`);
    } catch (error) {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Error: ${error.message}`);
    }
}

// Write tests
test('CallManager - Initialization', () => {
    const cm = new CallManager();
    assert.strictEqual(cm.callState, 'none');
});

await asyncTest('CallManager - Get audio stream', async () => {
    const cm = new CallManager();
    const stream = await cm.getLocalStream(false);
    assert.strictEqual(cm.callType, 'audio');
});
```

**Mocking for Node.js**:
```javascript
// Mock browser APIs
Object.defineProperty(globalThis, 'navigator', {
    value: {
        mediaDevices: {
            getUserMedia: async (constraints) => {
                return { getTracks: () => [/* mock tracks */] };
            }
        }
    },
    writable: true,
    configurable: true
});

// Mock RTCPeerConnection
globalThis.RTCPeerConnection = class {
    constructor() { /* mock implementation */ }
    async createOffer() { return { type: 'offer', sdp: 'mock' }; }
    // ... other methods
};
```

**Unit Test Coverage**:
- ✅ 14 unit tests for CallManager
- ✅ Initialization, media streams, peer connections
- ✅ ICE candidate handling, offer/answer flow
- ✅ Offer glare resolution, cleanup
- ⚡ Très rapide (~100ms)
- 🔒 Isolation complète (pas de dépendances externes)

#### Tests d'Intégration (Serveur Réel)

**Integration Test Structure** (`tests/frontend/*.integration.test.mjs`):
```javascript
// XHR fait de VRAIS appels HTTP
const SERVER_URL = 'http://localhost:808';
const WS_URL = 'ws://localhost:9888';

globalThis.xhr = function(url, callback, method = 'GET') {
    fetch(`${SERVER_URL}${url}`, { method, ... })
        .then(response => response.text())
        .then(text => callback.call({ responseText: text }));
};

// Test avec vrai serveur
await asyncTest('API - Start call', async () => {
    return new Promise((resolve, reject) => {
        xhr(`/startCall?conversation_id=${convId}&call_type=audio`, function() {
            const response = JSON.parse(this.responseText);
            assert.ok(response.id, 'Should have call ID');
            resolve();
        }, 'POST');
    });
});

// Test WebSocket réel
import WebSocket from 'ws';
await asyncTest('WebSocket - Connect', async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve) => ws.on('open', resolve));
    assert.notStrictEqual(ws, null, 'WebSocket should be connected');
});
```

**Integration Test Coverage**:
- ✅ 8 tests d'intégration complets
- ✅ Création utilisateur (`/register`)
- ✅ Création conversation (`/createConversation`)
- ✅ Démarrage appel (`/startCall`)
- ✅ État de l'appel (`/getCallState`)
- ✅ Connexion WebSocket (port 9888)
- ✅ Flow CallManager complet avec serveur réel
- 🐢 Plus lent (~2-5s) mais réaliste
- 🔗 Teste l'intégration complète

**Prérequis pour tests d'intégration**:
```bash
# 1. PostgreSQL doit tourner
wsl sudo service postgresql start

# 2. Lancer le serveur
wsl
cd /mnt/c/Users/haber/IdeaProjects/mycelium
source venv/bin/activate
python server.py

# 3. Lancer les tests
npm run test:integration
```

---

### Backend Testing (WSL)

### Windows Development Setup

**IMPORTANT**: On Windows, you **MUST** use WSL (Windows Subsystem for Linux) with the Python virtual environment.

#### Running Tests on Windows
```bash
# 1. Open WSL terminal (Ubuntu recommended)
wsl

# 2. Navigate to project directory
cd /mnt/c/Users/haber/IdeaProjects/mycelium

# 3. Activate virtual environment
source venv/bin/activate

# 4. Run tests
vesta test

# Or run specific Python commands
python tests/calls/call.py
```

#### Running Python on Windows
```bash
# Always use WSL for Python commands
wsl source venv/bin/activate && python script.py

# For syntax checking
wsl source venv/bin/activate && python -m py_compile file.py
```

**Why WSL?**
- The virtual environment is set up for Linux
- Vesta is more stable on Linux
- production servers run Linux

### Test Structure

#### Test Files
```python
# tests/<feature>/<test_name>.py

def run():
    """Main test runner - returns list of (name, result) tuples."""
    results = []
    results.append(("Test Name", test_function()))
    return results

def test_function():
    """Individual test function."""
    try:
        # Test logic
        assert condition, "Error message"
        return ("Success message", True)
    except Exception as e:
        return (str(e), False)
```

#### Test Server Setup
```python
# Test servers run on port 9999
TEST_PORT = 9999
TEST_HOST = '127.0.0.1'
TEST_SERVER_URL = f'http://{TEST_HOST}:{TEST_PORT}'

def start_test_server():
    global server_instance, server_thread
    PATH = dirname(abspath(__file__))
    server_instance = TestServer(path=PATH, configFile="/server.ini", noStart=True)
    server_thread = threading.Thread(target=server_instance.start)
    server_thread.daemon = False
    server_thread.start()

def stop_test_server():
    os.kill(os.getpid(), signal.SIGINT)
    server_thread.join(timeout=3)
```

### Test Conventions

#### Return Format
**CRITICAL**: All test functions **MUST** return a tuple:
```python
return ("Success/Error message", boolean)
# Example:
return ("User created successfully", True)
return ("Failed to create user", False)
```

#### Test Naming
- Prefix: `test_`
- Descriptive: `test_start_call()`, `test_duplicate_join()`
- Snake case: `test_sfu_to_p2p_transition()`

#### Test Organization
```python
# Core functionality tests (basic CRUD)
test_start_call()
test_join_call()
test_leave_call()

# Edge cases
test_empty_call_state()
test_duplicate_join()

# Security
test_unauthorized_access()
test_call_hijacking()

# Performance/Scale
test_concurrent_calls()
test_max_participants()
```

### Running Tests
```bash
# Run all tests
vesta test

# Test output format:
# PASSED: 'Test Name' @folder/file.py
# FAILED: 'Test Name' @folder/file.py
# X/Y tests passed
```

---

## 🎨 Frontend Framework (Vesta)

### Reactive State Management

#### Global State
```javascript
// Access global state
global.state.callManager.callState
global.users[userId]
global.convs[conversationId]

// Set reactive elements
import { setElement } from "./framework/vesta.mjs";
setElement('global.state.callManager.callState', 'banner');
```

#### Subscribe (Reactive Updates)
```javascript
// Template reactivity
${Subscribe('global.state.callManager.callState', () => {
    const callState = global.state.callManager?.callState || 'none';
    
    if (callState === 'none') return '';
    
    return `<div>Call is ${callState}</div>`;
})}
```

### Templating System

#### Template Files
Location: `/static/templates/*.html`

```html
<!-- Example: call-participant.html -->
<div class="call-participant status-${element.status}" 
     id="participant-${element.userId}">
    <!-- Content -->
</div>
```

#### fillWith (List Rendering)
```javascript
// Render list of items with template
${fillWith('template-name', arrayOfObjects)}

// Example:
${fillWith('call-participant', [
    {userId: 1, status: 'active'},
    {userId: 2, status: 'calling'}
])}
```

#### getTemplate (Include Template)
```javascript
// Include another template
${getTemplate('call-controls')}
```

### Template Conventions

#### State-Based Classes
```html
<!-- Use state in class names -->
<div class="call-component call-${callState}">
    <!-- CSS: .call-component.call-banner {...} -->
</div>
```

#### Conditional Rendering
```javascript
${condition ? `
    <div>Shown when true</div>
` : ''}

${callState === 'banner' ? `
    <div class="banner">Banner content</div>
` : callState === 'active' ? `
    <div class="active">Active content</div>
` : ''}
```

#### Element Access
```javascript
// In templates, access element properties
${element.userId}
${element.status}
${global.users[element.userId]?.display}
```

---

## 🔌 API Conventions

### Endpoint Decorators
```python
@Server.expose
def endpointName(self, param1, param2="default"):
    uid = self.getUser()  # Get authenticated user
    # Logic
    return json.dumps(data, default=str)
```

### Authentication
```python
# Get current user ID
uid = self.getUser()

# Check access
access = self.db.getFilters("accessconversation", [
    "conversation", "=", conv_id, 
    "and", 
    "account", "=", uid
])
if not access:
    raise HTTPError(self.response, 403, "Forbidden")
```

### Error Handling
```python
# HTTP errors
raise HTTPError(self.response, 404, "Not Found")
raise HTTPError(self.response, 403, "Forbidden")
raise HTTPError(self.response, 500, "Internal Server Error")
```

### Response Format
```python
# Always use json.dumps with default=str for datetime
return json.dumps({
    'id': call.id,
    'started_at': call.started_at  # datetime object
}, default=str)
```

---

## 🗄️ Database Conventions

### Query Methods
```python
# Get single item by ID
item = self.db.getSomething("table_name", id)

# Get with filter
items = self.db.getFilters("table_name", [
    "column", "=", value,
    "and",
    "other_column", "=", other_value
])

# Insert
new_id = self.db.insertDict('table_name', {
    'column1': value1,
    'column2': value2
}, getId=True)

# Update
self.db.edit('table_name', id, 'column', new_value)

# Delete
self.db.deleteSomething("table_name", id)
```

### Common Tables
- `mycelium_account` - User accounts
- `conversation` - Conversations/channels
- `accessconversation` - User-conversation relationships
- `call_session` - Active calls
- `active_client` - WebSocket connections
- `status` - User online status

---

## 📞 Call System Architecture

### How Discord Calls Work (Reference Implementation)

Discord's call system is a sophisticated real-time communication architecture:

#### 1. **Call Discovery & Joining**
- **Banner Display**: When a call is active in a channel, users see a persistent banner at the top
- **Join Anytime**: Users can join/leave calls freely without ending the call for others
- **Persistent Calls**: Calls continue as long as at least one participant remains
- **Visual Feedback**: Clear indication of who's in the call before joining

#### 2. **Call States & UI**
- **No Call**: Normal chat interface
- **Call Banner**: Green banner showing "X users in call" with Join button
- **Calling State**: Ringing screen showing all invited participants
- **Active Call**: Grid/list view with participant videos/avatars + controls

#### 3. **WebRTC Architecture**
- **P2P Mode (1-3 users)**: Direct peer-to-peer connections for low latency
- **SFU Mode (4+ users)**: Selective Forwarding Unit server relays streams
- **Dynamic Switching**: Seamlessly switches between P2P ↔ SFU as users join/leave
- **ICE Candidates**: STUN/TURN servers handle NAT traversal

#### 4. **Media Management**
- **Permissions**: Request mic/camera only when starting/joining call
- **Audio-First**: Always start with audio; video is optional
- **Fallback**: If video permission denied, fall back to audio-only
- **Mute/Video Toggle**: Per-user control without disconnecting

#### 5. **Signaling Flow**
```
User A starts call → Server creates call session → WebSocket notifies all members
User B clicks Join → Gets local media → Sends offer to existing participants
Existing participants → Receive offer → Send answer → ICE negotiation → Connected
```

#### 6. **Real-time Synchronization**
- **WebSocket Events**: `call_started`, `call_participant_joined`, `call_participant_left`, `call_ended`
- **Offer/Answer/ICE**: Separate signaling for WebRTC negotiation
- **State Reconciliation**: HTTP API for initial state, WebSocket for updates

---

### Our Implementation

#### Call States
```javascript
callState = 'none' | 'banner' | 'calling' | 'active'

// 'none' - No call in current conversation
// 'banner' - Call exists, user not in it (show join button)
// 'calling' - User initiated call, ringing participants
// 'active' - User is in active call with media streaming
```

#### Participant Status
```javascript
participant = {
    userId: number,
    status: 'calling' | 'connected' | 'active'
}

// 'calling' - Ringing, no response yet (shows pulsing ring)
// 'connected' - Joined, ICE negotiating (shows avatar)
// 'active' - Media streaming (shows video or avatar)
```

#### Call Modes
```python
# P2P Mode: 1-3 participants (peer-to-peer mesh)
# SFU Mode: 4+ participants (Selective Forwarding Unit)

SFU_THRESHOLD = 4  # Switch to SFU at 4 participants
```

**Why This Threshold?**
- P2P: Low latency, best for small groups, N*(N-1)/2 connections
- SFU: Scalable, each user sends 1 stream to server, receives N streams
- At 4 users: P2P needs 6 connections vs SFU needs 4 connections

#### WebRTC Connection Strategy

**CRITICAL RULE**: Only the **JOINER** creates peer connections with offers

```javascript
// ✅ CORRECT: Joiner initiates
async joinCall(callId) {
    // Get media, join on server
    const participants = response.participants;
    
    // WE create offers to ALL existing participants
    for (const participantId of participants) {
        await this.createPeerConnection(participantId, true); // createOffer=true
    }
}

// ✅ CORRECT: Existing participant waits
async handleParticipantJoined(callData, newUserId) {
    // Do NOT create connection here
    // Wait for the joiner to send us an offer
    console.log(`Waiting for offer from ${newUserId}`);
}
```

**Why This Matters**: Prevents "offer glare" (both sides sending offers simultaneously)

#### Offer Glare Resolution
```javascript
// If both sides send offers (rare race condition)
if (existingPc && existingPc.signalingState === 'have-local-offer') {
    // Tiebreaker: lower user ID wins
    if (global.user.id < fromUser) {
        // We win, ignore their offer
        return;
    } else {
        // They win, accept their offer
        existingPc.close();
        // Continue processing their offer
    }
}
```

#### ICE Candidate Queueing
```javascript
// ICE candidates MUST be queued until remote description is set
async handleIceCandidate(fromUser, signal) {
    const pc = this.peerConnections[fromUser];
    
    if (pc.remoteDescription && pc.remoteDescription.type) {
        // Remote desc set, add immediately
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } else {
        // Queue for later
        this.iceCandidateQueues[fromUser].push(signal.candidate);
    }
}
```

### Backend API

#### Call Management Endpoints
```python
@Server.expose
def startCall(self, conversation_id, call_type='audio'):
    """Create new call, add initiator as first participant"""
    uid = self.getUser()
    # Validate access, create call_session, return call data
    return json.dumps(call_data, default=str)

@Server.expose
def joinCall(self, call_id):
    """Add user to existing call, handle mode switching"""
    uid = self.getUser()
    # Validate access, add participant, check SFU threshold
    # Return: {call: {...}, mode_changed: boolean}
    return json.dumps(response, default=str)

@Server.expose
def leaveCall(self, call_id):
    """Remove user from call, end call if last participant"""
    uid = self.getUser()
    # Remove participant, check if call should end
    # Return: {ended: boolean, call: {...}}
    return json.dumps(response, default=str)

@Server.expose
def getCallState(self, conversation_id):
    """Get current call state for conversation"""
    uid = self.getUser()
    # Return active call or null
    return json.dumps(call_data, default=str)
```

#### WebSocket Signaling
```python
# Server broadcasts these events to conversation members
"call_started" - New call created
"call_participant_joined" - User joined call
"call_participant_left" - User left call
"call_ended" - Call ended (no participants)
"call_mode_switch" - Mode changed (P2P ↔ SFU)

# WebRTC signaling (peer-to-peer relay)
"callOffer" - WebRTC offer (SDP)
"callAnswer" - WebRTC answer (SDP)
"callIce" - ICE candidate
```

### Frontend Implementation

#### CallManager Class (webrtc.mjs)
```javascript
class CallManager {
    // State
    currentCall: null | CallData
    callState: 'none' | 'banner' | 'calling' | 'active'
    mode: 'p2p' | 'sfu'
    
    // Media
    localStream: MediaStream
    remoteStreams: {[userId]: MediaStream}
    remoteParticipants: [{userId, status}]
    
    // WebRTC
    peerConnections: {[userId]: RTCPeerConnection}
    iceCandidateQueues: {[userId]: [ICECandidate]}
    
    // Methods
    async startCall(conversationId, video)
    async joinCall(callId, video)
    async leaveCall()
    async createPeerConnection(userId, createOffer)
    async handleOffer(fromUser, signal)
    async handleAnswer(fromUser, signal)
    async handleIceCandidate(fromUser, signal)
    handleParticipantJoined(callData, userId)
    handleParticipantLeft(callData, userId)
    handleModeSwitch(newMode)
}
```

#### Reactive UI Updates
```javascript
// All state changes trigger reactive template updates
setElement('global.state.callManager.callState', 'banner');
setElement('global.state.callManager.remoteParticipants', participants);
setElement('global.state.callManager.availableActions', actions);

// Templates automatically re-render via Subscribe()
${Subscribe('global.state.callManager.callState', () => {
    // Render based on current state
})}
```

#### Available Actions System
```javascript
// Dynamic actions based on callState
updateAvailableActions() {
    switch (this.callState) {
        case 'banner':
            this.availableActions = [
                {type: 'info', icon: 'call', label: 'Appel en cours'},
                {type: 'join', callId: call.id, isVideo: false}
            ];
            break;
        case 'active':
        case 'calling':
            this.availableActions = [{type: 'controls'}];
            break;
    }
}
```

### Templates

#### Unified Call Component
```html
<!-- call-component.html - Single component for all call states -->
<div class="call-component call-${callState}">
    <div class="call-content">
        <!-- Participant grid (always shown) -->
        <div class="remote-videos-grid">
            ${fillWith('call-participant', remoteParticipants)}
        </div>
        
        <!-- Local video (shown in 'calling' or 'active') -->
        <video id="local-video" autoplay muted></video>
    </div>
    
    <!-- Dynamic actions (join button OR controls) -->
    <div class="call-actions">
        ${fillWith('call-action', availableActions)}
    </div>
</div>
```

#### Participant Template
```html
<!-- call-participant.html - Adaptive participant display -->
<div class="call-participant status-${element.status}">
    <!-- Avatar (always visible as fallback) -->
    <div class="participant-avatar">
        <img src="${global.users[element.userId].pfp}">
    </div>
    
    <!-- Status ring (for 'calling' state) -->
    <div class="participant-status-ring"></div>
    
    <!-- Video (shown when status='active' and has stream) -->
    <video id="remote-video-${element.userId}" autoplay></video>
    
    <!-- Name label -->
    <div class="participant-name-label">${user.display}</div>
</div>
```

### CSS State Management

```css
/* Base component hidden when callState='none' */
.call-component { display: none; }
.call-component.call-banner,
.call-component.call-calling,
.call-component.call-active { display: flex; }

/* Participant status states */
.call-participant.status-calling .participant-status-ring {
    animation: pulse 1.5s infinite; /* Pulsing ring */
}

.call-participant.status-connected video {
    display: none; /* Hide video until 'active' */
}

.call-participant.status-active video {
    display: block; /* Show video when streaming */
}
```

---

## 🎯 Development Patterns

### Adding a New Feature

#### 1. Backend Endpoint
```python
@Server.expose
def featureName(self, param):
    uid = self.getUser()
    # Validate access
    # Implement logic
    # Return JSON
    return json.dumps(result, default=str)
```

#### 2. Frontend Module
```javascript
// static/feature.mjs
export function doSomething() {
    // Make API call
    const response = await fetch('/featureName', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${token}`}
    });
    
    // Update state
    setElement('global.state.feature', data);
}
```

#### 3. Template
```html
<!-- static/templates/feature.html -->
${Subscribe('global.state.feature', () => {
    const data = global.state.feature;
    return `<div>${data}</div>`;
})}
```

#### 4. Tests
```python
# tests/feature/feature.py
def test_feature():
    try:
        # Setup
        # Execute
        # Assert
        return ("Feature works", True)
    except Exception as e:
        return (str(e), False)
```

### Code Style

#### Python
- PEP 8 style
- Type hints not required
- Docstrings for complex functions
- camelCase for methods (Vesta convention)

#### JavaScript
- ES6+ features
- camelCase for functions
- Arrow functions preferred
- No semicolons (project convention)

#### CSS
- BEM-like naming: `.component-element--modifier`
- State classes: `.component.state-active`
- CSS custom properties for theming

---

## 🚨 Common Pitfalls

### Testing
```python
# ❌ WRONG - Returning dictionary
def test_something():
    return {'name': 'test', 'passed': True}

# ✅ CORRECT - Returning tuple
def test_something():
    return ("Test passed", True)
```

### Frontend State
```javascript
// ❌ WRONG - Direct mutation
global.state.callManager.callState = 'active'

// ✅ CORRECT - Using setElement
setElement('global.state.callManager.callState', 'active')
```

### Templates
```javascript
// ❌ WRONG - Variable scope issues
${Subscribe('path', () => {
    const manager = global.state.callManager;
    return Subscribe('nested', () => fillWith('tpl', manager.list))
})}

// ✅ CORRECT - Direct access in nested Subscribe
${Subscribe('path', () => {
    return Subscribe('nested', () => 
        fillWith('tpl', global.state.callManager?.list || [])
    )
})}
```

### Database
```python
# ❌ WRONG - No error handling
item = self.db.getSomething("table", id)
item['field']  # May crash if None

# ✅ CORRECT - Check existence
item = self.db.getSomething("table", id)
if not item:
    raise HTTPError(self.response, 404, "Not Found")
```

---

## 📚 Key Files Reference

### Backend
- `server.py` - Main server, all endpoints
- `callManager.py` - Call management logic
- `db/schema.sql` - Database schema

### Frontend
- `static/main.mjs` - Application entry point
- `static/webrtc.mjs` - Call/WebRTC logic
- `static/navigation.mjs` - Navigation logic
- `static/framework/vesta.mjs` - Core framework
- `static/framework/templating.mjs` - Template engine

### Templates
- `static/templates/conversation.html` - Chat view
- `static/templates/call-component.html` - Unified call UI
- `static/templates/call-participant.html` - Participant display
- `static/templates/call-action.html` - Dynamic actions
- `static/templates/call-controls.html` - Call controls

### Tests
- `tests/calls/call.py` - Call system tests (28 tests)
- `tests/markdown/` - Markdown parser tests

### Documentation
- `LLM_DEVELOPER_GUIDE.md` - This guide
- `tests/calls/CALL_TYPE_DYNAMIC_BEHAVIOR.md` - Call type behavior spec
- `tests/calls/ADDITIONAL_TEST_IDEAS.md` - Future test scenarios

---

## 🎓 Learning Resources

### Understanding the Codebase
1. Read `server.py` endpoints to understand API
2. Read `static/main.mjs` to understand frontend initialization
3. Read test files to understand expected behavior
4. Check templates to understand UI structure

### Testing Best Practices
1. **Isolation**: Each test should be independent
2. **Setup/Teardown**: Start/stop test server properly
3. **Assertions**: Use descriptive assertion messages
4. **Coverage**: Test happy path + edge cases + errors
5. **Naming**: Descriptive names explain what's tested

### Common Tasks

#### Adding a Test
```python
def test_new_feature():
    """Test description."""
    try:
        # 1. Setup
        token = create_test_user("testuser")
        
        # 2. Execute
        response = requests.post(
            f'{TEST_SERVER_URL}/endpoint',
            params={'param': value},
            headers={'Authorization': f'Bearer {token}'}
        )
        
        # 3. Assert
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert 'field' in data, "Response should contain field"
        
        return ("Test passed", True)
        
    except Exception as e:
        return (str(e), False)
```

#### Debugging Tests
```python
# Add debug output
print(f"Response: {response.status_code}")
print(f"Data: {response.json()}")

# Check server logs
# Tests output server logs during execution
```

#### Updating Templates
```html
<!-- 1. Keep state-based classes -->
<div class="component component-${state}">

<!-- 2. Use Subscribe for reactive data -->
${Subscribe('global.path.to.data', () => {
    const data = global.path.to.data;
    return `...`;
})}

<!-- 3. Use fillWith for lists -->
${fillWith('item-template', arrayOfItems)}
```

---

## 🔍 Debugging Tips

### Backend
```python
# Print to console
print("Debug:", variable)

# Check database state
item = self.db.getSomething("table", id)
print("DB item:", item)

# Log WebSocket messages
print("WS message received:", message)
```

### Frontend
```javascript
// Console logs (visible in browser)
console.log('State:', global.state.callManager)

// Check reactive updates
Subscribe('path', () => {
    console.log('Updated:', global.path)
    return `...`
})
```

### Tests
```python
# Run specific test folder
vesta test  # Runs all tests

# Check test output
# All output visible in terminal during test run
```

---

## ✅ Checklist for New Features

### Backend
- [ ] Create endpoint with `@Server.expose`
- [ ] Add authentication check (`self.getUser()`)
- [ ] Add authorization check (database access)
- [ ] Return JSON with `default=str`
- [ ] Handle errors with `HTTPError`

### Frontend
- [ ] Create/update module in `/static/`
- [ ] Use `setElement` for state updates
- [ ] Create template in `/static/templates/`
- [ ] Use `Subscribe` for reactivity
- [ ] Update CSS in `style.css`

### Testing
- [ ] Create test file in `/tests/feature/`
- [ ] Implement `run()` function
- [ ] Return tuples `(message, boolean)`
- [ ] Test happy path
- [ ] Test edge cases
- [ ] Test error handling
- [ ] Run `vesta test` to verify

---

## 📖 Quick Reference

### Test Return Format
```python
return ("Message describing result", True)   # Pass
return ("Error description", False)          # Fail
```

### State Update
```javascript
setElement('global.path.to.property', value)
```

### Template Rendering
```javascript
${Subscribe('path', () => `HTML`)}
${fillWith('template', array)}
${getTemplate('template-name')}
```

### Database Query
```python
item = self.db.getSomething("table", id)
items = self.db.getFilters("table", ["col", "=", val])
id = self.db.insertDict('table', {}, getId=True)
```

### API Call
```python
@Server.expose
def endpoint(self, param):
    uid = self.getUser()
    return json.dumps(data, default=str)
```

---

## 🎯 Summary

**For Testing**: Always return `(message, boolean)` tuples  
**For Frontend**: Use `setElement` and `Subscribe`  
**For Backend**: Validate auth/access, return JSON  
**For Templates**: Use `fillWith` for lists, state-based classes  

**Key Command**: `vesta test` - Run all tests  
**Project Convention**: Reactive state-based architecture  
**Testing Philosophy**: Comprehensive coverage including edge cases  

---

**Last Updated**: 2026-01-19  
**Test Coverage**: 28 call tests (including dynamic call type) + more in other modules  
**Status**: Production-ready with comprehensive testing
