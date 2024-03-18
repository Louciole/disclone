echo --------CHECKING DEPENDENCIES-----
sudo apt-get install -y systemd
echo ----------CREATING FILE-----------
cp ./misc/disclone.service /etc/systemd/system/disclone.service
echo ----------SOURCING---------
sudo systemctl daemon-reload
sudo systemctl enable disclone.service
echo ----------STARTING SERVICE---
sudo systemctl start disclone.service
