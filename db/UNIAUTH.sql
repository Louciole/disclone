create table accounts (
    id bigserial NOT NULL PRIMARY KEY,
    email varchar(319),
    password bytea not null,
    inscription date,
    verified boolean,
    parrain int
);
ALTER TABLE accounts
ADD CONSTRAINT PARRAIN_CONSTRAINT
FOREIGN KEY (parrain)
REFERENCES accounts (id)
ON UPDATE CASCADE;

create table verif_codes (
    id integer NOT NULL PRIMARY KEY,
    code varchar(6) NOT NULL,
    expiration timestamp NOT NULL
);

create table companies (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(22) NOT NULL
);

create table membership (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    company integer NOT NULL
);

ALTER TABLE membership
    ADD CONSTRAINT MEM_USER_CONSTRAINT FOREIGN KEY (account) REFERENCES accounts (id) ON UPDATE CASCADE;
ALTER TABLE membership
    ADD CONSTRAINT MEM_COMPANY_CONSTRAINT FOREIGN KEY (company) REFERENCES companies (id) ON UPDATE CASCADE;

create table pendingMembership (
    id bigserial NOT NULL PRIMARY KEY,
    email varchar(319),
    company integer NOT NULL
);
ALTER TABLE pendingMembership
    ADD CONSTRAINT PEND_MEM_COMPANY_CONSTRAINT FOREIGN KEY (company) REFERENCES companies (id) ON UPDATE CASCADE;




