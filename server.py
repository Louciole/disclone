import urllib.parse

from sakura import Server
import cherrypy
import json
import re

# websockets imports
import asyncio
import websockets
import threading

from os.path import abspath, dirname

PATH = dirname(abspath(__file__))


class Disclone(Server):
    @cherrypy.expose
    def index(self):
        return open(PATH + "/ressources/home/home.html")

    @cherrypy.expose
    def channels(self, uid="me"):
        self.checkJwt()
        return open(PATH + "/ressources/main.html")

    def onStart(self):
        self.id = 1  # TODO give a different id to each server to allow them to contact eachother
        self.pool = {}
        self.wating_clients = {}
        self.currentWaiting = 0
        websocket_thread = threading.Thread(target=self.startWebSockets)
        websocket_thread.start()

    def onLogin(self, uid):
        if not self.db.getSomething("disclone_account", uid):
            self.db.insertDict("disclone_account", {"id": uid, "username": '#' + str(uid)})

    def getUserConnection(self, id):
        return self.db.getSomething("active_client", id, "userid")

    def newConv(self, name, members):
        account_id = self.getUser()
        conv_id = self.db.insertDict('conversation', {'name': name}, getId=True)
        self.db.insertDict('accessconversation', {'account': account_id, 'conversation': conv_id})
        for i in range(0, len(members)):  # this could be batched !
            self.db.insertDict('accessconversation', {'account': members[i], 'conversation': conv_id})
        return conv_id

    def startWebSockets(self):
        asyncio.run(self.runWebsockets())

    async def runWebsockets(self):
        async with websockets.serve(self.handle_message, self.config.get("server", "IP"),
                                    int(self.config.get("NOTIFICATION", "PORT"))):
            await asyncio.Future()  # Run the server forever

    # --------------------------------WEBSOCKETS--------------------------------

    async def handle_message(self, websocket):
        async for message in websocket:
            data = json.loads(message)

            match data["type"]:
                case "register":
                    self.wating_clients[self.currentWaiting] = {"connection": websocket, "uid": data["uid"]}
                    self.currentWaiting += 1
                    answer = {"type": "register_request", "servId": self.id, "connectionId": self.currentWaiting - 1}
                    await websocket.send(json.dumps(answer))
                case "typing":
                    members = self.db.getAll("accessconversation", data["conv"], "conversation")

                    for user in members:
                        if user["account"] != data["uid"]:
                            await self.sendNotificationAsync(user["account"], data)
                case _:
                    print("unknown message received", message)

    @cherrypy.expose
    def authWS(self, connectionId):
        account_id = self.getUser()
        if self.wating_clients[int(connectionId)]["uid"] != account_id:
            return "forbidden"

        connection = self.db.insertDict("active_client", {"userid": account_id, "server": self.id}, True)
        self.pool[connection] = self.wating_clients[int(connectionId)]["connection"]
        del self.wating_clients[int(connectionId)]

    async def sendNotificationAsync(self, account, content):
        message = {"type": "notif", "content": content}

        clients = self.db.getAll("active_client", account, "userid")
        for client in clients:
            #TODO handle multi server
            if self.pool.get(client["id"]):
                websocket = self.pool[client["id"]]
                try:
                    await websocket.send(json.dumps(message))
                except Exception as e:
                    print("exception sending a message on a ws", e)
                    del self.pool[client["id"]]
                    self.db.deleteSomething("active_client", client["id"])
            else:
                self.db.deleteSomething("active_client", client["id"])

    def sendNotification(self, account, content):
        message = {"type": "notif", "content": content}
        async def ws_send(message):
            await websocket.send(message)

        clients = self.db.getAll("active_client", account, "userid")
        for client in clients:
            #TODO handle multi server
            if self.pool.get(client["id"]):
                websocket = self.pool[client["id"]]
                try:
                    asyncio.run(ws_send(json.dumps(message)))
                except Exception as e:
                    print("exception sending a message on a ws", e)
                    del self.pool[client["id"]]
                    self.db.deleteSomething("active_client", client["id"])
            else:
                self.db.deleteSomething("active_client", client["id"])

    # -----------------------------------API-------------------------------------

    @cherrypy.expose
    def createServer(self):
        account_id = self.getUser()
        server_id = self.db.insertDict('server', {'name': "New Server", "owner": account_id}, getId=True)
        self.db.insertDict('accessserver', {'account': account_id, 'server': server_id})

    @cherrypy.expose
    def getUserServers(self):
        uid = self.getUser()
        servers = self.db.getSomethingProxied("server", "accessserver", "account", uid)
        return json.dumps(servers)

    @cherrypy.expose
    def createConv(self, name, members):
        self.newConv(name, members)

    @cherrypy.expose
    def getUserConvs(self):
        uid = self.getUser()
        convs = self.db.getSomethingProxied("conversation", "accessconversation", "account", uid)
        for j in range(0, len(convs)):
            # TODO refactor, this is slow for no reason
            convs[j]["members"] = self.db.getFilters("accessconversation", ["conversation", "=", convs[j]["id"]])
            for i in range(0, len(convs[j]["members"])):
                convs[j]["members"][i] = convs[j]["members"][i]["account"]
        return json.dumps(convs)

    @cherrypy.expose
    def getUsersInfo(self, users):
        uid = self.getUser()
        users = self.db.getFilters("disclone_account", ["id", "in", json.loads(users)])
        return json.dumps(users, default=str)

    @cherrypy.expose
    def getConvContent(self, convId):
        uid = self.getUser()
        conv = self.db.getFilters("accessconversation", ["conversation", "=", convId, "and", "account", "=", uid])
        if conv:
            content = {}
            content["messages"] = self.db.getFilters("message", ["place", "=", convId])
            return json.dumps(content, default=str)

    @cherrypy.expose
    def getUserInfo(self):
        uid = self.getUser()
        user = self.db.getSomething("disclone_account", uid)
        return json.dumps(user, default=str)

    @cherrypy.expose
    def sendMessage(self, conv, content):
        uid = self.getUser()
        conv = json.loads(conv)
        print(conv)
        if not conv.get("id"):
            conv["id"] = self.newConv("Noname", [uid, conv["dest"]])

        message = {"sender": uid, "place": conv["id"], "body": content}
        self.db.insertDict("message", message)

        members = self.db.getAll("accessconversation", conv["id"], "conversation")
        for user in members:
            if user["account"] != uid:
                self.sendNotification(user["account"], {"type": "message", "content": message})
        return

    @cherrypy.expose
    def registerActivity(self, SDP):
        uid = self.getUser()
        self.db.insertDict("active_client", {"userid": uid, "SDP": SDP})

    @cherrypy.expose
    def friends(self, action, arg=""):
        uid = self.getUser()
        if action == "add":
            friend = self.db.getSomething("disclone_account", arg, "username")
            if not friend:
                return "user not found"
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

        elif action == "invitations":
            invitations = self.db.getFilters("boatakopin",
                                             ["accepted", "=", False, "and (", "kopinprincipal", "=", uid, "or",
                                              "kopinsecondaire", "=", uid, ")"])
            return json.dumps(invitations)

    @cherrypy.expose
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
        else:
            self.db.edit("disclone_account", uid, element, value)


REGEX_USERNAME = re.compile('^(?=.{3,}$)[a-zA-Z0-9_\-\.]*$')
Disclone(path=PATH, configFile="/server.ini")
