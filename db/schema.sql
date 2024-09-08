create table disclone_account(
    id int NOT NULL PRIMARY KEY,
    display varchar(24) DEFAULT 'Disclone User',
    username varchar(24) NOT NULL,
    inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pronouns varchar(24),
    description varchar(250),
    faction integer
);

create table status(
   id int NOT NULL PRIMARY KEY,
   mode numeric not null default 0,
   emoji varchar,
   text varchar(40),
   expiration timestamp
);

create table if not exists server (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(44) NOT NULL,
    owner integer NOT NULL
);

create table if not exists accessServer (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    server integer NOT NULL
);
ALTER TABLE accessServer
ADD CONSTRAINT SERVACC_SERV_CONSTRAINT FOREIGN KEY (server) REFERENCES server (id) ON UPDATE CASCADE;

create table if not exists conversationElement (
    id bigserial NOT NULL PRIMARY KEY
);

create table if not exists conversation (
    name varchar(255) NOT NULL,
    private bool default true
) inherits (conversationElement);

create table if not exists accessConversation (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    conversation integer NOT NULL
);

create table if not exists message (
    id bigserial NOT NULL PRIMARY KEY,
    sender integer NOT NULL,
    place integer NOT NULL,
    body TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reply integer REFERENCES message(id)
);

create table if not exists blockship (
    id bigserial NOT NULL PRIMARY KEY,
    blocker integer not null,
    blocked integer not null
);

create table if not exists boatakopin (
    id bigserial NOT NULL PRIMARY KEY,
    kopinPrincipal integer not null,
    kopinSecondaire integer not null,
    accepted bool,
    conv integer
);

create table if not exists active_client (
    id bigserial NOT NULL PRIMARY KEY,
    userid integer not null,
    server integer not null,
    idle bool default false
);

create table if not exists subscription (
    client INTEGER NOT NULL,
    account INTEGER NOT NULL,
    PRIMARY KEY (client, account)
);
