# Disclone.

❓️A shitty Discord clone based on sakura. <br>  
🌍 Production : https://disclone.carbonlab.dev <br>
🟢 Status : https://status.carbonlab.dev <br>
🏀 Roadmap : https://smoop.carbonlab.dev/project?uid=11&&access=read-only <br>
🏡 Home : https://gitlab.com/Louciole/disclone


## 🏎️ getting started

### install :


1. edit `server.ini` with your parameters


2. add the DKIM private key in `mailing/dkim.txt`

       nano mailing/dkim.txt

   or you can just copy your local file


3. Install the dependencies

       bash install.sh  

## 🖥️ Work
If you plan to commit something don't forget to IGNORE the *.ini file
run

	git update-index --assume-unchanged server.ini

## 🧶 Troubleshooting

if postgres does not accept password authentication, you can change the `pg_hba.conf` file

`sudo nano /etc/postgresql/16/main/pg_hba.conf`

replace peer by ident