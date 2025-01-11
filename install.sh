echo --------------------------INSTALLING PYTHON DEPENDENCIES------------------------
sudo apt install -y postgresql postgresql-contrib
sudo apt install -y build-essential
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install python3.11
sudo apt install -y python3.11-dev
sudo apt install -y libpq-dev
sudo apt install -y python3.11-venv
python3.11 -m venv ./venv/
source venv/bin/activate
#installing psycopg here to get the C implem in place of th pure python one
pip install "psycopg[c]"
pip install git+https://gitlab.com/Louciole/sakura.git/
pip install -r requirements.txt
sudo apt install nginx -y
sudo apt install systemd -y
python3 ./install.py all
