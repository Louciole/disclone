import urllib.parse
from unicodedata import category

from vesta import Server, HTTPError, HTTPRedirect
import json
import re
import signal
import string
import random
import datetime
import requests
import base64

# websockets imports
import asyncio
import websockets
import threading

from os.path import abspath, dirname
from callManager import CallManager

B62 = string.digits + string.ascii_letters
PATH = dirname(abspath(__file__))


class Mycelium(Server):
    features = {"websockets": True, "errors": {404: "/static/404.html"}}
    clients = []
    _admin_cache = None  # Cache for admin user IDs
    _admin_cache_time = None  # Last cache update time

    def __init__(self, *args, **kwargs):
        super().__init__(path=PATH, configFile="/server.ini", noStart=True)
        self.callManager = CallManager(self.db)
        self._refreshAdminCache()  # Initialize admin cache
        self.start()

    @Server.expose
    def index(self):
        return self.file(PATH + "/static/home/home.html")

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
                    members = self.db.getAll("accessconversation", data["conv"], "conversation")

                    for user in members:
                        if user["account"] != data["uid"]:
                            await self.sendNotificationAsync(user["account"], data)
                case "changeActivity":
                    if self.checkWSAuth(websocket,data["clientID"]):
                        self.db.edit("active_client", data["clientID"], "idle", data["idle"])
                        client = self.db.getSomething("active_client", data["clientID"])
                        await self.sendStatusUpdatesAsync(client["userid"])

                # ===== Gestion des appels WebRTC =====
                case "callStart":
                    # Démarrer un nouvel appel
                    if self.checkWSAuth(websocket, data["clientID"]):
                        client = self.db.getSomething("active_client", data["clientID"])
                        conv_id = data.get("conversation_id")
                        call_type = data.get("call_type", "audio")

                        # Vérifier que l'utilisateur a accès à la conversation
                        access = self.db.getFilters("accessconversation",
                            ["conversation", "=", conv_id, "and", "account", "=", client["userid"]])

                        if access:
                            call = self.callManager.create_call(conv_id, client["userid"], call_type)

                            # Notifier tous les membres de la conversation
                            members = self.db.getAll("accessconversation", conv_id, "conversation")

                            # DEBUG: Log conversation members
                            print(f"🔔 [call_started] Conv {conv_id}: {len(members)} members, initiated by user {client['userid']}")

                            for member in members:
                                member_id = member["account"]
                                print(f"   → Sending call_started to user {member_id}")

                                try:
                                    await self.sendNotificationAsync(member_id, {
                                        "type": "call_started",
                                        "content": call.to_dict()
                                    })
                                    print(f"   ✅ Sent call_started to user {member_id}")
                                except Exception as e:
                                    print(f"   ❌ Error sending to user {member_id}: {e}")

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
                                        "content": {"call_id": call_id}
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
    def createServer(self):
        account_id = self.getUser()
        server_id = self.db.insertDict('server', {'name': "New Server", "owner": account_id}, getId=True)
        self.db.insertDict('accessserver', {'account': account_id, 'server': server_id})
        textCatID = self.db.insertDict('server_cat', {'name': "salons textuels", 'server': server_id},getId=True)
        self.db.insertDict('server_cat', {'name': "salons vocaux", 'server': server_id})
        self.db.insertDict('textual_channel', {'name': "général", 'server': server_id, "category": textCatID})
        return str(server_id)

    @Server.expose
    def deleteServer(self, id):
        uid = self.getUser()
        if not self.checkAccessRights(uid, id, "server-admin"):
            raise HTTPError(self.response, 403, "forbidden")
        self.db.deleteSomething("server", id)
        raise HTTPRedirect(self.response, "/channels")

    @Server.expose
    def getUserServers(self):
        uid = self.getUser()
        servers = self.db.getSomethingProxied("server", "accessserver", "account", uid)
        return json.dumps(servers)

    @Server.expose
    def getDiscoverableServers(self, search=None, tags=None, languages=None):
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
    def joinCommunityServer(self, server_id):
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
    def getAvailableTags(self):
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
    def createConv(self, name, members, private=False):
        members = json.loads(members)
        return str(self.newConv(name, members, private))

    @Server.expose
    def editConv(self, element, value, id):
        uid = self.getUser()
        members = self.db.getAll("accessconversation", id, "conversation")
        for j in range(0, len(members)):
            if members[j]["account"] == uid:
                self.db.edit("conversation", id, element, value)

                for user in members:
                    self.sendNotification(user["account"], {"type": "edit_conv", "item":element,"id":id ,"content": value})

                return "ok"
        raise HTTPError(self.response, 403, "forbidden")

    @Server.expose
    def getUserConvs(self):
        uid = self.getUser()
        convs = self.db.getSomethingProxied("conversation", "accessconversation", "account", uid)
        for j in range(0, len(convs)):
            # TODO refactor, this is slow for no reason
            convs[j]["members"] = self.db.getFilters("accessconversation", ["conversation", "=", convs[j]["id"]])
            for i in range(0, len(convs[j]["members"])):
                convs[j]["members"][i] = convs[j]["members"][i]["account"]
        return json.dumps(convs)

    @Server.expose
    def getUsersInfo(self, users):
        uid = self.getUser()
        users = self.db.getFilters("mycelium_account", ["id", "in", json.loads(users)])
        self.getUsersStatus(users)
        return (json.dumps(users, default=str))


    @Server.expose
    def subscribe(self,client, cat, items):
        uid = self.getUser()
        client_infos = self.db.getSomething("active_client",client)
        if not client_infos or client_infos.get("userid") != uid:
            raise HTTPError(self.response,403, "forbidden")

        if cat=="user":
            users = self.db.getFilters("mycelium_account", ["id", "in", json.loads(items)])
            for user in users:
                self.db.insertDict("subscription", {"client":client,"account": user["id"]})

    @Server.expose
    def test(self):
        return self.file(PATH + "/.idea/test.html")

    @Server.expose
    def getConvContent(self, convId):
        uid = self.getUser()
        conv = self.db.getFilters("accessconversation", ["conversation", "=", convId, "and", "account", "=", uid])
        if conv:
            content = {}
            content["messages"] = self.db.getFilters("message", ["place", "=", convId, "order by timestamp"])
            return json.dumps(content, default=str)


    @Server.expose
    def startCall(self, conversation_id, call_type="audio"):
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
    def joinCall(self, call_id):
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
    def leaveCall(self, call_id):
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
    def getCallState(self, conversation_id):
        uid = self.getUser()

        access = self.db.getFilters("accessconversation", ["conversation", "=", conversation_id, "and", "account", "=", uid])

        if not access:
            raise HTTPError(self.response, 403, "Forbidden")

        call_state = self.callManager.get_call_state(int(conversation_id))

        if call_state:
            return json.dumps(call_state, default=str)

        return json.dumps({"active": False}, default=str)

    @Server.expose
    def getChanContent(self, convId):
        uid = self.getUser()
        chan = self.db.getSomething("textual_channel", convId)
        if not chan:
            raise HTTPError(self.response, 404, "Not Found")

        conv = self.db.getFilters("accessserver", ["server", "=", chan["server"], "and", "account", "=", uid])
        # TODO handle access rights
        if conv:
            content = {"name": chan["name"], "id": convId}
            content["messages"] = self.db.getFilters("message", ["place", "=", convId, "order by timestamp"])
            return json.dumps(content, default=str)

    @Server.expose
    def getNoteContent(self, id):
        uid = self.getUser()
        chan = self.db.getSomething("notes_channel", id)
        if not chan:
            raise HTTPError(self.response, 404, "Not Found")

        conv = self.db.getFilters("accessserver", ["server", "=", chan["server"], "and", "account", "=", uid])
        # TODO handle access rights
        if conv:
            content = {"name": chan["name"], "id": id}
            content["blocks"] = self.db.getFilters("note_block", ["channel", "=", id])
            return json.dumps(content, default=str)

    @Server.expose
    def getServContent(self, servID, channelID=None):
        uid = self.getUser()
        #TODO handle access rights
        serv = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", servID])
        if serv:
            content = {}
            if not channelID:
                content["channels"] = self.db.getAll("textual_channel", servID,"server")
                content["rooms"] = self.db.getAll("vocal_channel", servID,"server")
                content["drives"] = self.db.getAll("drive_channel", servID,"server")
                content["notes"] = self.db.getAll("notes_channel", servID,"server")
                # content["whiteboard"] = self.db.getAll("drive_channel", servID,"server")
                op = self.db.getSomething("op_servs", servID, "server")
                if op:
                    content["op"] = True
                content["cat"] = self.db.getAll("server_cat", servID,"server")
                content["roles"] = self.db.getAll("role", servID,"server")

                if self.db.getSomething("personal_server", uid, "owner"):
                    content["type"] = "personal"
                else:
                    content["type"] = "standard"

                content["members"] = self.db.getFilters("accessserver", ["server", "=", servID])
                for i in range(0, len(content["members"])):
                    userRoles = self.db.getFilters("role_attribution", ["server", "=", servID, "and", "account", "=", content["members"][i]["account"]])
                    for j in range (0,len(userRoles)):
                        userRoles[j] = userRoles[j]["role"]
                    content["members"][i] = {"id": content["members"][i]["account"], "roles": userRoles}
            else:
                content["messages"] = self.db.getFilters("message", ["place", "=", channelID, "order by timestamp"])
            return json.dumps(content, default=str)

    @Server.expose
    def getUserInfo(self):
        uid = self.getUser()
        user = self.db.getSomething("mycelium_account", uid)
        self.getUsersStatus([user],detailed=True)
        user["notifs"] = self.db.getAll("offline_notifs", uid, "account")
        user["additional_emails"] = self.uniauth.getAll("additional_mail", uid, "account")
        user["isAdmin"] = self.isAdmin(uid)
        return json.dumps(user, default=str)

    @Server.expose
    def getDebugOTP(self, email):
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
    def uploadImage(self):
        uid = self.getUser()
        user = self.db.getSomething("mycelium_account", uid)
        self.getUsersStatus([user],detailed=True)
        return json.dumps(user, default=str)

    @Server.expose
    def uploadDriveOnBehalf(self, API_KEY, email, filename, file):
        key = self.db.getSomething("api_key", API_KEY, "key")
        if not key:
            raise HTTPError(self.response, 403, "forbidden")

        key_user = self.db.getSomething("mycelium_account", key["owner"])
        if not key_user or not self.isAdmin(key_user["id"]):
            raise HTTPError(self.response, 403, "forbidden")

        user = self.uniauth.getUserCredentials(email)
        if not user:
            user =  self.uniauth.getSomething("additional_mail", email, "email")
            if not user:
                raise HTTPError(self.response, 403, "forbidden")
            uid = user["account"]
        else:
            uid = user["id"]

        print("Uploading file on behalf of user", uid, filename)
        personal_server = self.db.getSomething("personal_server", uid, "owner")
        if not personal_server:
            raise HTTPError(self.response, 403, "no personal server found")

        first_drive = self.db.getFilters("drive_channel", ["server", "=", personal_server["server"], "order by place asc limit 1"])
        if not first_drive or first_drive == []:
            raise HTTPError(self.response, 403, "no drive channel found")

        # Upload the file to the first drive channel
        self.uploadDrive(uid, first_drive[0]["id"], (filename, file))

    @Server.expose
    def uploadDriveFile(self, drive_id, filename, file, parent_folder=None):
        """
        Upload a file to a drive channel (authenticated user endpoint).

        Args:
            drive_id: ID of the drive channel
            filename: Name of the file
            file: Base64 encoded file content (with or without data URI prefix)
            parent_folder: Optional ID of parent folder

        Returns:
            JSON with file_id
        """
        uid = self.getUser()

        # Verify access to the drive channel
        drive = self.db.getSomething("drive_channel", drive_id)
        if not drive:
            raise HTTPError(self.response, 404, "Drive channel not found")

        # Check if user has access to the server
        access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", drive["server"]])
        if not access:
            raise HTTPError(self.response, 403, "No access to this drive")

        # If parent_folder is specified, verify it exists and belongs to the same drive
        if parent_folder and parent_folder != "null":
            parent_folder = int(parent_folder)
            parent = self.db.getSomething("drive_folder", parent_folder)
            if not parent or parent["drive_channel"] != int(drive_id):
                raise HTTPError(self.response, 404, "Parent folder not found or doesn't belong to this drive")
        else:
            parent_folder = None

        # Upload the file
        file_id = self.uploadDrive(uid, drive_id, (filename, file), parent_folder)
        return json.dumps({"file_id": file_id, "filename": filename})

    @Server.expose
    def getDriveFiles(self, drive_id, parent_folder=None):
        """
        Get all files in a drive channel (or within a parent folder).

        Args:
            drive_id: ID of the drive channel
            parent_folder: Optional ID of parent folder (None for root level)

        Returns:
            JSON list of files with metadata
        """
        uid = self.getUser()

        # Verify access to the drive channel
        drive = self.db.getSomething("drive_channel", drive_id)
        if not drive:
            raise HTTPError(self.response, 404, "Drive channel not found")

        # Check if user has access to the server
        access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", drive["server"]])
        if not access:
            raise HTTPError(self.response, 403, "No access to this drive")

        # Get files
        if parent_folder and parent_folder != "null":
            files = self.db.getAll("drive_file", int(parent_folder), "parent_folder")
        else:
            # Get root level files (where parent_folder is NULL)
            files = self.db.getFilters("drive_file", ["drive_channel", "=", drive_id, "and", "parent_folder", "is", None])

        if files == None:
            files = []

        # Add uploader info for each file
        for file in files:
            uploader = self.db.getSomething("mycelium_account", file["uploader"])
            if uploader:
                file["uploader_name"] = uploader["display"]
                file["uploader_username"] = uploader["username"]

        return json.dumps(files, default=str)

    @Server.expose
    def downloadDriveFile(self, file_id):
        """
        Download a file from a drive channel.

        Args:
            file_id: ID of the file in drive_file table

        Returns:
            The file content
        """
        uid = self.getUser()

        # Get file info
        file_info = self.db.getSomething("drive_file", file_id)
        if not file_info:
            raise HTTPError(self.response, 404, "File not found")

        # Get drive channel
        drive = self.db.getSomething("drive_channel", file_info["drive_channel"])
        if not drive:
            raise HTTPError(self.response, 404, "Drive channel not found")

        # Check if user has access to the server
        access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", drive["server"]])
        if not access:
            raise HTTPError(self.response, 403, "No access to this file")

        # Return the file as binary
        import os
        import mimetypes

        filepath = self.path + "/static/attachments/" + file_info["filepath"]

        if not os.path.exists(filepath):
            raise HTTPError(self.response, 404, "File not found on disk")

        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(file_info["filename"])
        if not mime_type:
            mime_type = "application/octet-stream"

        # Read file in binary mode
        with open(filepath, 'rb') as f:
            file_content = f.read()

        # Set proper headers for download
        self.response.headers.append(('Content-Type', mime_type))
        self.response.headers.append(('Content-Disposition', f'attachment; filename="{file_info["filename"]}"'))
        self.response.headers.append(('Content-Length', str(len(file_content))))


        return file_content

    @Server.expose
    def deleteDriveFile(self, file_id):
        """
        Delete a file from a drive channel.

        Args:
            file_id: ID of the file in drive_file table

        Returns:
            Success message
        """
        import os

        uid = self.getUser()

        # Get file info
        file_info = self.db.getSomething("drive_file", file_id)
        if not file_info:
            raise HTTPError(self.response, 404, "File not found")

        # Get drive channel
        drive = self.db.getSomething("drive_channel", file_info["drive_channel"])
        if not drive:
            raise HTTPError(self.response, 404, "Drive channel not found")

        # Check if user has access to the server
        access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", drive["server"]])
        if not access:
            raise HTTPError(self.response, 403, "No access to this file")

        # Only uploader or server owner can delete
        server_info = self.db.getSomething("server", drive["server"])
        if file_info["uploader"] != uid and server_info["owner"] != uid:
            # Check if user has admin/edit rights
            if not self.checkAccessRights(uid, drive["server"], "edit"):
                raise HTTPError(self.response, 403, "Only uploader or server admins can delete files")

        # Delete the physical file
        filepath = self.path + "/static/attachments/" + file_info["filepath"]
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except Exception as e:
            print(f"Error deleting file {filepath}: {e}")

        # Delete from database
        self.db.deleteSomething("drive_file", file_id)

        return json.dumps({"status": "ok", "message": "File deleted successfully"})

    @Server.expose
    def createDriveFolder(self, drive_id, foldername, parent_folder=None):
        """
        Create a folder in a drive channel.

        Args:
            drive_id: ID of the drive channel
            foldername: Name of the folder
            parent_folder: Optional ID of parent folder (None for root level)

        Returns:
            JSON with folder_id
        """
        uid = self.getUser()

        # Verify access to the drive channel
        drive = self.db.getSomething("drive_channel", drive_id)
        if not drive:
            raise HTTPError(self.response, 404, "Drive channel not found")

        # Check if user has access to the server
        access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", drive["server"]])
        if not access:
            raise HTTPError(self.response, 403, "No access to this drive")

        # If parent_folder is specified, verify it exists and belongs to the same drive
        if parent_folder and parent_folder != "null":
            parent_folder = int(parent_folder)
            parent = self.db.getSomething("drive_folder", parent_folder)
            if not parent or parent["drive_channel"] != int(drive_id):
                raise HTTPError(self.response, 404, "Parent folder not found or doesn't belong to this drive")
        else:
            parent_folder = None

        # Create the folder
        folder_id = self.db.insertDict("drive_folder", {
            "drive_channel": drive_id,
            "foldername": foldername,
            "parent_folder": parent_folder,
            "creator": uid
        }, getId=True)

        return json.dumps({"folder_id": folder_id, "foldername": foldername})

    @Server.expose
    def getDriveFolders(self, drive_id, parent_folder=None):
        """
        Get all folders in a drive channel (or within a parent folder).

        Args:
            drive_id: ID of the drive channel
            parent_folder: Optional ID of parent folder (None for root level)

        Returns:
            JSON list of folders with metadata
        """
        uid = self.getUser()

        # Verify access to the drive channel
        drive = self.db.getSomething("drive_channel", drive_id)
        if not drive:
            raise HTTPError(self.response, 404, "Drive channel not found")

        # Check if user has access to the server
        access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", drive["server"]])
        if not access:
            raise HTTPError(self.response, 403, "No access to this drive")

        # Get folders
        if parent_folder and parent_folder != "null":
            folders = self.db.getAll("drive_folder", int(parent_folder), "parent_folder")
        else:
            # Get root level folders (where parent_folder is NULL)
            folders = self.db.getFilters("drive_folder", ["drive_channel", "=", drive_id, "and", "parent_folder", "is", None])

        # Add creator info for each folder
        for folder in folders:
            creator = self.db.getSomething("mycelium_account", folder["creator"])
            if creator:
                folder["creator_name"] = creator["display"]
                folder["creator_username"] = creator["username"]

        return json.dumps(folders, default=str)

    @Server.expose
    def deleteDriveFolder(self, folder_id):
        """
        Delete a folder from a drive channel (and all its contents).

        Args:
            folder_id: ID of the folder in drive_folder table

        Returns:
            Success message
        """
        import os

        uid = self.getUser()

        # Get folder info
        folder_info = self.db.getSomething("drive_folder", folder_id)
        if not folder_info:
            raise HTTPError(self.response, 404, "Folder not found")

        # Get drive channel
        drive = self.db.getSomething("drive_channel", folder_info["drive_channel"])
        if not drive:
            raise HTTPError(self.response, 404, "Drive channel not found")

        # Check if user has access to the server
        access = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", drive["server"]])
        if not access:
            raise HTTPError(self.response, 403, "No access to this folder")

        # Only creator or server owner can delete
        server_info = self.db.getSomething("server", drive["server"])
        if folder_info["creator"] != uid and server_info["owner"] != uid:
            # Check if user has admin/edit rights
            if not self.checkAccessRights(uid, drive["server"], "edit"):
                raise HTTPError(self.response, 403, "Only creator or server admins can delete folders")

        # Get all files in this folder and delete them
        files_in_folder = self.db.getAll("drive_file", folder_id, "parent_folder")
        for file_info in files_in_folder:
            filepath = self.path + "/static/attachments/" + file_info["filepath"]
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception as e:
                print(f"Error deleting file {filepath}: {e}")

        # Delete folder from database (CASCADE will handle files and subfolders)
        self.db.deleteSomething("drive_folder", folder_id)

        return json.dumps({"status": "ok", "message": "Folder deleted successfully"})

    def uploadDrive(self, user_id, drive_id, file, parent_folder=None):
        """
        Upload a file to a drive channel.

        Args:
            user_id: ID of the user uploading the file
            drive_id: ID of the drive channel
            file: Tuple containing (filename, base64_encoded_content)
            parent_folder: Optional ID of parent folder

        Returns:
            ID of the created drive_file entry
        """
        import mimetypes

        # Extract filename and content from tuple
        filename, content = file

        # Add dataURI prefix if not present
        if not content.startswith("data:"):
            # Detect MIME type from filename extension
            mime_type, _ = mimetypes.guess_type(filename)
            if not mime_type:
                mime_type = "application/octet-stream"  # default for unknown types

            # Add the data URI prefix
            content = f"data:{mime_type};base64,{content}"

        filenameParts = filename.rsplit('.')
        name = filenameParts[0]
        extension = filenameParts[1] if len(filenameParts) > 1 else ''

        # Category is set to the drive_id to organize files by drive
        filepath = self.saveFile(content, name=name, ext=extension, category=f"drive_{drive_id}")

        # Calculate file size (approximate from base64)
        # Remove data URI prefix if present
        if "," in content:
            content_data = content.split(",")[1]
        else:
            content_data = content

        # Base64 encoded size is roughly 4/3 of original size
        file_size = int(len(content_data) * 3 / 4)

        # Insert file record into database
        file_id = self.db.insertDict("drive_file", {
            "drive_channel": drive_id,
            "filename": filename,
            "filepath": filepath,
            "size": file_size,
            "uploader": user_id,
            "parent_folder": parent_folder
        }, getId=True)

        return file_id

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

    @Server.expose
    def setServerFeatured(self, server_id, featured):
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
    def sendMessage(self, conv, content, reply=False, attachments = []):
        uid = self.getUser()

        attachmentList = []
        for attachment in attachments:
            dataUrl = attachment.get('dataUrl', '')
            filename = attachment.get('filename', 'file')
            mimeType = attachment.get('mimeType', '')

            filepath = self.saveFile(dataUrl)
            attach = {"mime":mimeType, "filename": filename, "filepath": filepath}
            attachmentList.append(attach)

        conv = json.loads(conv)
        if not conv.get("id"):
            conv["id"] = self.newConv("Noname", [uid, conv["dest"]])

        message = {"sender": uid, "place": conv["id"], "body": content, "attachments": json.dumps(attachmentList)}
        if reply and reply!="undefined" and reply!="null" :
            message["reply"] = reply



        msgId = self.db.insertDict("message", message, getId=True)
        message["id"] = msgId

        members = self.db.getAll("accessconversation", conv["id"], "conversation")
        for user in members:
            if user["account"] != uid:
                self.sendNotification(user["account"], {"type": "message", "content": message})

                notif  = self.db.getFilters("offline_notifs", ["account", "=", user['account'], "and", "conversation", "=", conv["id"]])
                if notif != []:
                    self.db.edit("offline_notifs", notif[0]["id"], "number", notif[0]["number"] + 1)
                else :
                    self.db.insertDict("offline_notifs", {"account": user['account'] , "conversation": conv["id"]})

        return json.dumps(attachmentList)

    @Server.expose
    def consultNotifs(self, notifId):
        uid = self.getUser()
        if not self.db.getFilters("offline_notifs", ["account", "=", uid, "and", "id", "=", notifId]):
            raise HTTPError(self.response, 403, "forbidden")
        self.db.deleteSomething("offline_notifs", notifId)

    @Server.expose
    def editMessage(self, message, content):
        print("editing message", message, content)
        uid = self.getUser()

        message = self.db.getSomething("message", message)

        if not message or message["sender"] != uid:
            raise HTTPError(self.response, 403, "forbidden")

        self.db.edit("message", message["id"], "body", content)
        self.db.edit("message", message["id"], "edited", True)


        members = self.db.getAll("accessconversation", message["place"], "conversation")

        for member in members:
            if member["account"] != uid:
                self.sendNotification(member["account"],{"type":"message_edited", "content":{"id":message,"content":content}})

    @Server.expose
    def deleteMessage(self, message):
        print("editing message", message)
        uid = self.getUser()

        messageId = message
        message = self.db.getSomething("message", message)

        if not message or message["sender"] != uid:
            raise HTTPError(self.response, 403, "forbidden")

        self.db.deleteSomething("message", messageId)

        members = self.db.getAll("accessconversation", message["place"], "conversation")

        for member in members:
            if member["account"] != uid:
                self.sendNotification(member["account"],{"type":"message_deleted", "content":{"id":messageId}})

    @Server.expose
    def registerActivity(self, SDP):
        uid = self.getUser()
        self.db.insertDict("active_client", {"userid": uid, "SDP": SDP})


    @Server.expose
    def block(self, user):
        uid = self.getUser()
        if self.db.getFilters("blockship", ["blocker", "=", uid, "and", "blocked", "=", user]):
            return "already blocked"
        id = self.db.insertDict("blockship", {"blocker": uid, "blocked": user}, getId=True)
        return "ok "+str(id)


    @Server.expose
    def friends(self, action, arg=""):
        uid = self.getUser()
        if action == "add":
            friend = self.db.getSomething("mycelium_account", arg, "username")
            if not friend:
                return "user not found"
            if friend['id'] == uid:
                return "You can't add yourself as a friend"

            friendship = self.db.getFilters("boatakopin",
                                            ["kopinprincipal", "=", uid, "and", "kopinsecondaire", "=", friend['id'],
                                             ") or (", "kopinprincipal", "=", friend['id'], "and", "kopinsecondaire",
                                             "=", uid, ')'], "(")
            if friendship:
                return "You're already friends/invitation already sent"

            request = {"kopinprincipal": uid, "kopinsecondaire": friend['id'], "accepted": False}
            request["id"] = self.db.insertDict("boatakopin", request, True)
            self.sendNotification(friend['id'], {"type": "friend_request", "content": request})
            return "ok"

        elif action == "accept":
            friendship = self.db.getFilters("boatakopin", ["id", "=", arg, "and", "kopinsecondaire", "=", uid])
            if friendship:
                self.db.edit("boatakopin", arg, "accepted", True)
                conv_id = self.db.insertDict('conversation', {'name': ""}, getId=True)
                self.db.insertDict('accessconversation', {'account': uid, 'conversation': conv_id})
                self.db.insertDict('accessconversation',
                                   {'account': friendship[0]["kopinprincipal"], 'conversation': conv_id})
                self.db.edit("boatakopin", arg, "conv", conv_id)

                friendship[0]["conv"] = conv_id
                self.sendNotification(friendship[0]["kopinprincipal"], {"type": "accepted_request", "content": friendship[0]})

                conv = {"id": conv_id, "name": "", "members": [uid, friendship[0]["kopinprincipal"]]}
                self.sendNotification(uid, {"type": "added_conv", "content": conv})
                self.sendNotification(friendship[0]["kopinprincipal"], {"type": "added_conv", "content": conv})

        elif action == "get":
            friends = self.db.getFilters("boatakopin",
                                         ["accepted", "=", True, "and (", "kopinprincipal", "=", uid, "or",
                                          "kopinsecondaire", "=", uid, ")"])
            return json.dumps(friends)

        elif action == "getBlocked":
            enemies = self.db.getAll("blockship", uid, "blocker")
            return json.dumps(enemies)

        elif action == "invitations":
            invitations = self.db.getFilters("boatakopin",
                                             ["accepted", "=", False, "and (", "kopinprincipal", "=", uid, "or",
                                              "kopinsecondaire", "=", uid, ")"])
            return json.dumps(invitations)

        elif action == "remove":
            friendship = self.db.getSomething("boatakopin",arg)
            if friendship and friendship["accepted"] and (friendship["kopinprincipal"] == uid or friendship["kopinsecondaire"] == uid):
                self.db.deleteSomething("boatakopin", arg)
            raise HTTPError(self.response, 403, "forbidden")

    @Server.expose
    def change(self, element, value):
        uid = self.getUser()
        if element == "id":
            return "forbidden"
        elif element == "username":
            if re.fullmatch(REGEX_USERNAME, value):
                if not self.db.getSomething("mycelium_account", value, element):
                    self.db.edit("mycelium_account", uid, element, value)
                    return "ok"
                else:
                    return "this " + element + " already exists"
            return "invalid username "
        elif element == "status":
            status = json.loads(value)
            self.db.edit("status", uid, "mode", status["mode"])
            self.db.edit("status", uid, "text", status["text"])
            self.db.edit("status", uid, "emoji", status["emoji"])
            if status["expiration"]:
                self.db.edit("status", uid, "expiration", status["expiration"])
            else:
                self.db.edit("status", uid, "expiration", None)
            self.sendStatusUpdates(uid)
        elif element == "pfp":
            filename = self.saveFile(value)
            self.db.edit("mycelium_account", uid, element, filename)
            return json.dumps({"pfp": filename}, default=str)
        elif element == "banner":
            filename = self.saveFile(value)
            self.db.edit("mycelium_account", uid, element, filename)
            return json.dumps({"banner": filename}, default=str)
        else:
            self.db.edit("mycelium_account", uid, element, value)

    @Server.expose
    def addEmail(self, email):
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
    def removeEmail(self, id):
        uid = self.getUser()

        # Check if the email belongs to the current user
        email_entry = self.uniauth.getSomething("additional_mail", id)
        if not email_entry or email_entry["account"] != uid:
            return json.dumps({"error": "Email not found or access denied"})

        # Delete the email
        self.uniauth.deleteSomething("additional_mail", id)

        return json.dumps({"success": True})

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

    @Server.expose
    def editServer(self, property, id, value=None, field=None, action=None, targetId=None, channelType=None):
        uid = self.getUser()
        forbidden_fields = ["id", "owner", "is_featured", "member_count"]
        if field in forbidden_fields or not self.checkAccessRights(uid, id, "edit"):
            raise HTTPError(self.response, 403, "forbidden")

        if property == "channel":
            if action == "create":
                # Déterminer le type de channel à créer
                channel_type = channelType if channelType else "textual"

                if channel_type == "vocal":
                    channel_id = self.db.insertDict("room", {"server": id}, getId=True)
                    channel = self.db.getSomething("room", channel_id)
                elif channel_type == "drive":
                    channel_id = self.db.insertDict("drive_channel", {"name": "new storage", "server": id}, getId=True)
                    channel = self.db.getSomething("drive_channel", channel_id)
                elif channel_type == "note":
                    channel_id = self.db.insertDict("notes_channel", {"name": "new note", "server": id}, getId=True)
                    channel = self.db.getSomething("notes_channel", channel_id)
                else:  # textual par défaut
                    channel_id = self.db.insertDict("textual_channel", {"name": "new channel", "server": id}, getId=True)
                    channel = self.db.getSomething("textual_channel", channel_id)

                # Retourner le canal créé avec son type
                return json.dumps({"channel": channel, "type": channel_type}, default=str)

            chan = self.db.getSomething("textual_channel", targetId)
            if chan and chan["server"] == int(id) and field != "server":
                if action == "delete":
                    self.db.deleteSomething("textual_channel", targetId)
                    return
                self.db.edit("textual_channel", targetId, field, value)
                return

            # Vérifier si c'est un drive channel
            chan = self.db.getSomething("drive_channel", targetId)
            if chan and chan["server"] == int(id) and field != "server":
                if action == "delete":
                    self.db.deleteSomething("drive_channel", targetId)
                    return
                self.db.edit("drive_channel", targetId, field, value)
                return

            # Vérifier si c'est un room (vocal)
            chan = self.db.getSomething("room", targetId)
            if chan and chan["server"] == int(id):
                if action == "delete":
                    self.db.deleteSomething("room", targetId)
                    return
                # Les rooms n'ont pas de nom pour l'instant dans le schema
                return

            raise HTTPError(self.response, 403, "forbidden")
        elif property == "role":
            if action == "create":
                id = self.db.insertDict("role", {"name": "new role", "server": id}, getId=True)
                return str(id)

            role = self.db.getSomething("role", targetId)
            if not role or role["server"] != int(id) or field == "server":
                raise HTTPError(self.response, 403, "forbidden")

            if action == "delete":
                self.db.deleteSomething("role", targetId)
                return

            if action == "attribute":
                if self.db.getFilters("role_attribution", ["account", "=", targetId, "and", "role", "=", value, "and", "server", "=", id]):
                    raise HTTPError(self.response, 403, "already attributed")

                self.db.insertDict("role_attribution", {"account": targetId, "role": value, "server":id}, getId=True)
                # Invalidate admin cache as role attribution might have changed admin rights
                self.invalidateAdminCache()
                return str(id)

            if field == "permissions":
                permissions = json.loads(value)
                serv_op = self.db.getSomething("op_servs", id, "server")
                if permissions.get("mycelium-admin") is not None and serv_op == []: # restrict mycelium_admin right to op servers
                    print("forbidden mycelium admin")
                    raise HTTPError(self.response, 403)

            self.db.edit("role", targetId, field, value)
            # Invalidate admin cache as role permissions might have changed
            self.invalidateAdminCache()
        elif property == "name":
            self.db.edit("server", id, property, value)
        elif property == "pfp":
            filename = self.saveFile(value)
            self.db.edit("server", id, "pfp", filename)
            return json.dumps({"pfp": filename}, default=str)
        elif property == "is_community":
            # Only server owner can change this
            server = self.db.getSomething("server", id)
            if server["owner"] != uid:
                raise HTTPError(self.response, 403, "Only server owner can change community status")
            self.db.edit("server", id, "is_community", value == "true")
        elif property == "tags":
            # Parse tags as JSON array
            tags = json.loads(value) if isinstance(value, str) else value
            self.db.edit("server", id, "tags", json.dumps(tags))
        elif property == "languages":
            languages = json.loads(value) if isinstance(value, str) else value
            self.db.edit("server", id, "languages", json.dumps(languages))
        elif property == "description":
            self.db.edit("server", id, "description", value)

    @Server.expose
    def saveBlock(self, channel, block, op="edit"):
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



    @Server.expose
    def serverDisplay(self, invite):
        server = self.db.getSomething("invitation", invite, "link")
        if server:
            details = self.db.getSomething("server", server["server"])
            return details["name"]
        else:
            raise HTTPError(self.response, 404, "Not Found")

    @Server.expose
    def createInvitation(self, server, pref=None):
        uid = self.getUser()
        res = self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", server])
        if not res or res == []:
            return HTTPError(self.response, 403, "forbidden")

        res = self.db.getSomething("invitation", server, "server")
        if res and res != [] and res["expiration"] > datetime.datetime.now():
            return res["link"]

        if not pref:
            id = ''.join(random.sample(B62, 8))

            while 1:
                if self.db.getSomething("invitation",id,"link"):
                    id = ''.join(random.sample(B62, 8))
                else:
                    self.db.insertDict("invitation",{"link": id,"server":server,"expiration":datetime.datetime.now() + datetime.timedelta(days=7)})
                    return id
        else:
            id=pref
            while 1:
                if self.db.getSomething("invitation",id,"link"):
                    id = pref + ''.join(random.sample(B62, 3))
                else :
                    self.db.insertDict("invitation",{"link": id,"server":server,"expiration":datetime.datetime.now() + datetime.timedelta(days=7)})
                    return id

    @Server.expose
    def join(self, source):
        uid = self.getUser()
        res = self.db.getSomething("invitation", source, "link")
        if res and res != []:
            if res["expiration"] < datetime.datetime.now():
                raise HTTPError(self.response, 403, "forbidden")
            if self.db.getFilters("accessserver", ["account", "=", uid, "and", "server", "=", res["server"]]):
                raise HTTPError(self.response, 403, "you're already in this server")
            self.db.insertDict("accessserver", {"account": uid, "server": res["server"]})
            raise HTTPRedirect(self.response, "/channels")
        raise HTTPError(self.response, 404, "Not Found")


    @Server.expose
    def getDashboard(self, server,service_id):
        uid = self.getUser()
        op = self.db.getSomething("op_servs", server, "server")
        if not op:
            raise HTTPError(self.response, 403, "forbidden")

        if not self.checkAccessRights(uid, server, "dashboard-read"):
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
    def refreshDashboard(self, service):
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
    def createPersonalServer(self, server):
        uid = self.getUser()
        server = self.db.getSomething("server", server)
        if not server or server["owner"] != uid:
            raise HTTPError(self.response, 403, "forbidden")

        if self.db.getSomething("personal_server", uid, "owner"):
            raise HTTPError(self.response, 403, "You already have a personal server")
        self.db.insertDict("personal_server", {"owner": uid, "server": server["id"]})

    @Server.expose
    def sendEmail(self, server, to, subject, body):
        op = self.db.getSomething("op_servs", server, "server")
        if not op:
            raise HTTPError(self.response, 403, "forbidden")

        if not self.checkAccessRights(uid, server, "dashboard-read"):
            raise HTTPError(self.response, 403, "forbidden")



    @Server.expose
    def createApiKey(self, name="", permissions="[]"):
        """Create a new API key for the authenticated user.
        Expects optional name and permissions (JSON list or a list) and returns a JSON object with the new key and metadata.
        """
        uid = self.getUser()
        # normalize permissions param
        try:
            if isinstance(permissions, str):
                permissions_parsed = json.loads(permissions)
            else:
                permissions_parsed = permissions
        except Exception:
            permissions_parsed = []

        # generate a unique key
        new_key = ''.join(random.choices(B62, k=40))
        # ensure uniqueness
        while self.db.getSomething("api_key", new_key, "key"):
            new_key = ''.join(random.choices(B62, k=40))

        key_id = self.db.insertDict("api_key", {"key": new_key, "owner": uid, "name": name}, getId=True)
        created = datetime.datetime.now()

        # Return some metadata (note: name/permissions are now returned; name is persisted in DB)
        resp = {"id": key_id, "name": name, "key": new_key, "created": str(created), "permissions": permissions_parsed}
        return json.dumps(resp)

    @Server.expose
    def revokeApiKey(self, id):
        """Revoke (delete) an API key by its id. Only the owner can revoke their key."""
        uid = self.getUser()
        keyrow = self.db.getSomething("api_key", id)
        if not keyrow:
            raise HTTPError(self.response, 404, "Not Found")
        if keyrow.get("owner") != uid:
            raise HTTPError(self.response, 403, "forbidden")

        self.db.deleteSomething("api_key", id)
        return "ok"

    @Server.expose
    def regenerateApiKey(self, id):
        """Generate a new key value for an existing API key entry. Only the owner may regenerate."""
        uid = self.getUser()
        keyrow = self.db.getSomething("api_key", id)
        if not keyrow:
            raise HTTPError(self.response, 404, "Not Found")
        if keyrow.get("owner") != uid:
            raise HTTPError(self.response, 403, "forbidden")

        new_key = ''.join(random.choices(B62, k=40))
        while self.db.getSomething("api_key", new_key, "key"):
            new_key = ''.join(random.choices(B62, k=40))

        self.db.edit("api_key", id, "key", new_key)
        # return the new key value
        return json.dumps({"key": new_key})

    @Server.expose
    def getUserApiKeys(self):
        """Return the API keys for the authenticated user. The raw key value is not exposed here."""
        uid = self.getUser()
        keys = self.db.getAll("api_key", uid, "owner")
        # remove the raw key value before returning
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
