echo --------------------------INSTALLING PYTHON DEPENDENCIES------------------------
sudo apt install postgresql postgresql-contrib -y
sudo apt install build-essential -y
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install python3.11
sudo apt install python3.11-dev -y
sudo apt install libpq-dev -y
sudo apt install python3.11-venv -y
python3.11 -m venv ./venv/
source venv/bin/activate
#installing psycopg here to get the C implem in place of th pure python one
pip install "psycopg[c]"
pip install git+https://gitlab.com/Louciole/sakura.git/
pip install -r requirements.txt
sudo apt install nginx -y
sudo apt install systemd -y
python3 ./install.py all
