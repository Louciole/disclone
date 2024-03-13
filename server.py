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
    def getUserInfo(self):
        uid = self.getUser()
        user = self.db.getSomething("disclone_account", uid)
        return json.dumps(user)

    @cherrypy.expose
    def sendMessage(self):
        pass

    @cherrypy.expose
    def change(self, element, value):
        uid = self.getUser()
        if not self.db.getSomething("disclone_account", value, element):
            self.db.edit("disclone_account", uid, element, value)
        else:
            return "this "+element+" already exists"


Disclone(path=PATH, configFile="/server.ini")
