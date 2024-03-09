CREATE EXTENSION postgres_fdw;

CREATE SERVER uniauth
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5432', dbname 'seedtest');

CREATE USER MAPPING FOR lou
    SERVER uniauth
    OPTIONS (user 'lou', password 'PASSWORD');

CREATE FOREIGN TABLE accounts (
    id bigserial NOT NULL
    )
    SERVER uniauth
    OPTIONS (schema_name 'public', table_name 'accounts');


create table server (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(44) NOT NULL,
    owner integer NOT NULL
);

create table accessServer (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    server integer NOT NULL
);

create table conversation (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(255) NOT NULL
);

create table accessConversation (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    conversation integer NOT NULL
);

create table channelMessage (
    id bigserial NOT NULL PRIMARY KEY,
    sender integer NOT NULL,
    server integer NOT NULL,
    body TEXT,
    timestamp DATE DEFAULT CURRENT_TIMESTAMP
);

create table convMessage (
    id bigserial NOT NULL PRIMARY KEY,
    sender integer NOT NULL,
    server integer NOT NULL,
    body TEXT,
    timestamp DATE DEFAULT CURRENT_TIMESTAMP
);

create table threadMessage (
    id bigserial NOT NULL PRIMARY KEY,
    sender integer NOT NULL,
    server integer NOT NULL,
    body TEXT,
    timestamp DATE DEFAULT CURRENT_TIMESTAMP
);

create table postMessage (
    id bigserial NOT NULL PRIMARY KEY,
    sender integer NOT NULL,
    server integer NOT NULL,
    body TEXT,
    timestamp DATE DEFAULT CURRENT_TIMESTAMP
);

create table post (
    id bigserial NOT NULL PRIMARY KEY,
    server integer NOT NULL
);

create table thread (
    id bigserial NOT NULL PRIMARY KEY,
    server integer NOT NULL
);

create table channel (
    id bigserial NOT NULL PRIMARY KEY,
    server integer NOT NULL
);

create table role (
     id bigserial NOT NULL PRIMARY KEY,
     server integer NOT NULL
);

create table roleAccess (
     id bigserial NOT NULL PRIMARY KEY,
     server integer NOT NULL
);

create table channelAccess (
    id bigserial NOT NULL PRIMARY KEY,
    server integer NOT NULL
);
