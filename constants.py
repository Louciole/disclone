import string
from os.path import abspath, dirname

# Base62 alphabet for short ids / API keys.
B62 = string.digits + string.ascii_letters

# Project root. ``constants.py`` sits next to ``server.py``, so this resolves to
# the same directory the server used before these constants were extracted.
PATH = dirname(abspath(__file__))

# Storage quota constants (in bytes)
USER_STORAGE_QUOTA = 15 * 1024 * 1024 * 1024  # 15 GB
SERVER_STORAGE_QUOTA = 5 * 1024 * 1024 * 1024  # 5 GB
