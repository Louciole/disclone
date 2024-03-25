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

    def onLogin(self, uid):
        if not self.db.getSomething("disclone_account", uid):
            self.db.insertDict("disclone_account", {"id": uid, "username": '#' + str(uid)})
        # self.db.insertDict("connection", {"userid": uid})

    def getUserConnection(self, id):
        return self.db.getSomething("active_client", id, "userid")

    def newConv(self, name, members):
        account_id = self.getUser()
        conv_id = self.db.insertDict('conversation', {'name': name}, getId=True)
        self.db.insertDict('accessconversation', {'account': account_id, 'conversation': conv_id})
        for i in range(0, len(members)):  # this could be batched !
            self.db.insertDict('accessconversation', {'account': members[i], 'conversation': conv_id})
        return conv_id
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
        return json.dumps(convs)

    @cherrypy.expose
    def getUsersInfo(self, users):
        uid = self.getUser()
        users = self.db.getFilters("disclone_account", ["id", "in", json.loads(users)])
        return json.dumps(users)

    @cherrypy.expose
    def getUserInfo(self):
        uid = self.getUser()
        user = self.db.getSomething("disclone_account", uid)
        return json.dumps(user)

    @cherrypy.expose
    def sendMessage(self, conv, content):
        uid = self.getUser()
        print("YO", conv)
        conv = json.loads(conv)
        print(conv)
        if not conv.get("id"):
            conv["id"] = self.newConv("Noname", [uid, conv["dest"]])

        self.db.insertDict("message", {"sender": uid, "place": conv["id"], "body": content})

        return self.getUserConnection(conv["dest"])



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
                                            ["(kopinprincipal", "=", uid, "or", "kopinsecondaire", "=", friend['id'],
                                             ") and (", "(kopinprincipal", "=", friend['id'], "or", "kopinsecondaire",
                                             "=", uid, ')'])
            if friendship:
                return "You're already friends/invitation already sent"
            self.db.insertDict("boatakopin",
                               {"kopinprincipal": uid, "kopinsecondaire": friend['id'], "accepted": False})
            return "ok"
        elif action == "accept":
            friendship = self.db.getFilters("boatakopin", ["id", "=", arg, "and", "kopinsecondaire", "=", uid])
            if friendship:
                self.db.edit("boatakopin", arg, "accepted", True)
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
