from cerise import Cerise
import cherrypy

from os.path import abspath, dirname
PATH = dirname(abspath(__file__))

class Disclone(Cerise):
    @cherrypy.expose
    def index(self):
        return open(PATH + "/ressources/home/home.html")


Disclone(path=PATH, configFile="/server.ini")
