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

# websockets imports
import asyncio
import websockets
import threading

from os.path import abspath, dirname

B62 = string.digits + string.ascii_letters
PATH = dirname(abspath(__file__))


class Disclone(Server):
    features = {"websockets": True, "errors": {404: "/static/404.html"}}
    clients = []

    @Server.expose
    def index(self):
        return self.file(PATH + "/static/home/home.html")

    @Server.expose
    def channels(self, uid="me"):
        self.checkJwt()
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
        if not self.db.getSomething("disclone_account", uid):
            self.db.insertDict("disclone_account", {"id": uid, "username": '#' + str(uid)})
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
                case "callIce" | "callAnswer" | "callOffer" | "callHangup" | "callParticipants" :
                    for client in self.clients:
                        if client != websocket:
                            await client.send(message)
                case "callJoin":
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
    def getUserServers(self):
        uid = self.getUser()
        servers = self.db.getSomethingProxied("server", "accessserver", "account", uid)
        return json.dumps(servers)

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
        users = self.db.getFilters("disclone_account", ["id", "in", json.loads(users)])
        self.getUsersStatus(users)
        return (json.dumps(users, default=str))


    @Server.expose
    def subscribe(self,client, cat, items):
        uid = self.getUser()
        client_infos = self.db.getSomething("active_client",client)
        if not client_infos or client_infos.get("userid") != uid:
            raise HTTPError(self.response,403, "forbidden")

        if cat=="user":
            users = self.db.getFilters("disclone_account", ["id", "in", json.loads(items)])
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
    def getServContent(self, servID, channelID=None):
        uid = self.getUser()
        #TODO handle access rights
        serv = self.db.getFilters("accessserver", ["account", "=", uid])
        if serv:
            content = {}
            if not channelID:
                content["channels"] = self.db.getAll("textual_channel", servID,"server")
                op = self.db.getSomething("op_servs", servID, "server")
                if op and self.checkAccessRights(uid, servID, "dashboard-read"):
                    content["dashboards"] = self.db.getAll("serv_dashboard", servID, "server")
                    content["op"] = True
                content["cat"] = self.db.getAll("server_cat", servID,"server")
                content["roles"] = self.db.getAll("role", servID,"server")
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
        user = self.db.getSomething("disclone_account", uid)
        self.getUsersStatus([user],detailed=True)
        user["notifs"] = self.db.getAll("offline_notifs", uid, "account")
        return json.dumps(user, default=str)

    @Server.expose
    def uploadImage(self):
        uid = self.getUser()
        user = self.db.getSomething("disclone_account", uid)
        self.getUsersStatus([user],detailed=True)
        return json.dumps(user, default=str)

    @Server.expose
    def uploadDriveOnBehalf(self, API_KEY, email):
        key = self.db.getSomething("API_key", API_KEY, "key")
        if not key:
            raise HTTPError(self.response, 403, "forbidden")

        key_user = self.db.getSomething("disclone_account", key["owner"])
        if not key_user or not self.isAdmin(key_user["id"]):
            raise HTTPError(self.response, 403, "forbidden")

        user = self.db.getSomething("disclone_account", email, "username")
        if not user:
            raise HTTPError(self.response, 403, "forbidden")
        uid = user["id"]


    def uploadDrive(self, uid):
        uid = self.getUser()
        pass

    def isAdmin(self, uid):
        # admins are users with admin status in op servs
        users_op_servs = self.db.execute("SELECT * FROM op_servs, accessServer WHERE op_servs.server = accessServer.server AND accessServer.account = %s", (uid,))
        op = self.db.getSomething("op_servs", id, "server")
        if not op:
            raise HTTPError(self.response, 403, "forbidden")

        if not self.checkAccessRights(uid, id, "disclone_admin"):
            raise HTTPError(self.response, 403, "forbidden")


        pass

    def onWSAuth(self,uid):
        self.sendStatusUpdates(uid)

    @Server.expose
    def sendMessage(self, conv, content, reply=False, attachments = []):
        uid = self.getUser()

        attachmentList = []
        for attachment in attachments:
            attachmentList.append(self.saveFile(attachment))
        conv = json.loads(conv)
        if not conv.get("id"):
            conv["id"] = self.newConv("Noname", [uid, conv["dest"]])

        message = {"sender": uid, "place": conv["id"], "body": content, "attachments": json.dumps(attachmentList)}
        if reply and reply!="undefined" and reply!="null" :
            message["reply"] = reply



        self.db.insertDict("message", message)
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
                self.sendNotification(member,{"type":"message_edited", "content":{"id":message,"content":content}})

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
                self.sendNotification(member,{"type":"message_deleted", "content":{"id":messageId}})

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
            friend = self.db.getSomething("disclone_account", arg, "username")
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
                if not self.db.getSomething("disclone_account", value, element):
                    self.db.edit("disclone_account", uid, element, value)
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
            self.db.edit("disclone_account", uid, element, self.saveFile(value))
        else:
            self.db.edit("disclone_account", uid, element, value)

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
    def editServer(self, property, id, value=None, field=None, action=None, targetId=None):
        uid = self.getUser()
        if field == "id" or field == "owner" or not self.checkAccessRights(uid, id, "edit"):
            raise HTTPError(self.response, 403, "forbidden")

        if property == "channel":
            if action == "create":
                self.db.insertDict("textual_channel", {"name": "new channel", "server": id})
                return

            chan = self.db.getSomething("textual_channel", targetId)
            if not chan or chan["server"] != int(id) or field == "server":
                raise HTTPError(self.response, 403, "forbidden")

            if action == "delete":
                self.db.deleteSomething("textual_channel", targetId)
                return

            self.db.edit("textual_channel", targetId, field, value)
        if property == "dashboard":
            op = self.db.getSomething("op_servs", id, "server")
            if not op:
                raise HTTPError(self.response, 403, "forbidden")

            if not self.checkAccessRights(uid, id, "dashboard-create"):
                raise HTTPError(self.response, 403, "forbidden")

            if action == "create":
                self.db.insertDict("serv_dashboard", {"name": "new dashboard", "server": id})
                return

            chan = self.db.getSomething("serv_dashboard", targetId)
            if not chan or chan["server"] != int(id) or field == "server":
                raise HTTPError(self.response, 403, "forbidden")

            if action == "delete":
                self.db.deleteSomething("serv_dashboard", targetId)
                return

            self.db.edit("serv_dashboard", targetId, field, value)
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

                id = self.db.insertDict("role_attribution", {"account": targetId, "role": value, "server":id}, getId=True)
                return str(id)

            self.db.edit("role", targetId, field, value)
        elif property == "name":
            self.db.edit("server", id, property, value)
        elif property == "pfp":
            self.db.edit("server", id, "pfp", self.saveFile(value))


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

        #if disclone get from self
        if service_id == "disclone":
            self.db.cur.execute("SELECT COUNT(*) FROM disclone_account", ())
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
    def sendEmail(self, server, to, subject, body):
        op = self.db.getSomething("op_servs", server, "server")
        if not op:
            raise HTTPError(self.response, 403, "forbidden")

        if not self.checkAccessRights(uid, server, "dashboard-read"):
            raise HTTPError(self.response, 403, "forbidden")



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

REGEX_USERNAME = re.compile('^(?=.{3,}$)[a-zA-Z0-9_\-\.]*$')
server = Disclone(path=PATH, configFile="/server.ini")
