import sys
from configparser import ConfigParser
from os.path import abspath, dirname
import subprocess

PATH = dirname(abspath(__file__))


class Installer:
    def __init__(self, configFile, arg="all"):
        self.importConf(configFile)
        self.uniauth = "N"
        self.name = self.config.get("server", "SERVICE_NAME").replace(" ", "_").upper()

        if arg == "all" or arg == "a":
            self.installAll()
        elif arg == "nginx":
            if len(sys.argv) > 2 and sys.argv[2] == "reset":
                self.nukeNginx()
                self.installNginx(link=False)
            else:
                self.installNginx()
        elif arg == "db":
            self.installDB()
        elif arg == "uniauth":
            self.installUniauth()
        elif arg == "sakura":
            self.resetSakura()
        elif arg == "reset":
            self.resetDB()
        elif arg == "service":
            self.installService()
        elif arg == "cron":
            self.setupCrons()

    def ex(self, command):
        subprocess.run(command, shell=True, check=True)

    def installDB(self):
        print("----DB----")
        self.ex("sudo -u postgres createdb " + self.config.get("DB", "DB_NAME"))
        self.ex("sudo -u postgres createuser " + self.config.get("DB", "DB_USER") + " -s --pwprompt ")

    def resetSakura(self):
        self.ex("pip uninstall sakura")
        self.ex("pip install git+https://gitlab.com/Louciole/sakura.git/")

    def installUniauth(self):
        print("----UNIAUTH----")
        while True:
            uniauth = input("Do you want to create a uniauth database? (y/n)")
            if uniauth.upper() == 'Y' or uniauth.upper() == 'N':
                self.uniauth = uniauth.upper()
                break

        if self.uniauth == 'Y':
            self.ex("sudo -u postgres createdb " + self.config.get("UNIAUTH", "DB_NAME"))

    def initDB(self):
        self.ex("python3 ./db/initDB.py " + self.uniauth)

    def resetDB(self):
        self.ex("sudo -u postgres dropdb " + self.config.get("DB", "DB_NAME"))
        self.initDB()

    def installAll(self):
        self.installNginx()
        self.installDB()
        self.installUniauth()
        self.initDB()

    def installNginx(self, link=True):
        print("----NGINX----")

        if self.config.getboolean("server", "DEBUG"):
            self.editFile("misc/nginx_local", {"[PATH]": PATH, "[SERV-PORT]": self.config.get("server", "PORT")})
            self.ex("sudo cp ./misc/nginx_local_filled /etc/nginx/sites-available/" + self.name)
        else:
            self.editFile("misc/nginx_local", {"[PATH]": PATH, "[SERV-PORT]": self.config.get("server", "PORT"), "[WS-PORT]": self.config.get("notification", "PORT")})
            self.ex("sudo cp ./misc/nginx_prod_filled /etc/nginx/sites-available/" + self.name)

        if not link:
            return

        self.ex("sudo ln -s /etc/nginx/sites-available/" + self.name + " /etc/nginx/sites-enabled/")

    def setupCrons(self):
        try:
            self.ex("crontab -l > crontab")
        except Exception:
            pass
        self.ex("echo '*/15 * * * * " + PATH + "/venv/bin/python3 " + PATH + "/crons/15mins.py' >> crontab")
        self.ex("echo '0 * * * * " + PATH + "/venv/bin/python3 " + PATH + "/crons/1h.py' >> crontab")
        self.ex("echo '0 0 * * * " + PATH + "/venv/bin/python3 " + PATH + "/crons/1day.py' >> crontab")
        self.ex("crontab crontab")

    def editFile(self, file, templates):
        with open(file, "r+") as f:
            data = f.read()
            for key in templates:
                data = data.replace(key, templates[key])
        with open(file+"_filled", "w+") as f:
            f.write(data)

    def importConf(self, configFile):
        self.config = ConfigParser()
        try:
            self.config.read(configFile)
            print("config at " + configFile + " loaded")
        except Exception:
            print("please create a config file")

    def nukeNginx(self):
        self.ex("sudo rm /etc/nginx/sites-available/" + self.name)

    def installService(self):
        self.editFile("misc/sakura.service", {"[PATH]": PATH, "[SERV-PORT]": self.config.get("server", "PORT"), "[NAME]":self.config.get("server", "service_name")} )
        self.ex("cp ./misc/sakura.service_filled /etc/systemd/system/" + self.name + ".service")
        self.ex("sudo systemctl daemon-reload")
        self.ex("sudo systemctl enable " + self.name + ".service")
        self.ex("sudo systemctl start " + self.name + "disclone.service")


if len(sys.argv) > 1:
    Installer(PATH + "/server.ini", sys.argv[1])
else:
    Installer(PATH + "/server.ini")
