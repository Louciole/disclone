from vesta import Server

from datetime import datetime
from os.path import abspath, dirname, join
PATH =  abspath(join(dirname(__file__),".."))


class Cron(Server):
    def exec(self):
        pass

task = Cron(path=PATH, configFile="/server.ini", noStart=True)
task.exec()
