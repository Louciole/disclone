from vesta import Server

from datetime import datetime
from os.path import abspath, dirname, join
PATH =  abspath(join(dirname(__file__),".."))


class Cron(Server):
    def exec(self):
        self.cleanStatus()

    def cleanStatus(self):
        expired = self.db.getFilters("status", ["expiration", "<", datetime.now(), "AND","expiration", "IS NOT", None])
        for record in expired:
            self.db.edit("status", record["id"], "expiration", None)
            self.db.edit("status", record["id"], "text", "")
            self.db.edit("status", record["id"], "emoji", "")

task = Cron(path=PATH, configFile="/server.ini", noStart=True)
task.exec()
