import fastpysgi
from vesta import Server, HTTPError, HTTPRedirect
import json
import re
import os
import string
import random
import datetime
import requests

# Firebase imports for FCM push notifications
import firebase_admin
from firebase_admin import credentials, messaging

# websockets imports
import websockets

from os.path import abspath, dirname
from callManager import CallManager
from driveManager import DriveManager

B62 = string.digits + string.ascii_letters
PATH = dirname(abspath(__file__))

# Storage quota constants (in bytes)
USER_STORAGE_QUOTA = 15 * 1024 * 1024 * 1024  # 15 GB
SERVER_STORAGE_QUOTA = 5 * 1024 * 1024 * 1024  # 5 GB
fastpysgi.server.max_content_length = 100 * 1024 * 1024  # 100 MB


class Mycelium(Server):
    features = {"websockets": True, "errors": {404: "/static/404.html"}}
    clients = []
    _admin_cache = None  # Cache for admin user IDs
    _admin_cache_time = None  # Last cache update time

    def __init__(self, *args, **kwargs):
        super().__init__(path=PATH, configFile="/server.ini", noStart=True)
        self.callManager = CallManager(self.db)
        self.drive = DriveManager(self)
        self._refreshAdminCache()  # Initialize admin cache

        if not self.config.getboolean("server", "DEBUG"):
            cred_path = os.path.join(PATH, "serviceAccountKey.json")
            if os.path.exists(cred_path):
                try:
                    cred = credentials.Certificate(cred_path)
                    firebase_admin.initialize_app(cred)
                    print("Firebase Admin SDK initialized successfully")
                except Exception as e:
                    print(f"Failed to initialize Firebase Admin SDK: {e}")
            else:
                print(f"Warning: {cred_path} not found. Push notifications will not work.")
        else:
            print("Running in DEBUG mode: Firebase Admin SDK initialization skipped.")

        self.start()

    def sendPushNotification(self, uid, data):
        """
        Send a generic push notification to a user's registered devices.
        uid: target user ID
        data: dict with 'title', 'body', and optional 'data' dict
        """
        # Do not send notifications in DEBUG mode
        if self.config.getboolean("server", "DEBUG"):
            return

        # Get user's tokens
        tokens_records = self.db.getFilters("device_token", ["account", "=", uid])
        if not tokens_records:
            return

        tokens = [t["token"] for t in tokens_records]

        try:
            # Construct MulticastMessage
            message = messaging.MulticastMessage(
                notification=messaging.Notification(
                    title=data.get("title", "Mycelium"),
                    body=data.get("body", "New activity"),
                ),
                data={k: str(v) for k, v in data.get("data", {}).items()},
                tokens=tokens,
            )

            response = messaging.send_multicast(message)

            if response.failure_count > 0:
                print(f"Failed to send {response.failure_count} push notifications")
                for idx, resp in enumerate(response.responses):
                    if not resp.success:
                        # Check error code and delete if 'registration-token-not-registered'
                        err_code = resp.exception.code
                        if err_code == 'messaging/registration-token-not-registered':
                             self.db.execute("DELETE FROM device_token WHERE token = %s", (tokens[idx],))
        except Exception as e:
            print(f"Error sending push notifications: {e}")

    @Server.expose
    def index(self):
        return self.file(PATH + "/static/home/home.html")

    @Server.expose
    def privacy(self):
        return self.file(PATH + "/static/home/privacy.html")


    @Server.expose
    def channels(self, uid="me"):
        self.checkJwt()
        self.response.headers.append(('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=()'))
        return self.file(PATH + "/static/main.html")

    @Server.expose
    def default(self, target, **kwargs):
        target = target.strip('/')
        res = self.db.getSomething("invitation",target,"link")
        if res and res != []:
            if res["expiration"] < datetime.datetime.now():
                return self.file(PATH + "/static/expired_invitation.html")
            else:
                return self.file(PATH + "/static/invitation.html")
        else:
            raise HTTPError(self.response,404,"Not Found")

    def onLogin(self, uid):
        if not self.db.getSomething("mycelium_account", uid):
            self.db.insertDict("mycelium_account", {"id": uid, "username": '#' + str(uid)})
        if not self.db.getSomething("status", uid):
            self.db.insertDict("status", {"id": uid})

    def getUserConnection(self, id):
        return self.db.getSomething("active_client", id, "userid")

    def newConv(self, name, members, private=True):
        account_id = self.getUser()
        conv_id = self.db.insertDict('conversation', {'name': name, 'private':private}, getId=True)
        self.db.insertDict('accessconversation', {'account': account_id, 'conversation': conv_id})
        for i in range(0, len(members)):  # this could be batched !
            self.db.insertDict('accessconversation', {'account': members[i], 'conversation': conv_id})
        return conv_id

    def clean(self):
        for client, ws in self.pool.items():
            self.db.deleteSomething("active_client",client)
            self.db.deleteSomething("subscription",client,selector="client")

    # --------------------------------WEBSOCKETS--------------------------------

    async def handle_message(self, websocket):
        self.clients.append(websocket)
        self.calls = {}

        async for message in websocket:
            data = json.loads(message)
            print("WS message received :",message)
            match data["type"]:
                case "register":
                    self.waiting_clients[self.currentWaiting] = {"connection": websocket, "uid": data["uid"]}
                    self.currentWaiting += 1
                    answer = {"type": "register_request", "servId": self.id, "connectionId": self.currentWaiting - 1}
                    await websocket.send(json.dumps(answer))
                case "unregister":
                    print("unregister received")
                    if self.checkWSAuth(websocket,data["clientID"]):
                        client = self.db.getSomething("active_client", data["clientID"])
                        self.db.deleteSomething("active_client",data["clientID"])
                        self.db.deleteSomething("subscription",data["clientID"],selector="client")
                        self.pool.pop(data["clientID"])
                        await self.sendStatusUpdatesAsync(client["userid"])
                    else:
                        self.waiting_clients.pop(data["clientID"])
                case "typing":
                    channel = self.db.getSomething("textual_channel", data["conv"])
                    if channel:
                        members = self.db.getFilters("accessserver", ["server", "=", channel["server"]])
                    else:
                        members = self.db.getAll("accessconversation", data["conv"], "conversation")

                    for user in members:
                        if user["account"] != data["uid"]:
                            if channel and channel.get("is_private") and not self.checkChannelAccess(user["account"], data["conv"], "textual", "view"):
                                continue
                            await self.sendNotificationAsync(user["account"], data)

                case "changeActivity":
                    if self.checkWSAuth(websocket,data["clientID"]):
                        self.db.edit("active_client", data["clientID"], "idle", data["idle"])
                        client = self.db.getSomething("active_client", data["clientID"])
                        await self.sendStatusUpdatesAsync(client["userid"])

                case "callStart":
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
                                            "call_id": call.id,
                                            "conv_id": str(conv_id)
                                        }
                                    })

                                    print(f"Sent call_started to user {member_id}")
                                except Exception as e:
                                    print(f"Error sending to user {member_id}: {e}")

                case "callJoin":
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

                case "callLeave":
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

                case "callOffer" | "callAnswer" | "callIce":
                    # Signaling WebRTC - routage selon le mode
                    if self.checkWSAuth(websocket, data["clientID"]):
                        client = self.db.getSomething("active_client", data["clientID"])
                        call_id = data.get("call_id")
                        target_user = data.get("target_user")

                        call = self.callManager.active_calls.get(call_id)

                        if call:
                            if call.mode == 'p2p':
                                # Mode P2P: relay direct vers le destinataire
                                if target_user:
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

                case "callHangup":
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

                case "callJoin_legacy":
                    # Ancien système - conservé pour compatibilité
                    room = self.calls.get(data["room"])
                    if room:
                        self.calls["room"] = set()


                case _:
                    print("unknown message received", message)

    # -----------------------------------API-------------------------------------

    @Server.expose
    def register_device(self):
        """
        Register a mobile device push token.
        Called by the Capacitor app when it receives a FCM / APNs token.

        POST body (JSON): { "token": "...", "platform": "ios" | "android" }
        """
        uid = self.getUser()
        body = json.loads(self.request.body.decode('utf-8'))
        token = body.get('token', '').strip()
        platform = body.get('platform', 'android').strip()[:10]

        if not token:
            raise HTTPError(self.response, 400, "Missing token")

        # Upsert: update timestamp if token already exists for this account
        existing = self.db.getFilters("device_token", [
            "account", "=", uid, "AND", "token", "=", token
        ])
        if existing:
            self.db.execute(
                "UPDATE device_token SET updated_at = NOW(), platform = %s WHERE account = %s AND token = %s",
                (platform, uid, token)
            )
        else:
            self.db.insertDict("device_token", {
                "account": uid,
                "token": token,
                "platform": platform,
            })

        return json.dumps({"status": "ok"})

    @Server.expose
    def unregister_device(self):
        """
        Remove a device token when the user logs out.
        POST body (JSON): { "token": "..." }
        """
        uid = self.getUser()
        body = json.loads(self.request.body.decode('utf-8'))
        token = body.get('token', '').strip()
        if token:
            self.db.execute(
                "DELETE FROM device_token WHERE account = %s AND token = %s",
                (uid, token)
            )
        return json.dumps({"status": "ok"})

    @Server.expose
    def create_server(self):
        account_id = self.getUser()
        server_id = self.db.insertDict('server', {'name': "New Server", "owner": account_id}, getId=True)
        self.db.insertDict('accessserver', {'account': account_id, 'server': server_id})
        textCatID = self.db.insertDict('server_cat', {'name': "salons textuels", 'server': server_id},getId=True)
        self.db.insertDict('server_cat', {'name': "salons vocaux", 'server': server_id})
        self.db.insertDict('textual_channel', {'name': "général", 'server': server_id, "category": textCatID})
        return json.dumps({"id": server_id})

    @Server.expose
    def delete_server(self, server_id):
        uid = self.getUser()
        if not self.checkAccessRights(uid, server_id, "server-admin"):
            raise HTTPError(self.response, 403, "forbidden")

        # If this is a personal server, deduct its usage from the owner's quota
        personal = self.db.getFilters("personal_server", ["server", "=", server_id])
        if personal:
            server = self.db.getSomething("server", server_id)
            if server and server.get("storage_usage", 0) > 0:
                self._adjustUserStorage(personal[0]["owner"], -server["storage_usage"])

        self.db.deleteSomething("server", server_id)
        raise HTTPRedirect(self.response, "/channels")

    @Server.expose
    def get_user_servers(self):
        uid = self.getUser()
        servers = self.db.getSomethingProxied("server", "accessserver", "account", uid)
        for server in servers:
            server["customEmojis"] = self.db.getAll("server_emoji", server["id"], "server")
        return json.dumps(servers, default=str)

    @Server.expose
    def get_discoverable_servers(self, search=None, tags=None, languages=None):
        """
        Get list of community servers for discovery page.

        Args:
            search: Optional search term for server name/description
            tags: Optional JSON array of tags to filter by
            languages: Optional JSON array of language codes to filter by

        Returns:
            JSON object with 'featured' and 'regular' server lists
        """
        uid = self.getUser()

        # Constants
        MAX_SEARCH_LENGTH = 100
        MAX_TAGS_FILTER = 10

        # Validate search
        if search:
            if len(search) > MAX_SEARCH_LENGTH:
                raise HTTPError(self.response, 400, "Search query too long")
            search = search.strip()

        # Validate and parse languages
        languages_list = []
        if languages:
            try:
                languages_list = json.loads(languages) if isinstance(languages, str) else languages
                if not isinstance(languages_list, list):
                    raise HTTPError(self.response, 400, "Languages must be an array")
            except json.JSONDecodeError:
                raise HTTPError(self.response, 400, "Invalid JSON format for languages")

        # Validate and parse tags
        tags_list = []
        if tags:
            try:
                tags_list = json.loads(tags) if isinstance(tags, str) else tags
                if not isinstance(tags_list, list):
                    raise HTTPError(self.response, 400, "Tags must be an array")
                if len(tags_list) > MAX_TAGS_FILTER:
                    raise HTTPError(self.response, 400, f"Too many tags (max {MAX_TAGS_FILTER})")
                # Sanitize tags
                tags_list = [tag.strip().lower() for tag in tags_list if tag.strip()]
            except json.JSONDecodeError:
                raise HTTPError(self.response, 400, "Invalid JSON format for tags")

        # Base query for community servers
        filters = ["is_community", "=", True]

        # Get all community servers first
        all_servers = self.db.getFilters("server", filters)

        # Filter by search term in Python (safer than complex SQL with parentheses)
        if search:
            search_lower = search.lower()
            filtered_servers = []
            for server in all_servers:
                name = (server.get('name') or '').lower()
                description = (server.get('description') or '').lower()
                if search_lower in name or search_lower in description:
                    filtered_servers.append(server)
            all_servers = filtered_servers

        # Filter by languages if provided
        if languages_list:
            filtered_servers = []
            for server in all_servers:
                server_languages = server.get('languages', [])
                if isinstance(server_languages, str):
                    server_languages = json.loads(server_languages)
                if any(lang in server_languages for lang in languages_list):
                    filtered_servers.append(server)
            all_servers = filtered_servers

        # Filter by tags if provided
        if tags_list:
            filtered_servers = []
            for server in all_servers:
                server_tags = server.get('tags', [])
                if isinstance(server_tags, str):
                    server_tags = json.loads(server_tags)
                # Check if any requested tag is in server tags
                if any(tag in server_tags for tag in tags_list):
                    filtered_servers.append(server)
            all_servers = filtered_servers

        # Separate featured and regular servers
        featured = [s for s in all_servers if s.get('is_featured', False)]
        regular = [s for s in all_servers if not s.get('is_featured', False)]

        # Sort featured by member count
        featured.sort(key=lambda x: x.get('member_count', 0), reverse=True)

        # Sort regular by member count
        regular.sort(key=lambda x: x.get('member_count', 0), reverse=True)

        # Mark servers user is already in
        user_server_ids = [s['id'] for s in self.db.getSomethingProxied("server", "accessserver", "account", uid)]

        for server in featured + regular:
            server['is_joined'] = server['id'] in user_server_ids

        # Limits
        MAX_FEATURED_SERVERS = 10
        MAX_REGULAR_SERVERS = 50

        return json.dumps({
            'featured': featured[:MAX_FEATURED_SERVERS],
            'regular': regular[:MAX_REGULAR_SERVERS]
        }, default=str)

    @Server.expose
    def join_community_server(self, server_id):
        """
        Join a community server.

        Args:
            server_id: ID of the server to join

        Returns:
            Success message
        """
        uid = self.getUser()

        # Check if server exists and is a community server
        server = self.db.getSomething("server", server_id)
        if not server:
            raise HTTPError(self.response, 404, "Server not found")

        if not server.get('is_community', False):
            raise HTTPError(self.response, 403, "This server is not a community server")

        # Check if already a member
        existing = self.db.getFilters("accessserver", [
            "account", "=", uid,
            "and",
            "server", "=", server_id
        ])

        if existing:
            raise HTTPError(self.response, 400, "Already a member of this server")

        # Add user to server
        self.db.insertDict('accessserver', {'account': uid, 'server': server_id})

        return json.dumps({"success": True, "server_id": server_id})

    @Server.expose
    def get_available_tags(self):
        """
        Get list of all available tags from community servers.

        Returns:
            JSON array of unique tags
        """
        # Get all community servers
        servers = self.db.getFilters("server", ["is_community", "=", True])

        # Collect all unique tags
        all_tags = set()
        for server in servers:
            tags = server.get('tags', [])
            if isinstance(tags, str):
                tags = json.loads(tags)
            all_tags.update(tags)

        return json.dumps(sorted(list(all_tags)))

    @Server.expose
    def create_conv(self, name, members, private=False):
        members = json.loads(members)
        conv_id = self.newConv(name, members, private)
        return json.dumps({"id": conv_id})

    @Server.expose
    def edit_conv(self, element, value, conv_id):
        uid = self.getUser()
        if element in ["id"]:
            raise HTTPError(self.response, 400, "Invalid element")

        members = self.db.getAll("accessconversation", conv_id, "conversation")
        for j in range(0, len(members)):
            if members[j]["account"] == uid:
                self.db.edit("conversation", conv_id, element, value)

                for user in members:
                    self.sendNotification(user["account"], {"type": "edit_conv", "item":element,"id":conv_id ,"content": value})

                return json.dumps({"status": "ok"})
        raise HTTPError(self.response, 403, "forbidden")

    @Server.expose
    def get_user_convs(self):
        uid = self.getUser()
        convs = self.db.getSomethingProxied("conversation", "accessconversation", "account", uid)
        for j in range(0, len(convs)):
            # TODO refactor, this is slow for no reason
            convs[j]["members"] = self.db.getFilters("accessconversation", ["conversation", "=", convs[j]["id"]])
            for i in range(0, len(convs[j]["members"])):
                convs[j]["members"][i] = convs[j]["members"][i]["account"]
        return json.dumps(convs)

    @Server.expose
    def get_users_info(self, users):
        uid = self.getUser()
        users = self.db.getFilters("mycelium_account", ["id", "in", json.loads(users)])
        self.getUsersStatus(users)
        return json.dumps(users, default=str)


    @Server.expose
    def subscribe(self, client_id, cat, items):
        uid = self.getUser()
        client_infos = self.db.getSomething("active_client",client_id)
        if not client_infos or client_infos.get("userid") != uid:
            raise HTTPError(self.response,403, "forbidden")

        if cat=="user":
            users = self.db.getFilters("mycelium_account", ["id", "in", json.loads(items)])
            for user in users:
                self.db.insertDict("subscription", {"client":client_id,"account": user["id"]})

    @Server.expose
    def test(self):
        if not self.config.getboolean("server", "DEBUG"):
            raise HTTPError(self.response, 404)
        return self.file(PATH + "/.idea/test.html")

    @Server.expose
    def get_conv_content(self, conv_id):
        uid = self.getUser()
        conv = self.db.getFilters("accessconversation", ["conversation", "=", conv_id, "and", "account", "=", uid])
        if conv:
            content = {}
            content["messages"] = self.db.getFilters("message", ["place", "=", conv_id, "order by timestamp"])
            self._enrichMessagesWithPolls(content["messages"], uid)
            self._enrichMessagesWithReactions(content["messages"])
            self._enrichMessagesWithConvBlocks(content["messages"])
            return json.dumps(content, default=str)


    @Server.expose
    def start_call(self, conversation_id, call_type="audio"):
        uid = self.getUser()

        access = self.db.getFilters("accessconversation", ["conversation", "=", conversation_id, "and", "account", "=", uid])

        if not access:
            raise HTTPError(self.response, 403, "Forbidden - No access to this conversation")

        conv = self.db.getSomething("conversation", conversation_id)
        if not conv:
            raise HTTPError(self.response, 403, "Calls are only available in conversations")

        call = self.callManager.create_call(conversation_id, uid, call_type)
        return json.dumps(call.to_dict(), default=str)

    @Server.expose
    def join_call(self, call_id):
        uid = self.getUser()

        call = self.callManager.active_calls.get(int(call_id))
        if not call:
            raise HTTPError(self.response, 404, "Call not found")

        access = self.db.getFilters("accessconversation", ["conversation", "=", call.conversation_id, "and", "account", "=", uid])

        if not access:
            raise HTTPError(self.response, 403, "Forbidden - No access to this conversation")

        result = self.callManager.join_call(int(call_id), uid)

        if result:
            response = {
                'call': result['call'].to_dict(),
                'mode_changed': result['mode_changed']
            }
            # Include old_mode and new_mode if mode changed
            if result.get('old_mode'):
                response['old_mode'] = result['old_mode']
            if result.get('new_mode'):
                response['new_mode'] = result['new_mode']

            return json.dumps(response, default=str)

        raise HTTPError(self.response, 500, "Failed to join call")

    @Server.expose
    def leave_call(self, call_id):
        uid = self.getUser()

        result = self.callManager.leave_call(int(call_id), uid)

        if result:
            response = {
                'ended': result['ended'],
                'mode_changed': result.get('mode_changed', False)
            }
            if not result['ended']:
                response['call'] = result['call'].to_dict()

            # Include old_mode and new_mode if mode changed
            if result.get('old_mode'):
                response['old_mode'] = result['old_mode']
            if result.get('new_mode'):
                response['new_mode'] = result['new_mode']

            return json.dumps(response, default=str)

        raise HTTPError(self.response, 404, "Call not found")

    @Server.expose
    def get_call_state(self, conversation_id):
        uid = self.getUser()

        access = self.db.getFilters("accessconversation", ["conversation", "=", conversation_id, "and", "account", "=", uid])

        if not access:
            raise HTTPError(self.response, 403, "Forbidden")

        call_state = self.callManager.get_call_state(int(conversation_id))

        if call_state:
            return json.dumps(call_state, default=str)

        return json.dumps({"active": False}, default=str)

    @Server.expose
    def get_chan_content(self, channel_id):
        uid = self.getUser()
        chan = self.db.getSomething("textual_channel", channel_id)
        if not chan:
            raise HTTPError(self.response, 404, "Not Found")

        if not self.checkChannelAccess(uid, channel_id, "textual", "view"):
            raise HTTPError(self.response, 403, "forbidden")

        content = {"name": chan["name"], "id": channel_id}
        content["messages"] = self.db.getFilters("message", ["place", "=", channel_id, "order by timestamp"])
        self._enrichMessagesWithPolls(content["messages"], uid)
        self._enrichMessagesWithReactions(content["messages"])
        self._enrichMessagesWithConvBlocks(content["messages"])
        return json.dumps(content, default=str)

    @Server.expose
    def get_note_content(self, channel_id):
        uid = self.getUser()
        chan = self.db.getSomething("notes_channel", channel_id)
        if not chan:
            raise HTTPError(self.response, 404, "Not Found")

        if not self.checkChannelAccess(uid, channel_id, "note", "view"):
            raise HTTPError(self.response, 403, "forbidden")

        content = {"name": chan["name"], "id": channel_id}
        content["blocks"] = self.db.getFilters("note_block", ["channel", "=", channel_id])
        return json.dumps(content, default=str)

    @Server.expose
    def get_serv_content(self, server_id, channel_id=None):
        uid = self.getUser()
        serv = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id])
        if serv:
            content = {}
            if not channel_id:
                content["channels"] = self.db.getAll("textual_channel", server_id,"server")
                content["vocals"] = self.db.getAll("vocal_channel", server_id,"server")
                content["drives"] = self.db.getAll("drive_channel", server_id,"server")
                content["notes"] = self.db.getAll("notes_channel", server_id,"server")
                # content["whiteboard"] = self.db.getAll("drive_channel", server_id,"server")
                op = self.db.getSomething("op_servs", server_id, "server")
                if op:
                    content["op"] = True
                content["cat"] = self.db.getAll("server_cat", server_id,"server")
                content["roles"] = self.db.getAll("role", server_id,"server")

                personal = self.db.getFilters("personal_server", ["server", "=", server_id])
                if personal:
                    content["type"] = "personal"
                    owner = self.db.getSomething("mycelium_account", personal[0]["owner"])
                    content["storage_usage"] = owner.get("storage_usage", 0) if owner else 0
                    content["storage_quota"] = USER_STORAGE_QUOTA
                else:
                    content["type"] = "standard"
                    server_data = self.db.getSomething("server", server_id)
                    content["storage_usage"] = server_data.get("storage_usage", 0) if server_data else 0
                    content["storage_quota"] = SERVER_STORAGE_QUOTA

                content["members"] = self.db.getFilters("accessserver", ["server", "=", server_id])
                for i in range(0, len(content["members"])):
                    userRoles = self.db.getFilters("role_attribution", ["server", "=", server_id, "and", "account", "=", content["members"][i]["account"]])
                    for j in range (0,len(userRoles)):
                        userRoles[j] = userRoles[j]["role"]
                    content["members"][i] = {"id": content["members"][i]["account"], "roles": userRoles}

                # Filter private channels: only show if user has view access
                content["channels"] = [ch for ch in content["channels"] if not ch.get("is_private") or self.checkChannelAccess(uid, ch["id"], "textual", "view")]
                content["vocals"] = [ch for ch in content["vocals"] if not ch.get("is_private") or self.checkChannelAccess(uid, ch["id"], "vocal", "view")]
                content["drives"] = [ch for ch in content["drives"] if not ch.get("is_private") or self.checkChannelAccess(uid, ch["id"], "drive", "view")]
                content["notes"] = [ch for ch in content["notes"] if not ch.get("is_private") or self.checkChannelAccess(uid, ch["id"], "note", "view")]

                # Include channel_permissions for this server
                content["channel_permissions"] = self.db.getAll("channel_permission", server_id, "server") or []
            else:
                content["messages"] = self.db.getFilters("message", ["place", "=", channel_id, "order by timestamp"])
            return json.dumps(content, default=str)

    @Server.expose
    def leave_server(self, server_id):
        uid = self.getUser()
        records = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id])
        if not records:
            raise HTTPError(self.response, 404, "not found")
        self.db.deleteSomething("accessserver", records[0]["id"])
        return json.dumps({"ok": True})

    @Server.expose
    def get_user_info(self):
        uid = self.getUser()
        user = self.db.getSomething("mycelium_account", uid)
        self.getUsersStatus([user],detailed=True)
        user["notifs"] = self.db.getAll("offline_notifs", uid, "account")
        user["additional_emails"] = self.uniauth.getAll("additional_mail", uid, "account")
        user["isAdmin"] = self.isAdmin(uid)
        user["storage_quota"] = USER_STORAGE_QUOTA
        return json.dumps(user, default=str)

    @Server.expose
    def get_storage_usage(self, server_id=None):
        """Get storage usage for a user or server."""
        uid = self.getUser()
        if server_id:
            # Check access
            access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id])
            if not access:
                raise HTTPError(self.response, 403, "forbidden")
            personal = self.db.getFilters("personal_server", ["server", "=", server_id])
            if personal and personal != []:
                owner = self.db.getSomething("mycelium_account", personal[0]["owner"])
                return json.dumps({"storage_usage": owner.get("storage_usage", 0), "storage_quota": USER_STORAGE_QUOTA, "target_type": "user"})
            else:
                server = self.db.getSomething("server", server_id)
                return json.dumps({"storage_usage": server.get("storage_usage", 0), "storage_quota": SERVER_STORAGE_QUOTA, "target_type": "server"})
        else:
            user = self.db.getSomething("mycelium_account", uid)
            return json.dumps({"storage_usage": user.get("storage_usage", 0), "storage_quota": USER_STORAGE_QUOTA, "target_type": "user"})

    @Server.expose
    def get_debug_otp(self, email):
        """
        Endpoint pour récupérer l'OTP en mode DEBUG uniquement
        Utilisé pour les tests automatisés
        """
        if not self.config.getboolean("server", "DEBUG"):
            raise HTTPError(self.response, 403, "This endpoint is only available in DEBUG mode")

        # Récupérer l'OTP depuis la base de données verif_code
        account = self.uniauth.getUserCredentials(email)
        if not account:
            raise HTTPError(self.response, 404, "User not found")

        verif_code = self.uniauth.getSomething("verif_code", account["id"])
        if not verif_code:
            raise HTTPError(self.response, 404, "No verification code found for this user")

        # Vérifier que le code n'est pas expiré
        if verif_code["expiration"] < datetime.datetime.now():
            raise HTTPError(self.response, 410, "Verification code has expired")

        return json.dumps({
            "code": verif_code["code"],
            "expiration": verif_code["expiration"]
        }, default=str)

    @Server.expose
    def upload_image(self):
        uid = self.getUser()
        user = self.db.getSomething("mycelium_account", uid)
        self.getUsersStatus([user],detailed=True)
        return json.dumps(user, default=str)

    @Server.expose
    def uploadDriveOnBehalf(self, API_KEY, email, filename, file):
        return self.drive.upload_on_behalf(API_KEY, email, filename, file)

    @Server.expose
    def upload_drive_file(self, drive_id, filename, file, parent_folder=None):
        return self.drive.upload_file(drive_id, filename, file, parent_folder)

    @Server.expose
    def get_drive_files(self, drive_id, parent_folder=None):
        return self.drive.get_files(drive_id, parent_folder)

    @Server.expose
    def preview_drive_file(self, file_id, max_bytes=2000):
        return self.drive.preview_file(file_id, max_bytes)

    @Server.expose
    def download_drive_file(self, file_id):
        return self.drive.download_file(file_id)

    @Server.expose
    def delete_drive_file(self, file_id):
        return self.drive.delete_file(file_id)

    @Server.expose
    def create_drive_folder(self, drive_id, foldername, parent_folder=None):
        return self.drive.create_folder(drive_id, foldername, parent_folder)

    @Server.expose
    def get_drive_folders(self, drive_id, parent_folder=None):
        return self.drive.get_folders(drive_id, parent_folder)

    @Server.expose
    def delete_drive_folder(self, folder_id):
        return self.drive.delete_folder(folder_id)

    @Server.expose
    def move_drive_file(self, file_id, target_folder=None):
        return self.drive.move_file(file_id, target_folder)

    @Server.expose
    def move_drive_folder(self, folder_id, target_folder=None):
        return self.drive.move_folder(folder_id, target_folder)

    @Server.expose
    def move_drive_items(self, items, target_folder=None):
        return self.drive.move_items(items, target_folder)

    def uploadDrive(self, user_id, drive_id, file, parent_folder=None):
        return self.drive.upload(user_id, drive_id, file, parent_folder)

    def isAdmin(self, uid):
        # Use cached admin list for performance (instead of DB query every time)
        if self._admin_cache is None or self._shouldRefreshAdminCache():
            self._refreshAdminCache()

        return uid in self._admin_cache

    def _refreshAdminCache(self):
        """Refresh the admin cache from database"""
        import datetime

        # Get all users with admin rights in op servers
        users_op_servs = self.db.cur.execute(
            "SELECT DISTINCT accessServer.account FROM op_servs, accessServer WHERE op_servs.server = accessServer.server",
            ()
        ).fetchall()

        admin_ids = set()

        for user_op_serv in users_op_servs:
            uid = user_op_serv["account"]
            # Check if user has mycelium_admin right
            if self._hasAdminRight(uid):
                admin_ids.add(uid)

        self._admin_cache = admin_ids
        self._admin_cache_time = datetime.datetime.now()

    def _hasAdminRight(self, uid):
        """Check if user has mycelium_admin right (helper for cache refresh)"""
        users_op_servs = self.db.cur.execute(
            "SELECT * FROM op_servs, accessServer WHERE op_servs.server = accessServer.server AND accessServer.account = %s",
            (uid,)
        ).fetchall()

        for user_op_serv in users_op_servs:
            server_id = user_op_serv["server"]
            if self.checkAccessRights(uid, server_id, "mycelium_admin"):
                return True

        return False

    def _shouldRefreshAdminCache(self):
        """Check if admin cache should be refreshed (every 5 minutes)"""
        import datetime

        if self._admin_cache_time is None:
            return True

        # Refresh cache every 5 minutes
        age = datetime.datetime.now() - self._admin_cache_time
        return age.total_seconds() > 300  # 5 minutes

    def invalidateAdminCache(self):
        """Invalidate admin cache (call this when admin rights change)"""
        self._admin_cache = None
        self._admin_cache_time = None

    # --------------------------------STORAGE QUOTA--------------------------------

    def _estimateBase64Size(self, data):
        """Estimate the actual file size from base64-encoded data."""
        if "," in data:
            data = data.split(",")[1]
        return int(len(data) * 3 / 4)

    def _adjustStorage(self, server_id, delta):
        """Add delta bytes (negative to decrement) to the right target for a server."""
        if delta == 0:
            return
        personal = self.db.getFilters("personal_server", ["server", "=", server_id])
        if personal:
            self.db.cur.execute(
                "UPDATE mycelium_account SET storage_usage = GREATEST(0, storage_usage + %s) WHERE id = %s",
                (delta, personal[0]["owner"])
            )
        else:
            self.db.cur.execute(
                "UPDATE server SET storage_usage = GREATEST(0, storage_usage + %s) WHERE id = %s",
                (delta, server_id)
            )

    def _adjustUserStorage(self, uid, delta):
        """Add delta bytes (negative to decrement) directly to a user's storage_usage."""
        if delta == 0:
            return
        self.db.cur.execute(
            "UPDATE mycelium_account SET storage_usage = GREATEST(0, storage_usage + %s) WHERE id = %s",
            (delta, uid)
        )

    def _checkQuota(self, server_id, size):
        """Raise HTTPError 413 if adding size bytes would exceed the server's quota."""
        personal = self.db.getFilters("personal_server", ["server", "=", server_id])
        if personal:
            target = self.db.getSomething("mycelium_account", personal[0]["owner"])
            quota, target_type = USER_STORAGE_QUOTA, "user"
        else:
            target = self.db.getSomething("server", server_id)
            quota, target_type = SERVER_STORAGE_QUOTA, "server"
        usage = target.get("storage_usage", 0) if target else 0
        if usage + size > quota:
            raise HTTPError(self.response, 413, json.dumps({
                "error": "storage_quota_exceeded",
                "current_usage": usage,
                "quota": quota,
                "target_type": target_type
            }))

    def _checkUserQuota(self, uid, size):
        """Raise HTTPError 413 if adding size bytes would exceed the user's personal quota."""
        user = self.db.getSomething("mycelium_account", uid)
        usage = user.get("storage_usage", 0) if user else 0
        if usage + size > USER_STORAGE_QUOTA:
            raise HTTPError(self.response, 413, json.dumps({
                "error": "storage_quota_exceeded",
                "current_usage": usage,
                "quota": USER_STORAGE_QUOTA,
                "target_type": "user"
            }))

    def _isFilepathOrphaned(self, filepath, exclude_message_id=None, exclude_drive_file_id=None):
        """
        Return True if no other message attachment or drive_file still references this filepath.
        Pass the IDs being deleted so they are excluded from the check.
        """
        # Check drive_file table
        if exclude_drive_file_id:
            drive_refs = self.db.cur.execute(
                "SELECT id FROM drive_file WHERE filepath = %s AND id != %s",
                (filepath, exclude_drive_file_id)
            ).fetchall()
        else:
            drive_refs = self.db.cur.execute(
                "SELECT id FROM drive_file WHERE filepath = %s",
                (filepath,)
            ).fetchall()
        if drive_refs:
            return False

        # Check message.attachments JSON column for any remaining reference
        if exclude_message_id:
            msg_refs = self.db.cur.execute(
                "SELECT id FROM message WHERE attachments::text LIKE %s AND id != %s",
                (f'%{filepath}%', exclude_message_id)
            ).fetchall()
        else:
            msg_refs = self.db.cur.execute(
                "SELECT id FROM message WHERE attachments::text LIKE %s",
                (f'%{filepath}%',)
            ).fetchall()
        return not msg_refs

    @Server.expose
    def set_server_featured(self, server_id, featured):
        """
        Set a server as featured (admin only).

        Args:
            server_id: ID of the server
            featured: "true" or "false"

        Returns:
            Success message
        """
        uid = self.getUser()

        # Check if user is admin
        if not self.isAdmin(uid):
            raise HTTPError(self.response, 403, "Only admins can feature servers")

        # Check if server exists and is a community server
        server = self.db.getSomething("server", server_id)
        if not server:
            raise HTTPError(self.response, 404, "Server not found")

        if not server.get('is_community', False):
            raise HTTPError(self.response, 400, "Only community servers can be featured")

        # Update featured status
        self.db.edit("server", server_id, "is_featured", featured == "true")

        return json.dumps({"success": True, "server_id": server_id, "is_featured": featured == "true"})

    def onWSAuth(self,uid):
        self.sendStatusUpdates(uid)

    @Server.expose
    def send_message(self, conv, content, reply=False, attachments = [], poll=None, conv_block=None):
        uid = self.getUser()

        total_attachment_size = sum(
            self._estimateBase64Size(a.get('dataUrl', ''))
            for a in attachments if a.get('dataUrl')
        )

        # Determine channel/server and check quota before saving
        conv_parsed = json.loads(conv)
        channel = self.db.getSomething("textual_channel", conv_parsed.get("id")) if conv_parsed.get("id") else None
        if total_attachment_size > 0:
            if channel:
                self._checkQuota(channel["server"], total_attachment_size)
            else:
                self._checkUserQuota(uid, total_attachment_size)

        attachmentList = []
        for attachment in attachments:
            filepath = self.saveFile(attachment.get('dataUrl', ''))
            attachmentList.append({"mime": attachment.get('mimeType', ''), "filename": attachment.get('filename', 'file'), "filepath": filepath})

        conv = conv_parsed
        if not conv.get("id"):
            conv["id"] = self.newConv("Noname", [uid, conv["dest"]])

        # Handle poll creation
        if poll:
            question = poll.get("question", "").strip()
            options = poll.get("options", [])
            if not question:
                raise HTTPError(self.response, 400, "Poll requires a question")
            multiple_choice = bool(poll.get("multipleChoice", False))
            allow_user_options = bool(poll.get("allowUserOptions", False))

            # Insert message with empty body for polls
            message = {"sender": uid, "place": conv["id"], "body": "", "attachments": "[]"}
            if reply and reply != "undefined" and reply != "null":
                message["reply"] = reply
            msgId = self.db.insertDict("message", message, getId=True)
            message["id"] = msgId

            # Insert poll
            pollId = self.db.insertDict("poll", {
                "message": msgId,
                "question": question,
                "multiple_choice": multiple_choice,
                "allow_user_options": allow_user_options
            }, getId=True)

            # Insert poll options
            poll_options = []
            for opt_text in options:
                opt_text = opt_text.strip()
                if opt_text:
                    optId = self.db.insertDict("poll_option", {
                        "poll": pollId,
                        "text": opt_text,
                        "creator": uid
                    }, getId=True)
                    poll_options.append({"id": optId, "text": opt_text, "creator": uid})

            # Store poll reference as attachment
            pollAttachment = [{"type": "poll", "pollId": pollId}]
            self.db.edit("message", msgId, "attachments", json.dumps(pollAttachment))
            message["attachments"] = json.dumps(pollAttachment)

            # Enrich message with poll data for notifications
            message["poll"] = {
                "id": pollId,
                "question": question,
                "multiple_choice": multiple_choice,
                "allow_user_options": allow_user_options,
                "options": poll_options,
                "votes": {}
            }

            channel = self.db.getSomething("textual_channel", conv["id"])
            if channel:
                if channel.get("is_private") and not self.checkChannelAccess(uid, conv["id"], "textual", "send-messages"):
                    raise HTTPError(self.response, 403, "no permission to send messages in this channel")
                self.notifyChannelMesage(uid, channel, message)
            else:
                self.notifyConvMessage(uid, conv, message)

            return json.dumps({"message": message}, default=str)

        # Handle conv block (spreadsheet) creation
        if conv_block:
            import uuid as _uuid
            block_type = conv_block.get("type", "")
            template   = conv_block.get("template", "empty")
            if block_type != "spreadsheet":
                raise HTTPError(self.response, 400, "Unsupported block type")

            block_uuid = str(_uuid.uuid4())
            msg_body = {"sender": uid, "place": conv["id"], "body": "", "attachments": "[]"}
            if reply and reply != "undefined" and reply != "null":
                msg_body["reply"] = reply
            msg_id = self.db.insertDict("message", msg_body, getId=True)
            msg_body["id"] = msg_id

            rows, cols = 5, 3
            sheet_id = self.db.insertDict("note_spreadsheet", {
                "block_uuid": block_uuid,
                "conv_id": conv["id"],
                "message_id": msg_id,
                "rows": rows,
                "cols": cols
            }, getId=True)

            cells = {}
            if template == "tricount":
                for i, header in enumerate(["Name", "Amount", "Paid By"]):
                    self.db.insertDict("note_spreadsheet_cell", {
                        "spreadsheet_id": sheet_id,
                        "row_idx": 1,
                        "col_idx": i,
                        "value": header
                    })
                    cells[self._sheet_ref(i, 1)] = header

            attachment = [{"type": "conv_spreadsheet", "uuid": block_uuid}]
            self.db.edit("message", msg_id, "attachments", json.dumps(attachment))
            msg_body["attachments"]     = json.dumps(attachment)
            msg_body["convSpreadsheet"] = {
                "uuid": block_uuid, "id": sheet_id,
                "rows": rows, "cols": cols, "cells": cells, "col_widths": {}
            }

            channel = self.db.getSomething("textual_channel", conv["id"])
            if channel:
                if channel.get("is_private") and not self.checkChannelAccess(uid, conv["id"], "textual", "send-messages"):
                    raise HTTPError(self.response, 403, "no permission to send messages in this channel")
                self.notifyChannelMesage(uid, channel, msg_body)
            else:
                self.notifyConvMessage(uid, conv, msg_body)

            return json.dumps({"message": msg_body}, default=str)

        message = {"sender": uid, "place": conv["id"], "body": content, "attachments": json.dumps(attachmentList)}
        if reply and reply != "undefined" and reply != "null":
            message["reply"] = reply

        msgId = self.db.insertDict("message", message, getId=True)
        message["id"] = msgId

        channel = self.db.getSomething("textual_channel", conv["id"])
        if channel:
            if channel.get("is_private") and not self.checkChannelAccess(uid, conv["id"], "textual", "send-messages"):
                raise HTTPError(self.response, 403, "no permission to send messages in this channel")
            self.notifyChannelMesage(uid, channel, message)
            if total_attachment_size > 0:
                self._adjustStorage(channel["server"], total_attachment_size)
        else:
            self.notifyConvMessage(uid, conv, message)
            if total_attachment_size > 0:
                self._adjustUserStorage(uid, total_attachment_size)

        return json.dumps(attachmentList)

    def notifyConvMessage(self,uid ,conv, message):
        members = self.db.getAll("accessconversation", conv["id"], "conversation")
        sender_name = self.db.getSomething("mycelium_account", uid).get("display", "User")

        for user in members:
            if user["account"] != uid:
                self.sendNotification(user["account"], {"type": "message", "content": message})

                # Push Notification for DM
                self.sendPushNotification(user["account"], {
                    "title": sender_name,
                    "body": message.get("body", "New message"),
                    "data": {"type": "message", "conv_id": str(conv["id"])}
                })

                notif  = self.db.getFilters("offline_notifs", ["account", "=", user['account'], "and", "conversation", "=", conv["id"]])
                if notif != []:
                    self.db.edit("offline_notifs", notif[0]["id"], "number", notif[0]["number"] + 1)
                else :
                    self.db.insertDict("offline_notifs", {"account": user['account'] , "conversation": conv["id"]})

    def notifyChannelMesage(self, uid, channel, message):
        if channel:
            server_id = channel["server"]
            mention_targets = set()

            # Parse <@everyone> – notify all server members
            if "<@everyone>" in message["body"]:
                server_members = self.db.getFilters("accessserver", ["server", "=", server_id])
                for m in server_members:
                    mention_targets.add(m["account"])

            # Parse <@here> – notify online server members
            if "<@here>" in message["body"]:
                server_members = self.db.getFilters("accessserver", ["server", "=", server_id])
                for m in server_members:
                    online = self.db.getSomething("active_client", m["account"], "userid")
                    if online:
                        mention_targets.add(m["account"])

            # Parse <@&roleId> – notify all members with that role
            role_mentions = re.findall(r'<@&(\d+)>', message["body"])
            for role_id in role_mentions:
                role_members = self.db.getFilters("role_attribution", ["role", "=", int(role_id), "and", "server", "=", server_id])
                for rm in role_members:
                    mention_targets.add(rm["account"])

            # Parse <@userId> – notify specific users (for explicit @user mentions)
            user_mentions = re.findall(r'<@(\d+)>', message["body"])
            for mentioned_uid in user_mentions:
                mention_targets.add(int(mentioned_uid))

            mention_targets.discard(uid)  # Don't notify the sender

            # For private channels, filter targets to only those who can view the channel
            if channel.get("is_private"):
                mention_targets = {t for t in mention_targets if self.checkChannelAccess(t, channel["id"], "textual", "view")}

            # Broadcast the message to ALL server members (for live display in active channel views)
            # Mention targets additionally get offline notifications
            all_members = self.db.getFilters("accessserver", ["server", "=", server_id])
            for m in all_members:
                member_uid = m["account"]
                if member_uid == uid:
                    continue
                # Skip private channel members without access
                if channel.get("is_private") and not self.checkChannelAccess(member_uid, channel["id"], "textual", "view"):
                    continue
                self.sendNotification(member_uid, {"type": "message", "content": message})

            # Offline notifs only for mention targets
            for target_uid in mention_targets:
                notif = self.db.getFilters("offline_notifs", ["account", "=", target_uid, "and", "conversation", "=", channel["id"]])
                if notif:
                    self.db.edit("offline_notifs", notif[0]["id"], "number", notif[0]["number"] + 1)
                else:
                    self.db.insertDict("offline_notifs", {"account": target_uid, "conversation": channel["id"]})

                # Push Notification for Mention
                self.sendPushNotification(target_uid, {
                    "title": f"Mentioned in {channel.get('name', 'channel')}",
                    "body": message.get("body", "New mention"),
                    "data": {"type": "mention", "channel_id": str(channel["id"])}
                })


    @Server.expose
    def consult_notifs(self, notif_id):
        uid = self.getUser()
        if not self.db.getFilters("offline_notifs", ["account", "=", uid, "and", "id", "=", notif_id]):
            raise HTTPError(self.response, 403, "forbidden")
        self.db.deleteSomething("offline_notifs", notif_id)

    @Server.expose
    def edit_message(self, message_id, content):
        print("editing message", message_id, content)
        uid = self.getUser()

        message = self.db.getSomething("message", message_id)

        if not message or message["sender"] != uid:
            raise HTTPError(self.response, 403, "forbidden")

        self.db.edit("message", message["id"], "body", content)
        self.db.edit("message", message["id"], "edited", True)

        # If message has a poll, update the poll question
        attachments = message.get("attachments")
        if attachments:
            if isinstance(attachments, str):
                try:
                    attachments = json.loads(attachments)
                except:
                    attachments = []
            for att in attachments:
                if isinstance(att, dict) and att.get("type") == "poll":
                    self.db.edit("poll", att["pollId"], "question", content)

        notif = {"type": "message_edited", "content": {"id": message, "content": content}}
        channel = self.db.getSomething("textual_channel", message["place"])
        if channel:
            members = self.db.getFilters("accessserver", ["server", "=", channel["server"]])
            for member in members:
                if member["account"] != uid:
                    self.sendNotification(member["account"], notif)
        else:
            members = self.db.getAll("accessconversation", message["place"], "conversation")
            for member in members:
                if member["account"] != uid:
                    self.sendNotification(member["account"], notif)

    @Server.expose
    def delete_message(self, message_id):
        uid = self.getUser()

        messageId = message_id
        message = self.db.getSomething("message", message_id)

        if not message or message["sender"] != uid:
            raise HTTPError(self.response, 403, "forbidden")

        # Clean up attachments and decrement storage
        attachments = message.get("attachments")
        if attachments:
            if isinstance(attachments, str):
                try:
                    attachments = json.loads(attachments)
                except:
                    attachments = []
            total_size = 0
            for attach in attachments:
                rel_path = attach.get("filepath", "")
                if not rel_path:
                    continue
                full_path = self.path + "/static/attachments/" + rel_path
                if os.path.exists(full_path) and self._isFilepathOrphaned(rel_path, exclude_message_id=messageId):
                    total_size += os.path.getsize(full_path)
                    try:
                        os.remove(full_path)
                    except Exception as e:
                        print(f"Error deleting attachment {full_path}: {e}")

            # Decrement storage
            if total_size > 0:
                channel = self.db.getSomething("textual_channel", message["place"])
                if channel:
                    self._adjustStorage(channel["server"], -total_size)
                else:
                    self._adjustUserStorage(message["sender"], -total_size)

        self.db.deleteSomething("message", messageId)

        del_notif = {"type": "message_deleted", "content": {"id": messageId}}
        channel = self.db.getSomething("textual_channel", message["place"])
        if channel:
            members = self.db.getFilters("accessserver", ["server", "=", channel["server"]])
            for member in members:
                if member["account"] != uid:
                    self.sendNotification(member["account"], del_notif)
        else:
            members = self.db.getAll("accessconversation", message["place"], "conversation")
            for member in members:
                if member["account"] != uid:
                    self.sendNotification(member["account"], del_notif)

    def _enrichMessagesWithPolls(self, messages, uid):
        """Enrich messages that have poll attachments with full poll data."""
        for msg in messages:
            attachments = msg.get("attachments")
            if attachments:
                if isinstance(attachments, str):
                    try:
                        attachments = json.loads(attachments)
                    except:
                        continue
                for att in attachments:
                    if isinstance(att, dict) and att.get("type") == "poll":
                        poll = self.db.getSomething("poll", att["pollId"])
                        if poll:
                            options = self.db.getAll("poll_option", poll["id"], "poll")
                            votes = self.db.getAll("poll_vote", poll["id"], "poll")
                            # Build votes dict: {option_id: [voter_ids]}
                            votes_dict = {}
                            for v in votes:
                                oid = v["option"]
                                if oid not in votes_dict:
                                    votes_dict[oid] = []
                                votes_dict[oid].append(v["voter"])
                            msg["poll"] = {
                                "id": poll["id"],
                                "question": poll["question"],
                                "multiple_choice": poll["multiple_choice"],
                                "allow_user_options": poll["allow_user_options"],
                                "options": [{"id": o["id"], "text": o["text"], "creator": o["creator"]} for o in options],
                                "votes": {str(k): v for k, v in votes_dict.items()}
                            }

    def _enrichMessagesWithReactions(self, messages):
        for msg in messages:
            reactions = self.db.getAll("message_reaction", msg["id"], "message")
            reactions_dict = {}
            for r in reactions:
                emoji = r["emoji"]
                if emoji not in reactions_dict:
                    reactions_dict[emoji] = []
                reactions_dict[emoji].append(r["account"])
            msg["reactions"] = reactions_dict

    def _enrichMessagesWithConvBlocks(self, messages):
        for msg in messages:
            atts = msg.get("attachments") or "[]"
            if isinstance(atts, str):
                try: atts = json.loads(atts)
                except: atts = []
            for att in atts:
                if att and att.get("type") == "conv_spreadsheet":
                    sheet = self.db.getSomething("note_spreadsheet", att["uuid"], "block_uuid")
                    if sheet:
                        cells_data = self.db.getFilters("note_spreadsheet_cell",
                            ["spreadsheet_id", "=", sheet["id"]]) or []
                        cells = {self._sheet_ref(c["col_idx"], c["row_idx"]): c["value"]
                                 for c in cells_data}
                        col_widths = self._get_sheet_col_widths(sheet["id"])
                        msg["convSpreadsheet"] = {
                            "uuid": sheet["block_uuid"], "id": sheet["id"],
                            "rows": sheet["rows"], "cols": sheet["cols"],
                            "cells": cells, "col_widths": col_widths
                        }

    @Server.expose
    def toggle_reaction(self, message_id, emoji):
        uid = self.getUser()

        # Check if user has access to the message
        message = self.db.getSomething("message", message_id)
        if not message:
            raise HTTPError(self.response, 404, "Message not found")
            
        channel = self.db.getSomething("textual_channel", message["place"])
        if channel:
            if channel.get("is_private") and not self.checkChannelAccess(uid, channel["id"], "textual", "view"):
                raise HTTPError(self.response, 403, "no permission to view this channel")
        else:
            conv = self.db.getFilters("accessconversation", ["conversation", "=", message["place"], "and", "account", "=", uid])
            if not conv:
                 raise HTTPError(self.response, 403, "no permission to view this conversation")

        existing_reaction = self.db.getFilters("message_reaction", [
            "message", "=", message_id, "and",
            "account", "=", uid, "and",
            "emoji", "=", emoji
        ])

        if existing_reaction:
            self.db.deleteSomething("message_reaction", existing_reaction[0]["id"])
            action = "removed"
        else:
            self.db.insertDict("message_reaction", {
                "message": message_id,
                "account": uid,
                "emoji": emoji
            })
            action = "added"
            
        # Re-fetch reactions for this message to broadcast the updated state
        reactions = self.db.getAll("message_reaction", message_id, "message")

        broadcast_reactions_dict = {}
        for r in reactions:
            e = r["emoji"]
            if e not in broadcast_reactions_dict:
                broadcast_reactions_dict[e] = []
            broadcast_reactions_dict[e].append(r["account"])
            
        notif_data = {
            "type": "reaction_updated",
            "content": {
                "messageId": message_id,
                "place": message["place"],
                "emoji": emoji,
                "reactions": broadcast_reactions_dict
            }
        }

        if channel:
            members = self.db.getFilters("accessserver", ["server", "=", channel["server"]])
            for m in members:
                if m["account"] != uid:
                    self.sendNotification(m["account"], notif_data)
        else:
            members = self.db.getAll("accessconversation", message["place"], "conversation")
            for m in members:
                if m["account"] != uid:
                    self.sendNotification(m["account"], notif_data)

        return json.dumps({"success": True, "action": action, "reactions": broadcast_reactions_dict})

    def _getPollConvAccess(self, uid, poll_id):
        """Check if user has access to the conversation containing a poll. Returns (poll, message) or raises 403."""
        poll = self.db.getSomething("poll", poll_id)
        if not poll:
            raise HTTPError(self.response, 404, "Poll not found")
        message = self.db.getSomething("message", poll["message"])
        if not message:
            raise HTTPError(self.response, 404, "Poll message not found")
        # Check access: either via accessconversation (DMs) or server membership (channels)
        channel = self.db.getSomething("textual_channel", message["place"])
        if channel:
            access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", channel["server"]])
            if not access:
                raise HTTPError(self.response, 403, "No access to this poll")
            if channel.get("is_private") and not self.checkChannelAccess(uid, message["place"], "textual", "view"):
                raise HTTPError(self.response, 403, "No access to this poll")
        else:
            access = self.db.getFilters("accessconversation", ["conversation", "=", message["place"], "and", "account", "=", uid])
            if not access:
                raise HTTPError(self.response, 403, "No access to this poll")
        return poll, message

    @Server.expose
    def vote_poll(self, poll_id, option_ids):
        uid = self.getUser()
        poll, message = self._getPollConvAccess(uid, poll_id)
        option_ids = json.loads(option_ids) if isinstance(option_ids, str) else option_ids

        if not isinstance(option_ids, list) or len(option_ids) == 0:
            raise HTTPError(self.response, 400, "Must select at least one option")

        # Enforce single-choice policy
        if not poll["multiple_choice"] and len(option_ids) > 1:
            raise HTTPError(self.response, 400, "This poll only allows a single answer")

        # Validate all option IDs belong to this poll
        poll_options = self.db.getAll("poll_option", poll["id"], "poll")
        valid_option_ids = {o["id"] for o in poll_options}
        for oid in option_ids:
            if int(oid) not in valid_option_ids:
                raise HTTPError(self.response, 400, "Invalid option for this poll")

        # Remove previous votes for this user on this poll
        existing_votes = self.db.getFilters("poll_vote", ["poll", "=", poll["id"], "and", "voter", "=", uid])
        for v in existing_votes:
            self.db.deleteSomething("poll_vote", v["id"])

        # Insert new votes
        for oid in option_ids:
            self.db.insertDict("poll_vote", {"poll": poll["id"], "option": int(oid), "voter": uid})

        # Re-fetch all votes for notification
        all_votes = self.db.getAll("poll_vote", poll["id"], "poll")
        votes_dict = {}
        for v in all_votes:
            k = str(v["option"])
            if k not in votes_dict:
                votes_dict[k] = []
            votes_dict[k].append(v["voter"])

        # Notify conversation members
        notif_data = {"type": "poll_voted", "content": {
            "messageId": message["id"],
            "place": message["place"],
            "pollId": poll["id"],
            "votes": votes_dict
        }}
        channel = self.db.getSomething("textual_channel", message["place"])
        if channel:
            members = self.db.getFilters("accessserver", ["server", "=", channel["server"]])
            for m in members:
                if m["account"] != uid:
                    self.sendNotification(m["account"], notif_data)
        else:
            members = self.db.getAll("accessconversation", message["place"], "conversation")
            for m in members:
                if m["account"] != uid:
                    self.sendNotification(m["account"], notif_data)

        return json.dumps({"success": True, "votes": votes_dict})

    @Server.expose
    def add_poll_option(self, poll_id, text):
        uid = self.getUser()
        poll, message = self._getPollConvAccess(uid, poll_id)

        if not poll["allow_user_options"]:
            raise HTTPError(self.response, 403, "This poll does not allow user-added options")

        text = text.strip()
        if not text:
            raise HTTPError(self.response, 400, "Option text cannot be empty")

        optId = self.db.insertDict("poll_option", {
            "poll": poll["id"],
            "text": text,
            "creator": uid
        }, getId=True)

        new_option = {"id": optId, "text": text, "creator": uid}

        # Notify conversation members
        notif_data = {"type": "poll_option_added", "content": {
            "messageId": message["id"],
            "place": message["place"],
            "pollId": poll["id"],
            "option": new_option
        }}
        channel = self.db.getSomething("textual_channel", message["place"])
        if channel:
            members = self.db.getFilters("accessserver", ["server", "=", channel["server"]])
            for m in members:
                if m["account"] != uid:
                    self.sendNotification(m["account"], notif_data)
        else:
            members = self.db.getAll("accessconversation", message["place"], "conversation")
            for m in members:
                if m["account"] != uid:
                    self.sendNotification(m["account"], notif_data)

        return json.dumps(new_option)

    @Server.expose
    def get_poll_results(self, poll_id):
        uid = self.getUser()
        poll, message = self._getPollConvAccess(uid, poll_id)

        options = self.db.getAll("poll_option", poll["id"], "poll")
        votes = self.db.getAll("poll_vote", poll["id"], "poll")

        votes_dict = {}
        for v in votes:
            k = str(v["option"])
            if k not in votes_dict:
                votes_dict[k] = []
            votes_dict[k].append(v["voter"])

        total_votes = len(set(v["voter"] for v in votes))

        return json.dumps({
            "poll": {
                "id": poll["id"],
                "question": poll["question"],
                "multiple_choice": poll["multiple_choice"],
                "allow_user_options": poll["allow_user_options"]
            },
            "options": [{"id": o["id"], "text": o["text"], "creator": o["creator"]} for o in options],
            "votes": votes_dict,
            "totalVoters": total_votes
        })

    @Server.expose
    def register_activity(self, SDP):
        uid = self.getUser()
        self.db.insertDict("active_client", {"userid": uid, "SDP": SDP})


    @Server.expose
    def block_user(self, user_id):
        uid = self.getUser()
        if self.db.getFilters("blockship", ["blocker", "=", uid, "and", "blocked", "=", user_id]):
            return json.dumps({"status": "already_blocked"})
        block_id = self.db.insertDict("blockship", {"blocker": uid, "blocked": user_id}, getId=True)
        return json.dumps({"status": "ok", "id": block_id})


    @Server.expose
    def add_friend(self, username):
        uid = self.getUser()
        friend = self.db.getSomething("mycelium_account", username, "username")
        if not friend:
            return json.dumps({"error": "user not found"})
        if friend['id'] == uid:
            return json.dumps({"error": "You can't add yourself as a friend"})

        friendship = self.db.getFilters("boatakopin",
                                        ["kopinprincipal", "=", uid, "and", "kopinsecondaire", "=", friend['id'],
                                         ") or (", "kopinprincipal", "=", friend['id'], "and", "kopinsecondaire",
                                         "=", uid, ')'], "(")
        if friendship:
            return json.dumps({"error": "already friends or invitation already sent"})

        request = {"kopinprincipal": uid, "kopinsecondaire": friend['id'], "accepted": False}
        request["id"] = self.db.insertDict("boatakopin", request, True)
        self.sendNotification(friend['id'], {"type": "friend_request", "content": request})
        return json.dumps({"status": "ok"})

    @Server.expose
    def accept_friend(self, invitation_id):
        uid = self.getUser()
        friendship = self.db.getFilters("boatakopin", ["id", "=", invitation_id, "and", "kopinsecondaire", "=", uid])
        if friendship:
            self.db.edit("boatakopin", invitation_id, "accepted", True)
            conv_id = self.db.insertDict('conversation', {'name': ""}, getId=True)
            self.db.insertDict('accessconversation', {'account': uid, 'conversation': conv_id})
            self.db.insertDict('accessconversation',
                               {'account': friendship[0]["kopinprincipal"], 'conversation': conv_id})
            self.db.edit("boatakopin", invitation_id, "conv", conv_id)

            friendship[0]["conv"] = conv_id
            self.sendNotification(friendship[0]["kopinprincipal"], {"type": "accepted_request", "content": friendship[0]})

            conv = {"id": conv_id, "name": "", "members": [uid, friendship[0]["kopinprincipal"]]}
            self.sendNotification(uid, {"type": "added_conv", "content": conv})
            self.sendNotification(friendship[0]["kopinprincipal"], {"type": "added_conv", "content": conv})
            return json.dumps({"status": "ok"})
        raise HTTPError(self.response, 403, "forbidden")

    @Server.expose
    def get_friends(self):
        uid = self.getUser()
        friends = self.db.getFilters("boatakopin",
                                     ["accepted", "=", True, "and (", "kopinprincipal", "=", uid, "or",
                                      "kopinsecondaire", "=", uid, ")"])
        return json.dumps(friends)

    @Server.expose
    def get_blocked(self):
        uid = self.getUser()
        enemies = self.db.getAll("blockship", uid, "blocker")
        return json.dumps(enemies)

    @Server.expose
    def get_friend_invitations(self):
        uid = self.getUser()
        invitations = self.db.getFilters("boatakopin",
                                         ["accepted", "=", False, "and (", "kopinprincipal", "=", uid, "or",
                                          "kopinsecondaire", "=", uid, ")"])
        return json.dumps(invitations)

    @Server.expose
    def remove_friend(self, friendship_id):
        uid = self.getUser()
        friendship = self.db.getSomething("boatakopin", friendship_id)
        if friendship and friendship["accepted"] and (friendship["kopinprincipal"] == uid or friendship["kopinsecondaire"] == uid):
            self.db.deleteSomething("boatakopin", friendship_id)
            return json.dumps({"status": "ok"})
        raise HTTPError(self.response, 403, "forbidden")

    @Server.expose
    def change_username(self, value):
        uid = self.getUser()
        if re.fullmatch(REGEX_USERNAME, value):
            if not self.db.getSomething("mycelium_account", value, "username"):
                self.db.edit("mycelium_account", uid, "username", value)
                return json.dumps({"status": "ok"})
            else:
                return json.dumps({"error": "this username already exists"})
        return json.dumps({"error": "invalid username"})

    @Server.expose
    def change_status(self, value):
        uid = self.getUser()
        status = json.loads(value)
        self.db.edit("status", uid, "mode", status["mode"])
        self.db.edit("status", uid, "text", status["text"])
        self.db.edit("status", uid, "emoji", status["emoji"])
        if status["expiration"]:
            self.db.edit("status", uid, "expiration", status["expiration"])
        else:
            self.db.edit("status", uid, "expiration", None)
        self.sendStatusUpdates(uid)
        return json.dumps({"status": "ok"})

    @Server.expose
    def change_pfp(self, value):
        uid = self.getUser()
        filename = self.saveFile(value)
        self.db.edit("mycelium_account", uid, "pfp", filename)
        return json.dumps({"pfp": filename}, default=str)

    @Server.expose
    def change_banner(self, value):
        uid = self.getUser()
        filename = self.saveFile(value)
        self.db.edit("mycelium_account", uid, "banner", filename)
        return json.dumps({"banner": filename}, default=str)

    @Server.expose
    def change_profile(self, element, value):
        uid = self.getUser()
        if element in ["id", "inscription", "storage_usage"]:
            return json.dumps({"error": "forbidden"})
        self.db.edit("mycelium_account", uid, element, value)
        return json.dumps({"status": "ok"})

    @Server.expose
    def add_email(self, email):
        uid = self.getUser()

        # Basic email validation
        email = email.strip().lower()
        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', email):
            return json.dumps({"error": "Invalid email address"})

        # Check if email already exists in main accounts
        existing_user = self.uniauth.getUserCredentials(email)
        if existing_user:
            return json.dumps({"error": "This email is already registered to an account"})

        # Check if email already exists in additional emails
        existing_additional = self.uniauth.getSomething("additional_mail", email, "email")
        if existing_additional:
            return json.dumps({"error": "This email is already added to an account"})

        # Insert the new email
        email_id = self.uniauth.insertDict("additional_mail", {
            "account": uid,
            "email": email
        }, getId=True)

        return json.dumps({"id": email_id, "email": email, "account": uid})

    @Server.expose
    def remove_email(self, email_id):
        uid = self.getUser()

        # Check if the email belongs to the current user
        email_entry = self.uniauth.getSomething("additional_mail", email_id)
        if not email_entry or email_entry["account"] != uid:
            return json.dumps({"error": "Email not found or access denied"})

        # Delete the email
        self.uniauth.deleteSomething("additional_mail", email_id)

        return json.dumps({"success": True})

    # noinspection PyPackageRequirements
    def checkAccessRights(self, uid, server, action):
        if not self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server]):
            return False

        serverInfos = self.db.getSomething("server", server)
        if serverInfos["owner"] == uid:
            return True

        userRights = self.getRights(server, uid)

        if action not in userRights:
            return False

        return True

    def getRights(self, serverId, uid):
        serverRoles = self.db.getAll("role", serverId, "server")
        # make a set of roles based on their ids
        serverRoles = {role["id"]: role for role in serverRoles}
        userRoles = self.db.getFilters("role_attribution", ["account", "=", uid, "and", "server", "=", serverId])
        userRights = {}

        for role in userRoles:
            if serverRoles[role["role"]]:
                for right in serverRoles[role["role"]]["permissions"]:
                    userRights[right] = right

        return userRights

    def _getChannelTable(self, channelType):
        """Map channel type string to table name."""
        tables = {
            "textual": "textual_channel",
            "conv": "textual_channel",
            "vocal": "vocal_channel",
            "drive": "drive_channel",
            "note": "notes_channel"
        }
        return tables.get(channelType)

    def checkChannelAccess(self, uid, channelId, channelType, action="view"):
        """Check if a user can perform an action on a channel.
        For non-private channels, all server members have access.
        For private channels, only users whose roles have the permission (or server owner/admin) can access.
        """
        table = self._getChannelTable(channelType)
        if not table:
            return False

        chan = self.db.getSomething(table, channelId)
        if not chan:
            return False

        serverId = chan["server"]

        # Check server membership
        if not self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", serverId]):
            return False

        # Non-private channels: all server members have access
        if not chan.get("is_private"):
            return True

        # Server owner always has access
        serverInfos = self.db.getSomething("server", serverId)
        if serverInfos["owner"] == uid:
            return True

        # Server-admin role holders have access
        userRights = self.getRights(serverId, uid)
        if "server-admin" in userRights:
            return True

        # Check channel_permission for user's roles
        userRoles = self.db.getFilters("role_attribution", ["account", "=", uid, "and", "server", "=", serverId])
        for userRole in userRoles:
            perms = self.db.getFilters("channel_permission", [
                "channel", "=", channelId, "and",
                "channel_type", "=", channelType, "and",
                "role", "=", userRole["role"]
            ])
            if perms:
                rolePerms = perms[0].get("permissions", {})
                if isinstance(rolePerms, str):
                    rolePerms = json.loads(rolePerms)
                if action in rolePerms:
                    return True

        return False

    def _getChannelType(self, channelId):
        """Detect channel type from its ID by checking all channel tables."""
        for ctype, table in [("textual", "textual_channel"), ("drive", "drive_channel"), ("vocal", "vocal_channel"), ("note", "notes_channel")]:
            chan = self.db.getSomething(table, channelId)
            if chan:
                return ctype, chan
        return None, None

    @Server.expose
    def edit_channel_permissions(self, channelId, channelType, action, roleId=None, permission=None, value=None):
        """Manage channel privacy and per-role channel permissions.
        Actions:
            togglePrivacy - toggle is_private on the channel
            addRole - add a role to the channel's allowed roles
            removeRole - remove a role from the channel's allowed roles
            editPermission - toggle a specific permission for a role on this channel
        """
        uid = self.getUser()

        table = self._getChannelTable(channelType)
        if not table:
            raise HTTPError(self.response, 400, "invalid channel type")

        chan = self.db.getSomething(table, channelId)
        if not chan:
            raise HTTPError(self.response, 404, "channel not found")

        serverId = chan["server"]
        if not self.checkAccessRights(uid, serverId, "server-admin"):
            raise HTTPError(self.response, 403, "forbidden")

        if action == "togglePrivacy":
            newValue = not chan.get("is_private", False)
            self.db.edit(table, channelId, "is_private", newValue)
            return json.dumps({"is_private": newValue})

        elif action == "addRole":
            if not roleId:
                raise HTTPError(self.response, 400, "roleId required")
            # Check role belongs to this server
            role = self.db.getSomething("role", roleId)
            if not role or role["server"] != int(serverId):
                raise HTTPError(self.response, 403, "role not in server")
            # Check if already exists
            existing = self.db.getFilters("channel_permission", [
                "channel", "=", channelId, "and",
                "channel_type", "=", channelType, "and",
                "role", "=", roleId
            ])
            if existing:
                return json.dumps(existing[0], default=str)
            permId = self.db.insertDict("channel_permission", {
                "channel": channelId,
                "channel_type": channelType,
                "role": roleId,
                "server": serverId,
                "permissions": json.dumps({"view": "", "send-messages": ""})
            }, getId=True)
            perm = self.db.getSomething("channel_permission", permId)
            return json.dumps(perm, default=str)

        elif action == "removeRole":
            if not roleId:
                raise HTTPError(self.response, 400, "roleId required")
            existing = self.db.getFilters("channel_permission", [
                "channel", "=", channelId, "and",
                "channel_type", "=", channelType, "and",
                "role", "=", roleId
            ])
            if existing:
                self.db.deleteSomething("channel_permission", existing[0]["id"])
            return json.dumps({"success": True})

        elif action == "editPermission":
            if not roleId or not permission:
                raise HTTPError(self.response, 400, "roleId and permission required")
            existing = self.db.getFilters("channel_permission", [
                "channel", "=", channelId, "and",
                "channel_type", "=", channelType, "and",
                "role", "=", roleId
            ])
            if not existing:
                raise HTTPError(self.response, 404, "role not added to channel")
            perms = existing[0].get("permissions", {})
            if isinstance(perms, str):
                perms = json.loads(perms)
            if value == "true":
                perms[permission] = ""
            else:
                perms.pop(permission, None)
            self.db.edit("channel_permission", existing[0]["id"], "permissions", json.dumps(perms))
            return json.dumps({"permissions": perms})

        raise HTTPError(self.response, 400, "invalid action")

    @Server.expose
    def get_channel_permissions(self, channelId, channelType):
        """Get all channel_permission rows for a specific channel."""
        uid = self.getUser()

        table = self._getChannelTable(channelType)
        if not table:
            raise HTTPError(self.response, 400, "invalid channel type")

        chan = self.db.getSomething(table, channelId)
        if not chan:
            raise HTTPError(self.response, 404, "channel not found")

        serverId = chan["server"]
        if not self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", serverId]):
            raise HTTPError(self.response, 403, "forbidden")

        perms = self.db.getFilters("channel_permission", [
            "channel", "=", channelId, "and",
            "channel_type", "=", channelType
        ])
        return json.dumps(perms or [], default=str)

    @Server.expose
    def create_server_emoji(self, server_id, name, value):
        uid = self.getUser()
        if not self.checkAccessRights(uid, server_id, "edit"):
            raise HTTPError(self.response, 403)
        existing = self.db.getAll("server_emoji", server_id, "server")
        if len(existing) >= 20:
            return json.dumps({"error": "max_emojis"})
        filename = self.saveFile(value)
        emoji_id = self.db.insertDict("server_emoji", {
            "server": int(server_id),
            "name": name,
            "file": filename
        }, getId=True)
        emoji = self.db.getSomething("server_emoji", emoji_id)
        return json.dumps(emoji, default=str)

    @Server.expose
    def delete_server_emoji(self, emoji_id):
        uid = self.getUser()
        emoji = self.db.getSomething("server_emoji", emoji_id)
        if not emoji:
            raise HTTPError(self.response, 404)
        if not self.checkAccessRights(uid, emoji["server"], "edit"):
            raise HTTPError(self.response, 403)
        self.db.deleteSomething("server_emoji", emoji_id)
        return json.dumps({"status": "ok"})

    @Server.expose
    def get_custom_emoji(self, emoji_id):
        """Returns public emoji metadata so users outside the server can display it."""
        uid = self.getUser()
        emoji = self.db.getSomething("server_emoji", emoji_id)
        if not emoji:
            raise HTTPError(self.response, 404)
        return json.dumps({"id": emoji["id"], "name": emoji["name"], "file": emoji["file"]}, default=str)

    @Server.expose
    def edit_server_property(self, server_id, property, value=None):
        uid = self.getUser()
        forbidden_fields = ["id", "owner", "is_featured", "member_count"]
        if property in forbidden_fields or not self.checkAccessRights(uid, server_id, "edit"):
            raise HTTPError(self.response, 403)

        if property == "name":
            self.db.edit("server", server_id, property, value)
        elif property == "pfp":
            filename = self.saveFile(value)
            self.db.edit("server", server_id, "pfp", filename)
            return json.dumps({"pfp": filename}, default=str)
        elif property == "is_community":
            server = self.db.getSomething("server", server_id)
            if server["owner"] != uid:
                raise HTTPError(self.response, 403, "Only server owner can change community status")
            self.db.edit("server", server_id, "is_community", value == "true")
        elif property == "tags":
            tags = json.loads(value) if isinstance(value, str) else value
            self.db.edit("server", server_id, "tags", json.dumps(tags))
        elif property == "languages":
            languages = json.loads(value) if isinstance(value, str) else value
            self.db.edit("server", server_id, "languages", json.dumps(languages))
        elif property == "description":
            self.db.edit("server", server_id, "description", value)
        return json.dumps({"status": "ok"})

    @Server.expose
    def edit_server_channel(self, server_id, action="edit", field=None, value=None, targetId=None, channel_type=None):
        uid = self.getUser()
        if not self.checkAccessRights(uid, server_id, "edit"):
            raise HTTPError(self.response, 403)

        if action == "create":
            channel_type = channel_type if channel_type else "textual"
            table = self._getChannelTable(channel_type) or "textual_channel"

            defaults = {"server": server_id}
            if channel_type == "vocal":
                defaults["name"] = "Salon vocal"
            elif channel_type == "drive":
                defaults["name"] = "new storage"
            elif channel_type == "note":
                defaults["name"] = "new note"
            else:
                defaults["name"] = "new channel"

            channel_id = self.db.insertDict(table, defaults, getId=True)
            channel = self.db.getSomething(table, channel_id)
            return json.dumps({"channel": channel, "type": channel_type}, default=str)

        table_name = self._getChannelTable(channel_type) or "textual_channel"
        chan = self.db.getSomething(table_name, targetId)
        if chan and chan["server"] == int(server_id):
            if action == "delete":
                self.db.deleteSomething(table_name, targetId)
                return json.dumps({"status": "ok"})
            allowed_channel_fields = ("name", "place", "category")
            if field not in allowed_channel_fields:
                raise HTTPError(self.response, 400, "invalid field for channel")
            if field == "category":
                value = int(value) if value else None
            elif field == "place":
                value = float(value)
            self.db.edit(table_name, targetId, field, value)
            return json.dumps({"status": "ok"})

        raise HTTPError(self.response, 403, "forbidden")

    @Server.expose
    def edit_server_category(self, server_id, action, field=None, value=None, targetId=None):
        uid = self.getUser()
        if not self.checkAccessRights(uid, server_id, "edit"):
            raise HTTPError(self.response, 403)

        if action == "create":
            cat_id = self.db.insertDict("server_cat", {"name": "New Category", "server": server_id}, getId=True)
            cat = self.db.getSomething("server_cat", cat_id)
            return json.dumps(cat, default=str)

        cat = self.db.getSomething("server_cat", targetId)
        if not cat or cat["server"] != int(server_id):
            raise HTTPError(self.response, 403, "forbidden")

        if action == "delete":
            for table in ["textual_channel", "vocal_channel", "drive_channel", "notes_channel"]:
                channels = self.db.getFilters(table, ["category", "=", targetId])
                for ch in channels:
                    self.db.edit(table, ch["id"], "category", None)
            self.db.deleteSomething("server_cat", targetId)
            return json.dumps({"status": "ok"})

        if field in ("name", "place"):
            val = float(value) if field == "place" else value
            self.db.edit("server_cat", targetId, field, val)
            return json.dumps({"status": "ok"})

        raise HTTPError(self.response, 400, "invalid field for category")

    @Server.expose
    def edit_server_role(self, server_id, action, field=None, value=None, targetId=None):
        uid = self.getUser()
        if not self.checkAccessRights(uid, server_id, "edit"):
            raise HTTPError(self.response, 403)

        if action == "create":
            role_id = self.db.insertDict("role", {"name": "new role", "server": server_id}, getId=True)
            return json.dumps({"id": role_id})

        role = self.db.getSomething("role", targetId)
        if not role or role["server"] != int(server_id) or field == "server":
            raise HTTPError(self.response, 403)

        if action == "delete":
            self.db.deleteSomething("role", targetId)
            return json.dumps({"status": "ok"})

        if action == "attribute":
            if self.db.getFilters("role_attribution", ["account", "=", value, "and", "role", "=", targetId, "and", "server", "=", server_id]):
                raise HTTPError(self.response, 403, "already attributed")
            self.db.insertDict("role_attribution", {"account": value, "role": targetId, "server": server_id}, getId=True)
            self.invalidateAdminCache()
            return json.dumps({"status": "ok"})

        if field == "permissions":
            permissions = json.loads(value)
            serv_op = self.db.getSomething("op_servs", server_id, "server")
            if permissions.get("mycelium-admin") is not None and serv_op == []:
                raise HTTPError(self.response, 403)

        self.db.edit("role", targetId, field, value)
        self.invalidateAdminCache()
        return json.dumps({"status": "ok"})

    @Server.expose
    def save_block(self, channel, block, op="edit"):
        uid = self.getUser()

        chan_info = self.db.getSomething("notes_channel", channel)
        if not chan_info:
            raise HTTPError(self.response, 404)

        server_id = chan_info["server"]
        if not self.checkAccessRights(uid, server_id, "edit"):
            raise HTTPError(self.response, 403)

        block = json.loads(block)
        if op == "create":
            block["channel"] = channel
            block_id = self.db.insertDict("note_block", block, getId=True)

            # Auto-create note_database for database-type blocks
            if block.get("type") == "database" and block.get("uuid"):
                existing = self.db.getSomething("note_database", block["uuid"], "block_uuid")
                if not existing:
                    db_id = self.db.insertDict("note_database", {
                        "block_uuid": block["uuid"],
                        "channel": channel,
                        "name": "Untitled Database",
                        "view_type": "table"
                    }, getId=True)
                    self.db.insertDict("note_database_column", {
                        "database_id": db_id,
                        "name": "Name",
                        "type": "text",
                        "position": 0.1
                    })
                    self.db.insertDict("note_database_row", {
                        "database_id": db_id,
                        "position": 0.1
                    })
            if block.get("type") == "spreadsheet" and block.get("uuid"):
                existing = self.db.getSomething("note_spreadsheet", block["uuid"], "block_uuid")
                if not existing:
                    self.db.insertDict("note_spreadsheet", {
                        "block_uuid": block["uuid"],
                        "channel": channel,
                        "rows": 3,
                        "cols": 2
                    })

            return str(block_id)
        elif op == "delete":
            block_info = self.db.getSomething("note_block", str(block["uuid"]), "uuid")
            if not block_info or int(block_info["channel"]) != int(channel):
                raise HTTPError(self.response, 404)
            self.db.deleteSomething("note_block", block_info["id"])
        elif op == "edit":
            block_info = self.db.getSomething("note_block", str(block["uuid"]), "uuid")

            if not block_info:
                raise HTTPError(self.response, 404)

            forbidden_fields = ["id", "channel", "uuid"]

            for key in block:
                if key not in forbidden_fields and block[key] != block_info.get(key):
                    self.db.edit("note_block", block["uuid"], key, block[key], "uuid")

            # Auto-create note_database when block type changes to "database"
            if block.get("type") == "database" and block_info.get("type") != "database":
                existing = self.db.getSomething("note_database", block["uuid"], "block_uuid")
                if not existing:
                    db_id = self.db.insertDict("note_database", {
                        "block_uuid": block["uuid"],
                        "channel": channel,
                        "name": "Untitled Database",
                        "view_type": "table"
                    }, getId=True)
                    self.db.insertDict("note_database_column", {
                        "database_id": db_id,
                        "name": "Name",
                        "type": "text",
                        "position": 0.1
                    })
                    self.db.insertDict("note_database_row", {
                        "database_id": db_id,
                        "position": 0.1
                    })
            # Auto-create note_spreadsheet when block type changes to "spreadsheet"
            if block.get("type") == "spreadsheet" and block_info.get("type") != "spreadsheet":
                existing = self.db.getSomething("note_spreadsheet", block["uuid"], "block_uuid")
                if not existing:
                    self.db.insertDict("note_spreadsheet", {
                        "block_uuid": block["uuid"],
                        "channel": channel,
                        "rows": 3,
                        "cols": 2
                    })

    def _checkDatabaseAccess(self, uid, channel):
        """Check that user has edit access to a notes channel. Returns server_id or raises."""
        chan_info = self.db.getSomething("notes_channel", channel)
        if not chan_info:
            raise HTTPError(self.response, 404)
        server_id = chan_info["server"]
        if not self.checkAccessRights(uid, server_id, "edit"):
            raise HTTPError(self.response, 403)
        return server_id

    def _checkConvAccess(self, uid, conv_id):
        """Check that user can access the place (DM conv or textual channel). Returns conv_id as int or raises."""
        cid = int(conv_id)
        # DM / group conversation
        access = self.db.getFilters(
            "accessconversation",
            ["conversation", "=", cid, "and", "account", "=", uid]
        )
        if access:
            return cid
        # Server textual channel — any member of the server with view permission
        if self.checkChannelAccess(uid, cid, "textual", "view"):
            return cid
        raise HTTPError(self.response, 403)

    @Server.expose
    def get_database_content(self, channel, block_uuid):
        uid = self.getUser()
        chan_info = self.db.getSomething("notes_channel", channel)
        if not chan_info:
            raise HTTPError(self.response, 404)
        server_id = chan_info["server"]
        if not self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id]):
            raise HTTPError(self.response, 403)

        db_info = self.db.getSomething("note_database", block_uuid, "block_uuid")
        if not db_info:
            raise HTTPError(self.response, 404)

        db_id = db_info["id"]
        columns = self.db.getFilters("note_database_column", ["database_id", "=", db_id, "order by position"]) or []
        rows = self.db.getFilters("note_database_row", ["database_id", "=", db_id, "order by position"]) or []

        cells = {}
        for row in rows:
            row_cells = self.db.getFilters("note_database_cell", ["row_id", "=", row["id"]]) or []
            cells[str(row["id"])] = {str(c["column_id"]): c["value"] for c in row_cells}

        result = {
            "id": db_id,
            "block_uuid": db_info["block_uuid"],
            "name": db_info["name"],
            "view_type": db_info.get("view_type", "table"),
            "gallery_cover_column": db_info.get("gallery_cover_column"),
            "columns": columns,
            "rows": rows,
            "cells": cells
        }
        return json.dumps(result, default=str)

    @Server.expose
    def get_spreadsheet_content(self, block_uuid, channel=None, conv_id=None):
        uid = self.getUser()
        if conv_id is not None:
            self._checkConvAccess(uid, conv_id)
        elif channel is not None:
            chan_info = self.db.getSomething("notes_channel", channel)
            if not chan_info:
                raise HTTPError(self.response, 404)
            server_id = chan_info["server"]
            if not self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id]):
                raise HTTPError(self.response, 403)
        else:
            raise HTTPError(self.response, 400)

        sheet_info = self.db.getSomething("note_spreadsheet", block_uuid, "block_uuid")
        if not sheet_info:
            raise HTTPError(self.response, 404)
        if conv_id is not None and str(sheet_info.get("conv_id")) != str(conv_id):
            raise HTTPError(self.response, 404)

        sheet_id = sheet_info["id"]
        cells_data = self.db.getFilters("note_spreadsheet_cell", ["spreadsheet_id", "=", sheet_id]) or []
        cells = {self._sheet_ref(c["col_idx"], c["row_idx"]): c["value"] for c in cells_data}
        col_widths = self._get_sheet_col_widths(sheet_id)

        result = {
            "id": sheet_id,
            "block_uuid": sheet_info["block_uuid"],
            "rows": sheet_info["rows"],
            "cols": sheet_info["cols"],
            "cells": cells,
            "col_widths": col_widths,
        }
        return json.dumps(result, default=str)

    @Server.expose
    def get_spreadsheet_snapshot(self, channel, block_uuid):
        uid = self.getUser()
        chan_info = self.db.getSomething("notes_channel", channel)
        if not chan_info:
            raise HTTPError(self.response, 404)
        server_id = chan_info["server"]
        if not self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id]):
            raise HTTPError(self.response, 403)

        sheet_info = self.db.getSomething("note_spreadsheet", block_uuid, "block_uuid")
        if not sheet_info or int(sheet_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)

        cells_data = self.db.getFilters("note_spreadsheet_cell", ["spreadsheet_id", "=", sheet_info["id"]]) or []
        cells = {self._sheet_ref(c["col_idx"], c["row_idx"]): c["value"] for c in cells_data}

        return json.dumps({
            "id": sheet_info["id"],
            "block_uuid": sheet_info["block_uuid"],
            "rows": sheet_info["rows"],
            "cols": sheet_info["cols"],
            "cells": cells,
        }, default=str)

    @Server.expose
    def save_spreadsheet_cell(self, spreadsheet_id, cell_id, value, channel=None, conv_id=None):
        uid = self.getUser()
        sheet_info = self._get_sheet_info(uid, spreadsheet_id, channel=channel, conv_id=conv_id)

        if value is None:
            value = ""
        elif isinstance(value, str) and value.strip() == "":
            value = ""

        parsed = self._parse_sheet_ref(cell_id)
        if not parsed:
            raise HTTPError(self.response, 400)

        row_idx = parsed["row"]
        col_idx = parsed["col"]
        if row_idx < 1 or row_idx > int(sheet_info["rows"]) or col_idx < 0 or col_idx >= int(sheet_info["cols"]):
            raise HTTPError(self.response, 400)

        existing = self.db.getFilters(
            "note_spreadsheet_cell",
            ["spreadsheet_id", "=", spreadsheet_id, "and", "row_idx", "=", row_idx, "and", "col_idx", "=", col_idx]
        )
        if existing:
            if value == "":
                self.db.deleteSomething("note_spreadsheet_cell", existing[0]["id"])
            else:
                self.db.edit("note_spreadsheet_cell", existing[0]["id"], "value", value)
        else:
            if value != "":
                self.db.insertDict("note_spreadsheet_cell", {
                    "spreadsheet_id": spreadsheet_id,
                    "row_idx": row_idx,
                    "col_idx": col_idx,
                    "value": value
                })

    @Server.expose
    def save_spreadsheet(self, spreadsheet_id, data, channel=None, conv_id=None):
        uid = self.getUser()

        try:
            data = json.loads(data)
        except Exception:
            raise HTTPError(self.response, 400)

        if not isinstance(data, dict):
            raise HTTPError(self.response, 400)

        sheet_info = self._get_sheet_info(uid, spreadsheet_id, channel=channel, conv_id=conv_id)

        limits = {
            "rows": (1, 500),
            "cols": (1, 200),
        }

        for key, (min_val, max_val) in limits.items():
            if key not in data:
                continue

            try:
                value = int(data[key])
            except Exception:
                raise HTTPError(self.response, 400)

            if value < min_val or value > max_val:
                raise HTTPError(self.response, 400)

            if value != int(sheet_info.get(key)):
                self.db.edit("note_spreadsheet", spreadsheet_id, key, value)

    def _get_sheet_col_widths(self, spreadsheet_id):
        rows = self.db.getFilters("note_spreadsheet_col", ["spreadsheet_id", "=", spreadsheet_id]) or []
        return {str(r["col_idx"]): int(r["width_px"]) for r in rows}

    def _get_sheet_info(self, uid, spreadsheet_id, channel=None, conv_id=None):
        """Auth-check and load note_spreadsheet row by ID. Raises on bad access or ownership mismatch."""
        if conv_id is not None:
            self._checkConvAccess(uid, conv_id)
            sheet_info = self.db.getSomething("note_spreadsheet", spreadsheet_id)
            if not sheet_info or str(sheet_info.get("conv_id")) != str(conv_id):
                raise HTTPError(self.response, 404)
        elif channel is not None:
            self._checkDatabaseAccess(uid, channel)
            sheet_info = self.db.getSomething("note_spreadsheet", spreadsheet_id)
            if not sheet_info or int(sheet_info.get("channel", -1)) != int(channel):
                raise HTTPError(self.response, 404)
        else:
            raise HTTPError(self.response, 400)
        return sheet_info

    @Server.expose
    def save_spreadsheet_col_width(self, spreadsheet_id, col_idx, width, channel=None, conv_id=None):
        uid = self.getUser()
        sheet_info = self._get_sheet_info(uid, spreadsheet_id, channel=channel, conv_id=conv_id)

        col_idx = int(col_idx)
        width = int(width)
        if col_idx < 0 or col_idx >= int(sheet_info["cols"]):
            raise HTTPError(self.response, 400)
        if width < 40 or width > 1200:
            raise HTTPError(self.response, 400)

        existing = self.db.getFilters(
            "note_spreadsheet_col",
            ["spreadsheet_id", "=", spreadsheet_id, "and", "col_idx", "=", col_idx]
        )
        if existing:
            self.db.edit("note_spreadsheet_col", existing[0]["id"], "width_px", width)
        else:
            self.db.insertDict("note_spreadsheet_col", {
                "spreadsheet_id": spreadsheet_id,
                "col_idx": col_idx,
                "width_px": width,
            })
        return json.dumps({"ok": True})

    def _parse_sheet_ref(self, cell_id):
        m = re.match(r"^([A-Z]+)(\d+)$", str(cell_id or ""))
        if not m:
            return None

        letters = m.group(1)
        row_num = int(m.group(2))
        if row_num < 1:
            return None
        col_idx = 0
        for ch in letters:
            col_idx = col_idx * 26 + (ord(ch) - 64)
        return {"col": col_idx - 1, "row": row_num}

    def _sheet_ref(self, col_idx, row_num):
        col = int(col_idx)
        letters = ""
        while col >= 0:
            letters = chr(65 + (col % 26)) + letters
            col = (col // 26) - 1
        return f"{letters}{int(row_num)}"

    @Server.expose
    def save_spreadsheet_structure(self, spreadsheet_id, op, ref, channel=None, conv_id=None):
        uid = self.getUser()
        sheet_info = self._get_sheet_info(uid, spreadsheet_id, channel=channel, conv_id=conv_id)

        parsed = self._parse_sheet_ref(ref)
        if not parsed:
            raise HTTPError(self.response, 400)

        rows = int(sheet_info["rows"])
        cols = int(sheet_info["cols"])
        if parsed["row"] < 1 or parsed["row"] > rows or parsed["col"] < 0 or parsed["col"] >= cols:
            raise HTTPError(self.response, 400)

        insert_col = None
        insert_row = None
        delete_col = None
        delete_row = None

        if op == "add-col-left":
            insert_col = parsed["col"]
            cols += 1
        elif op == "add-col-right":
            insert_col = parsed["col"] + 1
            cols += 1
        elif op == "add-row-top":
            insert_row = parsed["row"]
            rows += 1
        elif op == "add-row-bottom":
            insert_row = parsed["row"] + 1
            rows += 1
        elif op == "delete-col":
            if cols <= 1:
                raise HTTPError(self.response, 400)
            delete_col = parsed["col"]
            cols -= 1
        elif op == "delete-row":
            if rows <= 1:
                raise HTTPError(self.response, 400)
            delete_row = parsed["row"]
            rows -= 1
        else:
            raise HTTPError(self.response, 400)

        existing = self.db.getFilters("note_spreadsheet_cell", ["spreadsheet_id", "=", spreadsheet_id]) or []
        shifted = []
        col_width_rows = self.db.getFilters("note_spreadsheet_col", ["spreadsheet_id", "=", spreadsheet_id]) or []

        for cell in existing:
            c = int(cell.get("col_idx"))
            r = int(cell.get("row_idx"))

            if insert_col is not None and c >= insert_col:
                c += 1
            if insert_row is not None and r >= insert_row:
                r += 1

            if delete_col is not None:
                if c == delete_col:
                    continue
                if c > delete_col:
                    c -= 1

            if delete_row is not None:
                if r == delete_row:
                    continue
                if r > delete_row:
                    r -= 1

            shifted.append({"col_idx": c, "row_idx": r, "value": cell.get("value", "")})

        # Rewrite cells to avoid UNIQUE collisions while shifting coordinates.
        for cell in existing:
            self.db.deleteSomething("note_spreadsheet_cell", cell["id"])

        for cell in shifted:
            value = cell.get("value", "")
            if value == "":
                continue
            self.db.insertDict("note_spreadsheet_cell", {
                "spreadsheet_id": spreadsheet_id,
                "row_idx": cell["row_idx"],
                "col_idx": cell["col_idx"],
                "value": value
            })

        # Shift persisted column widths on column insert/delete.
        if insert_col is not None or delete_col is not None:
            width_map = {}
            for row in col_width_rows:
                idx = int(row["col_idx"])
                width_map[idx] = int(row["width_px"])

            shifted_widths = {}
            for idx, width in width_map.items():
                next_idx = idx
                if insert_col is not None and next_idx >= insert_col:
                    next_idx += 1
                if delete_col is not None:
                    if next_idx == delete_col:
                        continue
                    if next_idx > delete_col:
                        next_idx -= 1
                if 0 <= next_idx < cols:
                    shifted_widths[next_idx] = width

            if insert_col is not None and 0 <= insert_col < cols and insert_col not in shifted_widths:
                fallback = width_map.get(insert_col, width_map.get(insert_col - 1, 120))
                shifted_widths[insert_col] = fallback

            for row in col_width_rows:
                self.db.deleteSomething("note_spreadsheet_col", row["id"])

            for idx, width in shifted_widths.items():
                self.db.insertDict("note_spreadsheet_col", {
                    "spreadsheet_id": spreadsheet_id,
                    "col_idx": idx,
                    "width_px": width,
                })

        self.db.edit("note_spreadsheet", spreadsheet_id, "rows", rows)
        self.db.edit("note_spreadsheet", spreadsheet_id, "cols", cols)
        return json.dumps({"rows": rows, "cols": cols, "col_widths": self._get_sheet_col_widths(spreadsheet_id)})


    @Server.expose
    def save_database(self, channel, database, op="create"):
        uid = self.getUser()
        self._checkDatabaseAccess(uid, channel)
        database = json.loads(database)

        if op == "create":
            block_uuid = database.get("block_uuid")
            if not block_uuid:
                raise HTTPError(self.response, 400)
            # Idempotent: if database already exists for this block, return existing
            existing = self.db.getSomething("note_database", block_uuid, "block_uuid")
            if existing:
                return str(existing["id"])
            db_id = self.db.insertDict("note_database", {
                "block_uuid": block_uuid,
                "channel": channel,
                "name": database.get("name", "Untitled Database"),
                "view_type": database.get("view_type", "table")
            }, getId=True)
            # Create a default first column
            self.db.insertDict("note_database_column", {
                "database_id": db_id,
                "name": "Name",
                "type": "text",
                "position": 0.1
            })
            # Create a default first row
            self.db.insertDict("note_database_row", {
                "database_id": db_id,
                "position": 0.1
            })
            return str(db_id)
        elif op == "edit":
            db_info = self.db.getSomething("note_database", database["id"])
            if not db_info or int(db_info["channel"]) != int(channel):
                raise HTTPError(self.response, 404)
            allowed = ["name", "view_type", "gallery_cover_column"]
            for key in allowed:
                if key in database and database[key] != db_info.get(key):
                    self.db.edit("note_database", database["id"], key, database[key])
        elif op == "delete":
            db_info = self.db.getSomething("note_database", database["id"])
            if not db_info or int(db_info["channel"]) != int(channel):
                raise HTTPError(self.response, 404)
            self.db.deleteSomething("note_database", database["id"])

    @Server.expose
    def save_database_column(self, channel, database_id, column, op="create"):
        uid = self.getUser()
        self._checkDatabaseAccess(uid, channel)
        column = json.loads(column)

        db_info = self.db.getSomething("note_database", database_id)
        if not db_info or int(db_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)

        valid_types = ["text", "number", "checkbox", "date", "select", "relation", "formula"]

        if op == "create":
            col_type = column.get("type", "text")
            if col_type not in valid_types:
                raise HTTPError(self.response, 400)
            col_id = self.db.insertDict("note_database_column", {
                "database_id": database_id,
                "name": column.get("name", "Column"),
                "type": col_type,
                "position": column.get("position", 0.1),
                "options": json.dumps(column.get("options", {}))
            }, getId=True)
            return str(col_id)
        elif op == "edit":
            col_info = self.db.getSomething("note_database_column", column["id"])
            if not col_info or int(col_info["database_id"]) != int(database_id):
                raise HTTPError(self.response, 404)
            allowed = ["name", "type", "position", "options"]
            for key in allowed:
                if key in column:
                    val = column[key]
                    if key == "type" and val not in valid_types:
                        raise HTTPError(self.response, 400)
                    if key == "options":
                        val = json.dumps(val)
                    if str(val) != str(col_info.get(key)):
                        self.db.edit("note_database_column", column["id"], key, val)
        elif op == "delete":
            col_info = self.db.getSomething("note_database_column", column["id"])
            if not col_info or int(col_info["database_id"]) != int(database_id):
                raise HTTPError(self.response, 404)
            self.db.deleteSomething("note_database_column", column["id"])

    @Server.expose
    def save_database_row(self, channel, database_id, row, op="create"):
        uid = self.getUser()
        self._checkDatabaseAccess(uid, channel)
        row = json.loads(row)

        db_info = self.db.getSomething("note_database", database_id)
        if not db_info or int(db_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)

        if op == "create":
            row_id = self.db.insertDict("note_database_row", {
                "database_id": database_id,
                "position": row.get("position", 0.1)
            }, getId=True)
            return str(row_id)
        elif op == "edit":
            row_info = self.db.getSomething("note_database_row", row["id"])
            if not row_info or int(row_info["database_id"]) != int(database_id):
                raise HTTPError(self.response, 404)
            if "position" in row:
                self.db.edit("note_database_row", row["id"], "position", row["position"])
        elif op == "delete":
            row_info = self.db.getSomething("note_database_row", row["id"])
            if not row_info or int(row_info["database_id"]) != int(database_id):
                raise HTTPError(self.response, 404)
            self.db.deleteSomething("note_database_row", row["id"])

    @Server.expose
    def save_database_cell(self, channel, database_id, cell):
        uid = self.getUser()
        self._checkDatabaseAccess(uid, channel)
        cell = json.loads(cell)

        db_info = self.db.getSomething("note_database", database_id)
        if not db_info or int(db_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)

        row_id = cell["row_id"]
        column_id = cell["column_id"]
        value = cell.get("value", "")

        # Validate row belongs to this database
        row_info = self.db.getSomething("note_database_row", row_id)
        if not row_info or int(row_info["database_id"]) != int(database_id):
            raise HTTPError(self.response, 404)

        # Validate column belongs to this database
        col_info = self.db.getSomething("note_database_column", column_id)
        if not col_info or int(col_info["database_id"]) != int(database_id):
            raise HTTPError(self.response, 404)

        # For relation columns, validate target row exists
        if col_info["type"] == "relation":
            options = col_info.get("options", {})
            if isinstance(options, str):
                options = json.loads(options)
            target_db_id = options.get("database_id")
            if target_db_id and value:
                target_row = self.db.getSomething("note_database_row", value)
                if not target_row or int(target_row["database_id"]) != int(target_db_id):
                    raise HTTPError(self.response, 400)

        # Upsert: try update, then insert
        existing = self.db.getFilters("note_database_cell", ["row_id", "=", row_id, "and", "column_id", "=", column_id])
        if existing:
            self.db.edit("note_database_cell", existing[0]["id"], "value", value)
        else:
            self.db.insertDict("note_database_cell", {
                "row_id": row_id,
                "column_id": column_id,
                "value": value
            })

    @Server.expose
    def get_relation_display(self, database_id, row_id):
        """Get the display name (first text column value) for a row in a database."""
        uid = self.getUser()
        db_info = self.db.getSomething("note_database", database_id)
        if not db_info:
            raise HTTPError(self.response, 404)

        chan_info = self.db.getSomething("notes_channel", db_info["channel"])
        if not chan_info:
            raise HTTPError(self.response, 404)
        server_id = chan_info["server"]
        if not self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id]):
            raise HTTPError(self.response, 403)

        # Find first text column
        columns = self.db.getFilters("note_database_column", ["database_id", "=", database_id, "order by position"]) or []
        text_col = None
        for col in columns:
            if col["type"] == "text":
                text_col = col
                break

        if not text_col:
            return json.dumps({"display": "Row " + str(row_id)})

        cell = self.db.getFilters("note_database_cell", ["row_id", "=", row_id, "and", "column_id", "=", text_col["id"]]) or []
        display = cell[0]["value"] if cell else ""
        return json.dumps({"display": display or "Untitled"}, default=str)

    @Server.expose
    def server_display(self, invite):
        server = self.db.getSomething("invitation", invite, "link")
        if server:
            details = self.db.getSomething("server", server["server"])
            return details["name"]
        else:
            raise HTTPError(self.response, 404, "Not Found")

    @Server.expose
    def create_invitation(self, server_id, pref=None):
        uid = self.getUser()
        res = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server_id])
        if not res or res == []:
            raise HTTPError(self.response, 403, "forbidden")

        res = self.db.getSomething("invitation", server_id, "server")
        if res and res != [] and res["expiration"] > datetime.datetime.now():
            return res["link"]

        if not pref:
            id = ''.join(random.sample(B62, 8))

            while 1:
                if self.db.getSomething("invitation",id,"link"):
                    id = ''.join(random.sample(B62, 8))
                else:
                    self.db.insertDict("invitation",{"link": id,"server":server_id,"expiration":datetime.datetime.now() + datetime.timedelta(days=7)})
                    return id
        else:
            id=pref
            while 1:
                if self.db.getSomething("invitation",id,"link"):
                    id = pref + ''.join(random.sample(B62, 3))
                else :
                    self.db.insertDict("invitation",{"link": id,"server":server_id,"expiration":datetime.datetime.now() + datetime.timedelta(days=7)})
                    return id

    @Server.expose
    def join_server(self, invite_code):
        uid = self.getUser()
        res = self.db.getSomething("invitation", invite_code, "link")
        if res and res != []:
            if res["expiration"] < datetime.datetime.now():
                raise HTTPError(self.response, 403, "forbidden")
            if self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", res["server"]]):
                raise HTTPError(self.response, 403, "you're already in this server")
            self.db.insertDict("accessserver", {"account": uid, "server": res["server"]})
            raise HTTPRedirect(self.response, "/channels")
        raise HTTPError(self.response, 404, "Not Found")


    @Server.expose
    def get_dashboard(self, server_id, service_id):
        uid = self.getUser()
        op = self.db.getSomething("op_servs", server_id, "server")
        if not op:
            raise HTTPError(self.response, 403, "forbidden")

        if not self.checkAccessRights(uid, server_id, "dashboard-read"):
            raise HTTPError(self.response, 403, "forbidden")

        #if mycelium get from self
        if service_id == "mycelium":
            self.db.cur.execute("SELECT COUNT(*) FROM mycelium_account", ())
            board = {"users": self.db.cur.fetchone()}
            return json.dumps(board, default=str)
        #if uniauth get from uniauth
        elif service_id == "uniauth":
            self.uniauth.cur.execute("SELECT COUNT(*) FROM account", ())
            board = {"users": self.uniauth.cur.fetchone()}
            return json.dumps(board, default=str)
        #else get from unibridge
        else:
            data = self.uniauth.getAll("unibridge", service_id, "source")
            if not data:
                raise HTTPError(self.response, 404, "Not Found")
            board = {}
            for i in range(0, len(data)):
                related = data[i].get("related_table")
                if related:
                    board[data[i]["name"]] = self.uniauth.getUnibridgeNotifs(related)
                else:
                    board[data[i]["name"]] = data[i]["value"]
            return json.dumps(board, default=str)

    @Server.expose
    def refresh_dashboard(self, service):
        uid = self.getUser()

        services = {"synapse": {"local": "http://locahost:9876/unibridgeRefresh",
                                "prod": "https://synapse.carbonlab.dev/unibridgeRefresh"}
                    }

        if service not in services:
            raise HTTPError(self.response, 404, "Not Found")

        if self.config.get("server", "debug") == "false":
            endpoint = services[service]["prod"]
        else:
            endpoint = services[service]["local"]

        try:
            response = requests.post(endpoint, timeout=10)
            if response.status_code == 200:
                return json.dumps({"status": "ok", "data": response.json()})
            else:
                return json.dumps({"status": "error", "code": response.status_code, "message": response.text})
        except requests.RequestException as e:
            return json.dumps({"status": "error", "message": str(e)})

    @Server.expose
    def create_personal_server(self, server_id):
        uid = self.getUser()
        server = self.db.getSomething("server", server_id)
        if not server or server["owner"] != uid:
            raise HTTPError(self.response, 403, "forbidden")

        if self.db.getSomething("personal_server", uid, "owner"):
            raise HTTPError(self.response, 403, "You already have a personal server")
        self.db.insertDict("personal_server", {"owner": uid, "server": server["id"]})

    @Server.expose
    def send_email(self, server_id, to, subject, body):
        uid = self.getUser()
        op = self.db.getSomething("op_servs", server_id, "server")
        if not op:
            raise HTTPError(self.response, 403, "forbidden")

        if not self.checkAccessRights(uid, server_id, "dashboard-read"):
            raise HTTPError(self.response, 403, "forbidden")



    @Server.expose
    def create_api_key(self, name="", permissions="[]"):
        """Create a new API key for the authenticated user."""
        uid = self.getUser()
        try:
            if isinstance(permissions, str):
                permissions_parsed = json.loads(permissions)
            else:
                permissions_parsed = permissions
        except Exception:
            permissions_parsed = []

        new_key = ''.join(random.choices(B62, k=40))
        while self.db.getSomething("api_key", new_key, "key"):
            new_key = ''.join(random.choices(B62, k=40))

        key_id = self.db.insertDict("api_key", {"key": new_key, "owner": uid, "name": name}, getId=True)
        created = datetime.datetime.now()

        resp = {"id": key_id, "name": name, "key": new_key, "created": str(created), "permissions": permissions_parsed}
        return json.dumps(resp)

    @Server.expose
    def revoke_api_key(self, key_id):
        """Revoke (delete) an API key by its id. Only the owner can revoke their key."""
        uid = self.getUser()
        keyrow = self.db.getSomething("api_key", key_id)
        if not keyrow:
            raise HTTPError(self.response, 404, "Not Found")
        if keyrow.get("owner") != uid:
            raise HTTPError(self.response, 403, "forbidden")

        self.db.deleteSomething("api_key", key_id)
        return json.dumps({"status": "ok"})

    @Server.expose
    def regenerate_api_key(self, key_id):
        """Generate a new key value for an existing API key entry. Only the owner may regenerate."""
        uid = self.getUser()
        keyrow = self.db.getSomething("api_key", key_id)
        if not keyrow:
            raise HTTPError(self.response, 404, "Not Found")
        if keyrow.get("owner") != uid:
            raise HTTPError(self.response, 403, "forbidden")

        new_key = ''.join(random.choices(B62, k=40))
        while self.db.getSomething("api_key", new_key, "key"):
            new_key = ''.join(random.choices(B62, k=40))

        self.db.edit("api_key", key_id, "key", new_key)
        return json.dumps({"key": new_key})

    @Server.expose
    def get_user_api_keys(self):
        """Return the API keys for the authenticated user."""
        uid = self.getUser()
        keys = self.db.getAll("api_key", uid, "owner")
        for k in keys:
            if 'key' in k:
                k.pop('key')
        return json.dumps(keys, default=str)

    def sendStatusUpdates(self, uid):
        query = "select active_client.id, userid, server, idle from active_client,subscription where (subscription.account = %s and active_client.id = subscription.client) OR (active_client.id = %s);"
        self.db.cur.execute(query, (uid, uid))
        r = self.db.cur.fetchall()
        for client in r:
            status = {"id":uid}
            if client["userid"] == uid:
                self.getUsersStatus([status],detailed=True)
            else :
                self.getUsersStatus([status])

            if status["status"].get("mode"):
                status["status"]["mode"] = int(status["status"]["mode"])

            self.sendNotification(client["userid"], {"type": "update_status" ,"content": status})

    async def sendStatusUpdatesAsync(self, uid):
        query = "select active_client.id, userid, server, idle from active_client,subscription where (subscription.account = %s and active_client.id = subscription.client) OR (active_client.id = %s);"
        self.db.cur.execute(query, (uid, uid))
        r = self.db.cur.fetchall()
        for client in r:
            status = {"id":uid}
            if client["userid"] == uid:
                self.getUsersStatus([status],detailed=True)
            else :
                self.getUsersStatus([status])

            await self.sendNotificationAsync(client["userid"], {"type": "update_status" ,"content": status})

    def getUsersStatus(self, users,detailed=False):
        #these requests could be batched
        for user in users:
            params = self.db.getSomething('status', user['id'])

            if not params:
                self.db.insertDict("status", {"id": user['id']})
                params = {"mode": 0}

            clients = self.db.getAll('active_client', user['id'], "userid")
            if not len(clients):
                if not detailed:
                    user['status'] = {'icon': 'spymode', 'text': "Offline"}
                    continue

            if params['mode'] == 0:
                idle = True
                for client in clients:
                    if not client['idle']:
                        idle = False
                if idle:
                    if detailed:
                        if not params['text']:
                            params['text'] = "Online"
                        user['status'] = {'icon': 'green', 'text': params['text'], 'emoji': params['emoji'], 'expiration': params['expiration'], 'mode': params['mode']}
                    else:
                        if not params['text']:
                            params['text'] = "Idle"
                        user['status'] = {'icon': 'orange', 'text': params['text'], 'emoji': params['emoji']}
                else:
                    if not params['text']:
                        params['text'] = "Online"
                    if detailed:
                        user['status'] = {'icon': 'green', 'text': params['text'], 'emoji': params['emoji'], 'expiration': params['expiration'], 'mode': params['mode']}
                    else:
                        user['status'] = {'icon': 'green', 'text': params['text'], 'emoji': params['emoji']}
            elif params['mode'] == 3:
                if detailed:
                    if not params['text']:
                        params['text'] = "Offline"
                    user['status'] = {'icon': 'spymode', 'text': params['text'], 'expiration': params['expiration'], 'mode': params['mode']}
                else:
                    user['status'] = {'icon': 'spymode', 'text': "Offline"}
            elif params['mode'] == 2:
                if not params['text']:
                    params['text'] = 'Do not Disturb'
                if detailed:
                    user['status'] = {'icon': 'RED', 'text': params['text'], 'emoji': params['emoji'], 'expiration': params['expiration'], 'mode': params['mode']}
                else:
                    user['status'] = {'icon': 'RED', 'text': params['text'], 'emoji': params['emoji']}
            elif params['mode'] == 1:
                if not params['text']:
                    params['text'] = 'Idle'
                if detailed:
                    user['status'] = {'icon': 'orange', 'text': params['text'], 'emoji': params['emoji'], 'expiration': params['expiration'], 'mode': params['mode']}
                else:
                    user['status'] = {'icon': 'orange', 'text': params['text'], 'emoji': params['emoji']}

REGEX_USERNAME = re.compile(r'^(?=.{3,}$)[a-zA-Z0-9_\-\.]*$')
server = Mycelium(path=PATH, configFile="/server.ini")