create table disclone_account(
    id int NOT NULL PRIMARY KEY,
    display varchar(24) DEFAULT 'Disclone User',
    username varchar(24) NOT NULL
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
    name varchar(255) NOT NULL
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
    timestamp DATE DEFAULT CURRENT_TIMESTAMP
);

create table if not exists boatakopin (
    id bigserial NOT NULL PRIMARY KEY,
    kopinPrincipal integer not null,
    kopinSecondaire integer not null,
    accepted bool
);

create table if not exists active_client (
    id bigserial NOT NULL PRIMARY KEY,
    userid integer not null,
    SDP text
);
