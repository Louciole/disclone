"""
Call Manager - Gestion hybride des appels P2P/SFU
Gère automatiquement le passage de P2P (<4 participants) à SFU (≥4 participants)
"""
import json
import asyncio
from datetime import datetime


class CallManager:

    # P2P -> SFU switch threshold (number of participants)
    SFU_THRESHOLD = 4

    def __init__(self, db):
        self.db = db
        self.active_calls = {}
        self.conversation_calls = {}

    def get_call_by_conversation(self, conv_id):
        # Try memory first (fast path)
        call_id = self.conversation_calls.get(conv_id)
        if call_id and call_id in self.active_calls:
            return self.active_calls[call_id]

        # Fallback: Load from DB (handles multi-worker scenario)
        call_session = self.db.getFilters("call_session", [
            "conversation_id", "=", conv_id,
            "and", "active", "=", True
        ])

        if call_session and len(call_session) > 0:
            session_data = call_session[0]
            call_id = session_data['id']

            # Reconstruct CallSession object from DB
            # Note: participants is jsonb in PostgreSQL, already deserialized to list
            participants = session_data['participants']
            if isinstance(participants, str):
                participants = json.loads(participants)

            call = CallSession(
                call_id,
                session_data['conversation_id'],
                participants,
                session_data['call_type'],
                session_data['mode']
            )

            # Cache in memory for subsequent requests
            self.active_calls[call_id] = call
            self.conversation_calls[conv_id] = call_id

            return call

        return None

    def create_call(self, conv_id, initiator_id, call_type='audio'):
        existing_call = self.get_call_by_conversation(conv_id)
        if existing_call:
            return existing_call

        participants = json.dumps([initiator_id])
        call_id = self.db.insertDict('call_session', {
            'conversation_id': conv_id,
            'participants': participants,
            'call_type': call_type,
            'mode': 'p2p',
            'active': True
        }, getId=True)

        call = CallSession(call_id, conv_id, [initiator_id], call_type)
        self.active_calls[call_id] = call
        self.conversation_calls[conv_id] = call_id

        return call

    def join_call(self, call_id, user_id):
        call = self.active_calls.get(call_id)

        # If not in memory, try to load from DB
        if not call:
            call_session = self.db.getSomething("call_session", call_id)
            if call_session and call_session.get('active'):
                # participants is jsonb in PostgreSQL, already deserialized to list
                participants = call_session['participants']
                if isinstance(participants, str):
                    participants = json.loads(participants)

                call = CallSession(
                    call_id,
                    call_session['conversation_id'],
                    participants,
                    call_session['call_type'],
                    call_session['mode']
                )
                # Cache in memory
                self.active_calls[call_id] = call
                self.conversation_calls[call_session['conversation_id']] = call_id
            else:
                return None

        if user_id not in call.participants:
            call.participants.append(user_id)

            old_mode = call.mode
            if len(call.participants) >= self.SFU_THRESHOLD:
                call.mode = 'sfu'

            participants_json = json.dumps(call.participants)
            self.db.edit('call_session', call_id, 'participants', participants_json)
            self.db.edit('call_session', call_id, 'mode', call.mode)

            result = {
                'call': call,
                'mode_changed': old_mode != call.mode,
                'old_mode': old_mode,
                'new_mode': call.mode
            }
            return result

        return {'call': call, 'mode_changed': False}

    def leave_call(self, call_id, user_id):
        call = self.active_calls.get(call_id)

        # If not in memory, try to load from DB
        if not call:
            call_session = self.db.getSomething("call_session", call_id)
            if call_session and call_session.get('active'):
                # participants is jsonb in PostgreSQL, already deserialized to list
                participants = call_session['participants']
                if isinstance(participants, str):
                    participants = json.loads(participants)

                call = CallSession(
                    call_id,
                    call_session['conversation_id'],
                    participants,
                    call_session['call_type'],
                    call_session['mode']
                )
                # Cache in memory
                self.active_calls[call_id] = call
                self.conversation_calls[call_session['conversation_id']] = call_id
            else:
                return None

        if user_id in call.participants:
            call.participants.remove(user_id)

            old_mode = call.mode

            if len(call.participants) == 0:
                return self.end_call(call_id)

            if len(call.participants) < self.SFU_THRESHOLD:
                call.mode = 'p2p'

            participants_json = json.dumps(call.participants)
            self.db.edit('call_session', call_id, 'participants', participants_json)
            self.db.edit('call_session', call_id, 'mode', call.mode)

            return {
                'call': call,
                'mode_changed': old_mode != call.mode,
                'old_mode': old_mode,
                'new_mode': call.mode,
                'ended': False
            }

        return {'call': call, 'mode_changed': False, 'ended': False}

    def end_call(self, call_id):
        call = self.active_calls.get(call_id)
        if not call:
            return None

        self.db.edit('call_session', call_id, 'active', False)
        self.db.edit('call_session', call_id, 'ended_at', datetime.now())

        conv_id = call.conversation_id
        del self.active_calls[call_id]
        if conv_id in self.conversation_calls:
            del self.conversation_calls[conv_id]

        return {'call': call, 'ended': True}

    def get_call_state(self, conv_id):
        call = self.get_call_by_conversation(conv_id)
        if call:
            return call.to_dict()
        return None

    async def forward_stream_sfu(self, call_id, from_user, stream_data):
        call = self.active_calls.get(call_id)
        if not call or call.mode != 'sfu':
            return None

        recipients = [p for p in call.participants if p != from_user]

        return {
            'recipients': recipients,
            'stream_data': stream_data
        }


class CallSession:
    def __init__(self, call_id, conversation_id, participants, call_type='audio', mode=None):
        self.id = call_id
        self.conversation_id = conversation_id
        self.participants = participants  # Liste d'IDs utilisateurs
        self.call_type = call_type  # 'audio' ou 'video'
        # Use provided mode or calculate based on participants
        self.mode = mode if mode is not None else ('p2p' if len(participants) < CallManager.SFU_THRESHOLD else 'sfu')
        self.started_at = datetime.now()

        self.streams = {}  # {user_id: stream_info}

    def to_dict(self):
        return {
            'id': self.id,
            'conversation_id': self.conversation_id,
            'participants': self.participants,
            'participant_count': len(self.participants),
            'call_type': self.call_type,
            'mode': self.mode,
            'started_at': self.started_at.isoformat()
        }

