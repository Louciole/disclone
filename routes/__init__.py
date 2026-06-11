"""Route modules for Mycelium.

Each module in this package defines endpoint functions decorated with
``@Server.expose``. Importing a module registers its routes into Vesta's
global ``routes`` dict (see ``vesta/http/baseServer.py``); the dispatcher
calls them as ``routes[path]["target"](server_instance, **args)``, so every
function takes ``self`` (the live ``Mycelium`` instance) as its first
argument and can reach any method/attribute defined on that class.

Route modules are imported at the bottom of ``server.py`` for their
side effect of registering routes -- there is nothing to call here.
"""
