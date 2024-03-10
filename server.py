from sakura import Server
import cherrypy

from os.path import abspath, dirname
PATH = dirname(abspath(__file__))

class Disclone(Server):
    @cherrypy.expose
    def index(self):
        return open(PATH + "/ressources/home/home.html")

    @cherrypy.expose
    def channels(self, uid="me"):
        return open(PATH + "/ressources/me.html")


Disclone(path=PATH, configFile="/server.ini")
