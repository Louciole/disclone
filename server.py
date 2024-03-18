from sakura import Server
import cherrypy
import json

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
            self.db.insertDict("disclone_account", {"id": uid, "username": '#'+str(uid)})


    #-----------------------------------API-------------------------------------

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
    def sendMessage(self):
        pass

    @cherrypy.expose
    def friends(self, action, arg=""):
        uid = self.getUser()
        if action == "add":
            friend = self.db.getSomething("disclone_account", arg, "username")
            if not friend:
                return "user not found"
            friendship = self.db.getFilters("boatakopin", ["(kopinprincipal", "=", uid, "or", "kopinsecondaire", "=", friend['id'], ") and (", "(kopinprincipal", "=", friend['id'], "or", "kopinsecondaire", "=", uid, ')'])
            if friendship:
                return "You're already friends/invitation already sent"
            self.db.insertDict("boatakopin", {"kopinprincipal": uid, "kopinsecondaire": friend['id'], "accepted": False})
            return "ok"
        elif action == "accept":
            self.db.edit("boatakopin", arg, "accepted", True)
        elif action == "get":
            friends = self.db.getFilters("boatakopin", ["accepted", "=", True, "and (", "kopinprincipal", "=", uid, "or", "kopinsecondaire", "=", uid, ")"])
            return json.dumps(friends)
        elif action == "invitations":
            invitations = self.db.getFilters("boatakopin", ["accepted", "=", False, "and (", "kopinprincipal", "=", uid, "or", "kopinsecondaire", "=", uid, ")"])
            return json.dumps(invitations)


    @cherrypy.expose
    def change(self, element, value):
        uid = self.getUser()
        if not self.db.getSomething("disclone_account", value, element):
            self.db.edit("disclone_account", uid, element, value)
        else:
            return "this "+element+" already exists"


Disclone(path=PATH, configFile="/server.ini")
