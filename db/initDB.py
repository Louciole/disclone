from sakura import Server
from os.path import abspath, dirname
import sys
from psycopg import sql

PATH = dirname(abspath(__file__))


class DBInitializer(Server):
    def initUniauth(self):
        if sys.argv[1].upper() == 'Y':
            self.uniauth.initUniauth()

    def initDB(self):
        self.referenceUniauth()
        self.db.cur.execute(open(self.path + "/db/schema.sql", "r").read())
        self.db.conn.commit()

    def referenceUniauth(self):
        self.db.cur.execute("CREATE EXTENSION if not exists postgres_fdw;")
        self.db.cur.execute(
            sql.SQL("""
            CREATE SERVER uniauth
            FOREIGN DATA WRAPPER postgres_fdw
            OPTIONS (host {}, port {}, dbname {});
            """).format(
                sql.Literal(self.config.get('UNIAUTH', 'DB_HOST')),
                sql.Literal(self.config.get('UNIAUTH', 'DB_PORT')),
                sql.Literal(self.config.get('UNIAUTH', 'DB_NAME'))
            ))

        self.db.cur.execute(
            sql.SQL("""
            CREATE USER MAPPING FOR CURRENT_USER SERVER uniauth
            OPTIONS (user '%s', password '%s');
            """).format(
                sql.Literal(self.config.get('DB', 'DB_USER')),
                sql.Literal(self.config.get('DB', 'DB_PASSWORD'))
            ))
        self.db.cur.execute(
            """
            CREATE FOREIGN TABLE accounts (id bigserial NOT NULL)
            SERVER uniauth
            OPTIONS (schema_name 'public', table_name 'accounts');
            """)



initializer = DBInitializer(path=PATH[:-3], configFile="/server.ini", noStart=True)
initializer.initUniauth()
initializer.initDB()
print("DB ready")
