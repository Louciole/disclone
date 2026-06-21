"""WebSocket message handlers.

One async function per ``data["type"]`` handled by the live WS connection. Each
takes the live Mycelium instance as ``self`` plus the raw ``websocket`` and the
decoded ``data`` dict. ``server.py``'s ``_handle_messages`` loop dispatches to
these via the ``HANDLERS`` table at the bottom of this module.

These were extracted verbatim from the original ``_handle_messages`` switch; the
only change is that top-level ``continue`` (skip this message) became ``return``.
"""
import json


async def register(self, websocket, data):
    self.waiting_clients[self.currentWaiting] = {"connection": websocket, "uid": data["uid"]}
    self.currentWaiting += 1
    answer = {"type": "register_request", "servId": self.id, "connectionId": self.currentWaiting - 1}
    await websocket.send(json.dumps(answer))


async def unregister(self, websocket, data):
    print("unregister received")
    if self.checkWSAuth(websocket, data["clientID"]):
        client = self.db.getSomething("active_client", data["clientID"])
        self.db.deleteSomething("active_client", data["clientID"])
        self.db.deleteSomething("subscription", data["clientID"], selector="client")
        self.pool.pop(data["clientID"])
        await self.sendStatusUpdatesAsync(client["userid"])
    else:
        self.waiting_clients.pop(data["clientID"])


async def typing(self, websocket, data):
    if not self.checkWSAuth(websocket, data.get("clientID")):
        return
    sender = self.db.getSomething("active_client", data["clientID"])
    sender_uid = sender["userid"]
    channel = self.db.getSomething("textual_channel", data["conv"])
    if channel:
        # Sender must be able to view the channel.
        if not self.checkChannelAccess(sender_uid, data["conv"], "textual", "view"):
            return
        members = self.db.getFilters("accessserver", ["server", "=", channel["server"]])
    else:
        # Sender must be a member of the conversation.
        if not self.db.getFilters("accessconversation", ["conversation", "=", data["conv"], "and", "account", "=", sender_uid]):
            return
        members = self.db.getAll("accessconversation", data["conv"], "conversation")

    payload = {"type": "typing", "conv": data["conv"], "uid": sender_uid}
    for user in members:
        if user["account"] != sender_uid:
            if channel and channel.get("is_private") and not self.checkChannelAccess(user["account"], data["conv"], "textual", "view"):
                continue
            await self.sendNotificationAsync(user["account"], payload)


async def change_activity(self, websocket, data):
    if self.checkWSAuth(websocket, data["clientID"]):
        self.db.edit("active_client", data["clientID"], "idle", data["idle"])
        client = self.db.getSomething("active_client", data["clientID"])
        await self.sendStatusUpdatesAsync(client["userid"])


async def call_start(self, websocket, data):
    if self.checkWSAuth(websocket, data["clientID"]):
        client = self.db.getSomething("active_client", data["clientID"])
        conv_id = data.get("conversation_id")
        call_type = data.get("call_type", "audio")

        access = self.db.getFilters("accessconversation",
            ["conversation", "=", conv_id, "and", "account", "=", client["userid"]])

        if access:
            call = self.callManager.create_call(conv_id, client["userid"], call_type)

            members = self.db.getAll("accessconversation", conv_id, "conversation")

            print(f"🔔 [call_started] Conv {conv_id}: {len(members)} members, initiated by user {client['userid']}")

            for member in members:
                member_id = member["account"]
                if member_id == client["userid"]:
                    continue

                print(f"Sending call_started to user {member_id}")

                try:
                    await self.sendNotificationAsync(member_id, {
                        "type": "call_started",
                        "content": call.to_dict()
                    })

                    # Send Push Notification for Incoming Call
                    self.sendPushNotification(member_id, {
                        "title": "Incoming Call",
                        "body": "Incoming call...",
                        "data": {
                            "type": "call",
                            "callId": str(call.id),
                            "convId": str(conv_id)
                        }
                    })

                    print(f"Sent call_started to user {member_id}")
                except Exception as e:
                    print(f"Error sending to user {member_id}: {e}")


