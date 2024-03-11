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
        return open(PATH + "/ressources/me.html")


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
    def sendMessage(self):
        pass

Disclone(path=PATH, configFile="/server.ini")
