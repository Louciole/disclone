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
ALTER TABLE accessServer
ADD CONSTRAINT SERVACC_SERV_CONSTRAINT FOREIGN KEY (server) REFERENCES server (id) ON UPDATE CASCADE;

create table conversationElement (
    id bigserial NOT NULL PRIMARY KEY
);

create table conversation (
    name varchar(255) NOT NULL
) inherits (conversationElement);

create table accessConversation (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    conversation integer NOT NULL
);

create table message (
    id bigserial NOT NULL PRIMARY KEY,
    sender integer NOT NULL,
    place integer NOT NULL,
    body TEXT,
    timestamp DATE DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE message
ADD CONSTRAINT MSG_PLACE_CONSTRAINT FOREIGN KEY (place) REFERENCES conversationElement (id) ON UPDATE CASCADE;