async def call_join(self, websocket, data):
    # Rejoindre un appel existant
    if self.checkWSAuth(websocket, data["clientID"]):
        client = self.db.getSomething("active_client", data["clientID"])
        call_id = data.get("call_id")

        result = self.callManager.join_call(call_id, client["userid"])

        if result:
            call = result['call']
            # Notifier tous les participants
            for participant_id in call.participants:
                await self.sendNotificationAsync(participant_id, {
                    "type": "call_participant_joined",
                    "content": {
                        "call": call.to_dict(),
                        "user_id": client["userid"],
                        "mode_changed": result['mode_changed']
                    }
                })

            # Si changement de mode, notifier le switch P2P->SFU
            if result['mode_changed']:
                for participant_id in call.participants:
                    await self.sendNotificationAsync(participant_id, {
                        "type": "call_mode_switch",
                        "content": {
                            "call_id": call_id,
                            "old_mode": result['old_mode'],
                            "new_mode": result['new_mode']
                        }
                    })


async def call_leave(self, websocket, data):
    # Quitter un appel
    if self.checkWSAuth(websocket, data["clientID"]):
        client = self.db.getSomething("active_client", data["clientID"])
        call_id = data.get("call_id")

        result = self.callManager.leave_call(call_id, client["userid"])

        if result:
            if result['ended']:
                # L'appel est terminé, notifier tous
                call = result['call']
                members = self.db.getAll("accessconversation", call.conversation_id, "conversation")
                for member in members:
                    await self.sendNotificationAsync(member["account"], {
                        "type": "call_ended",
                        "content": {
                            "call_id": call_id,
                            "conversation_id": call.conversation_id
                        }
                    })
            else:
                call = result['call']
                # Notifier les participants restants
                for participant_id in call.participants:
                    await self.sendNotificationAsync(participant_id, {
                        "type": "call_participant_left",
                        "content": {
                            "call": call.to_dict(),
                            "user_id": client["userid"],
                            "mode_changed": result['mode_changed']
                        }
                    })

                # Si changement de mode SFU->P2P
                if result['mode_changed']:
                    for participant_id in call.participants:
                        await self.sendNotificationAsync(participant_id, {
                            "type": "call_mode_switch",
                            "content": {
                                "call_id": call_id,
                                "old_mode": result['old_mode'],
                                "new_mode": result['new_mode']
                            }
                        })


async def call_signal(self, websocket, data):
    # Signaling WebRTC - routage selon le mode (callOffer | callAnswer | callIce)
    if self.checkWSAuth(websocket, data["clientID"]):
        client = self.db.getSomething("active_client", data["clientID"])
        call_id = data.get("call_id")
        target_user = data.get("target_user")

        call = self.callManager.active_calls.get(call_id)

        # Only a participant of the call may relay signaling.
        if call and client["userid"] in call.participants:
            if call.mode == 'p2p':
                # Mode P2P: relay direct vers le destinataire (participant only)
                if target_user and target_user in call.participants:
                    await self.sendNotificationAsync(target_user, {
                        "type": data["type"],
                        "content": {
                            "call_id": call_id,
                            "from_user": client["userid"],
                            "signal": data.get("signal")
                        }
                    })
            else:
                # Mode SFU: broadcaster à tous les autres participants
                for participant_id in call.participants:
                    if participant_id != client["userid"]:
                        await self.sendNotificationAsync(participant_id, {
                            "type": data["type"],
                            "content": {
                                "call_id": call_id,
                                "from_user": client["userid"],
                                "signal": data.get("signal")
                            }
                        })


async def call_hangup(self, websocket, data):
    # Raccrocher (alias de callLeave)
    if self.checkWSAuth(websocket, data["clientID"]):
        client = self.db.getSomething("active_client", data["clientID"])
        call_id = data.get("call_id")

        result = self.callManager.leave_call(call_id, client["userid"])

        if result and result.get('call'):
            call = result['call']
            # Notifier le départ
            for participant_id in call.participants:
                await self.sendNotificationAsync(participant_id, {
                    "type": "call_participant_left",
                    "content": {
                        "call": call.to_dict(),
                        "user_id": client["userid"]
                    }
                })


async def call_join_legacy(self, websocket, data):
    # Ancien système - conservé pour compatibilité
    room = self.calls.get(data["room"])
    if room:
        self.calls["room"] = set()


# Maps an incoming ``data["type"]`` to its handler. Several signaling types share
# one handler. Unknown types fall through to the default branch in the dispatch loop.
HANDLERS = {
    "register": register,
    "unregister": unregister,
    "typing": typing,
    "changeActivity": change_activity,
    "callStart": call_start,
    "callJoin": call_join,
    "callLeave": call_leave,
    "callOffer": call_signal,
    "callAnswer": call_signal,
    "callIce": call_signal,
    "callHangup": call_hangup,
    "callJoin_legacy": call_join_legacy,
}
