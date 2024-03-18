# Disclone.

❓️A shitty Discord clone based on sakura. <br>  
🌍 Production : https://disclone.carbonlab.dev <br>
🟢 Status : https://louciole.github.io/carbon-status/ <br>
🏀 Roadmap : https://smoop.carbonlab.dev/project?uid=53&&access=read-only


## Frontend ! 
In the enchanted forest of Disclone, nestled amidst ancient trees, lies a hidden archive. It beckons to adventurers, promising the secrets of forgotten magic. Guided by whispers of wind, they find the portal and enter a realm of wonders. There, a standalone frontend awaits, a fusion of ancient wisdom and modern marvels. As they explore its depths, they become guardians of knowledge, entrusted with preserving Disclone's magic for eternity.

Repo :
    https://gitlab.com/Louciole/disclone/-/tree/front-archive?ref_type=heads

Deployment : 
    https://louciole.gitlab.io/disclone/

## 🏎️ getting started

### install :

0. install postgresql

       apt install postgresql postgresql-contrib -y
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