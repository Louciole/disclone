import urllib.parse

from sakura import Server
import cherrypy
import json
import re
import signal

# websockets imports
import asyncio
import websockets
import threading

from os.path import abspath, dirname

PATH = dirname(abspath(__file__))


class Disclone(Server):
    features = {"websockets": True, "errors": {404: "/static/404.html"}}

    @Server.expose
    def index(self):
        return open(PATH + "/static/home/home.html").read()

    @Server.expose
    def channels(self, uid="me"):
        self.checkJwt()
        return open(PATH + "/static/main.html").read()

    def onLogin(self, uid):
        if not self.db.getSomething("disclone_account", uid):
            self.db.insertDict("disclone_account", {"id": uid, "username": '#' + str(uid)})
        if not self.db.getSomething("status", uid):
            self.db.insertDict("status", {"id": uid})

    def getUserConnection(self, id):
        return self.db.getSomething("active_client", id, "userid")

    def newConv(self, name, members):
        account_id = self.getUser()
        conv_id = self.db.insertDict('conversation', {'name': name}, getId=True)
        self.db.insertDict('accessconversation', {'account': account_id, 'conversation': conv_id})
        for i in range(0, len(members)):  # this could be batched !
            self.db.insertDict('accessconversation', {'account': members[i], 'conversation': conv_id})
        return conv_id

    def clean(self):
        for client, ws in self.pool.items():
            self.db.deleteSomething("active_client",client)

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
                case "changeActivity":
                    if self.checkWSAuth(websocket,data["clientID"]):
                        self.db.edit("active_client", data["clientID"], "idle", data["idle"])
                        #TODO send notif to every friends ?
                case _:
                    print("unknown message received", message)

    # -----------------------------------API-------------------------------------

    @Server.expose
    def createServer(self):
        account_id = self.getUser()
        server_id = self.db.insertDict('server', {'name': "New Server", "owner": account_id}, getId=True)
        self.db.insertDict('accessserver', {'account': account_id, 'server': server_id})

    @Server.expose
    def getUserServers(self):
        uid = self.getUser()
        servers = self.db.getSomethingProxied("server", "accessserver", "account", uid)
        return json.dumps(servers)

    @Server.expose
    def createConv(self, name, members):
        self.newConv(name, members)

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
        return json.dumps(users, default=str)

    @Server.expose
    def getConvContent(self, convId):
        uid = self.getUser()
        conv = self.db.getFilters("accessconversation", ["conversation", "=", convId, "and", "account", "=", uid])
        if conv:
            content = {}
            content["messages"] = self.db.getFilters("message", ["place", "=", convId])
            return json.dumps(content, default=str)

    @Server.expose
    def getUserInfo(self):
        uid = self.getUser()
        user = self.db.getSomething("disclone_account", uid)
        self.getUsersStatus([user])
        return json.dumps(user, default=str)

    @Server.expose
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

    @Server.expose
    def registerActivity(self, SDP):
        uid = self.getUser()
        self.db.insertDict("active_client", {"userid": uid, "SDP": SDP})

    @Server.expose
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
        else:
            self.db.edit("disclone_account", uid, element, value)

    def getUsersStatus(self, users):
        #these requests could be batched
        for user in users:
            params = self.db.getSomething('status', user['id'])
            if not params:
                self.db.insertDict("status", {"id": user['id']})
                params = {"mode": 0}
            print (params)
            if params['mode'] == 0:
                clients = self.db.getAll('active_client', user['id'], "userid")
                print("user is in 0 mode id:",user['id'],clients)
                idle = True
                if not len(clients):
                    user['status'] = {'icon': 'spymode', 'text': 'Offline'}
                    continue
                for client in clients:
                    if not client['idle']:
                        idle = False
                if idle:
                    user['status'] = {'icon': 'orange', 'text': 'Inactive'}
                else:
                    user['status'] = {'icon': 'green', 'text': 'Online'}
            elif params['mode'] == 3:
                user['status'] = {'icon': 'spymode', 'text': 'Offline'}
            elif params['mode'] == 2:
                user['status'] = {'icon': 'RED', 'text': 'Do not Disturb'}
            elif params['mode'] == 1:
                user['status'] = {'icon': 'orange', 'text': 'Inactive'}

REGEX_USERNAME = re.compile('^(?=.{3,}$)[a-zA-Z0-9_\-\.]*$')
server = Disclone(path=PATH, configFile="/server.ini")
