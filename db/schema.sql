create table if not exists mycelium_account(
    id int NOT NULL PRIMARY KEY,
    display varchar(24) DEFAULT 'Mycelium User',
    username varchar(24) NOT NULL,
    inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    pronouns varchar(24),
    description varchar(250),
    faction integer,
    pfp text,
    banner text,
    current_room integer,
    storage_usage bigint DEFAULT 0
);

create table if not exists status(
   id int NOT NULL PRIMARY KEY,
   mode numeric not null default 0,
   emoji varchar,
   text varchar(40),
   expiration timestamp
);

create table if not exists server (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(44) NOT NULL,
    owner integer NOT NULL,
    pfp text,
    is_community boolean DEFAULT false,
    tags jsonb DEFAULT '[]',
    languages jsonb DEFAULT '[]',
    is_featured boolean DEFAULT false,
    description text,
    member_count integer DEFAULT 0,
    storage_usage bigint DEFAULT 0
);

create table if not exists accessServer (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE
);

-- Trigger function to update server member_count
CREATE OR REPLACE FUNCTION update_server_member_count()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        UPDATE server SET member_count = member_count + 1 WHERE id = NEW.server;
    ELSIF (TG_OP = 'DELETE') THEN
        UPDATE server SET member_count = member_count - 1 WHERE id = OLD.server;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on accessServer for member_count
DROP TRIGGER IF EXISTS update_member_count_trigger ON accessServer;
CREATE TRIGGER update_member_count_trigger
AFTER INSERT OR DELETE ON accessServer
FOR EACH ROW
EXECUTE FUNCTION update_server_member_count();

create table if not exists server_cat (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(44) NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE,
    place float NOT NULL DEFAULT 0.1
);

create table if not exists conversationElement (
    id bigserial NOT NULL PRIMARY KEY
);

create table if not exists conversation (
    name varchar(255) NOT NULL,
    private bool default true
) inherits (conversationElement);

create table if not exists textual_channel (
    name varchar(255) NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE,
    category integer,
    place float NOT NULL DEFAULT 0.1,
    is_private boolean DEFAULT false
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
    reply integer REFERENCES message(id),
    edited bool default false,
    attachments json
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

create table if not exists invitation (
    id bigserial NOT NULL PRIMARY KEY,
    server integer not null references server(id) ON DELETE CASCADE,
    link varchar(8) NOT NULL,
    expiration TIMESTAMP
);

create table if not exists role (
    id bigserial NOT NULL PRIMARY KEY,
    server integer NOT NULL references server(id) ON DELETE CASCADE,
    name varchar(24) NOT NULL,
    color varchar(7) DEFAULT '#A8A8A8',
    permissions jsonb DEFAULT '{}'
);


create table if not exists role_attribution (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    role integer NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE
);

create table if not exists offline_notifs (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL,
    conversation integer NOT NULL,
    number integer NOT NULL DEFAULT 1
);

create table if not exists op_servs (
    id bigserial NOT NULL PRIMARY KEY,
    server integer NOT NULL references server(id) ON DELETE CASCADE
);

create table if not exists drive_channel (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(255) NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE,
    category integer,
    place float NOT NULL DEFAULT 0.1,
    is_private boolean DEFAULT false
);

create table if not exists vocal_channel (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(255) NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE,
    category integer,
    place float NOT NULL DEFAULT 0.1,
    is_private boolean DEFAULT false
);

create table if not exists notes_channel (
    id bigserial NOT NULL PRIMARY KEY,
    name varchar(255) NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE,
    category integer,
    place float NOT NULL DEFAULT 0.1,
    is_private boolean DEFAULT false
);

create table if not exists note_block (
    id bigserial NOT NULL PRIMARY KEY,
    channel integer NOT NULL,
    parent_block integer REFERENCES note_block(id),
    type varchar(50) NOT NULL,
    position float NOT NULL DEFAULT 0.1,
    content text default '',
    uuid varchar(36) NOT NULL UNIQUE
);

create table if not exists note_database (
    id bigserial NOT NULL PRIMARY KEY,
    block_uuid varchar(36) NOT NULL REFERENCES note_block(uuid) ON DELETE CASCADE,
    channel integer NOT NULL,
    name varchar(255) NOT NULL DEFAULT 'Untitled Database',
    view_type varchar(10) NOT NULL DEFAULT 'table',
    gallery_cover_column integer,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

create table if not exists note_database_column (
    id bigserial NOT NULL PRIMARY KEY,
    database_id integer NOT NULL REFERENCES note_database(id) ON DELETE CASCADE,
    name varchar(255) NOT NULL DEFAULT 'Column',
    type varchar(20) NOT NULL DEFAULT 'text',
    position float NOT NULL DEFAULT 0.1,
    options jsonb DEFAULT '{}'
);

create table if not exists note_database_row (
    id bigserial NOT NULL PRIMARY KEY,
    database_id integer NOT NULL REFERENCES note_database(id) ON DELETE CASCADE,
    position float NOT NULL DEFAULT 0.1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

create table if not exists note_database_cell (
    id bigserial NOT NULL PRIMARY KEY,
    row_id integer NOT NULL REFERENCES note_database_row(id) ON DELETE CASCADE,
    column_id integer NOT NULL REFERENCES note_database_column(id) ON DELETE CASCADE,
    value text DEFAULT '',
    UNIQUE(row_id, column_id)
);

create index if not exists idx_note_database_block on note_database(block_uuid);
create index if not exists idx_note_database_column_db on note_database_column(database_id);
create index if not exists idx_note_database_row_db on note_database_row(database_id);
create index if not exists idx_note_database_cell_row on note_database_cell(row_id);
create index if not exists idx_note_database_cell_col on note_database_cell(column_id);

create table if not exists API_key (
    id bigserial NOT NULL PRIMARY KEY,
    key varchar(64) UNIQUE NOT NULL,
    owner integer NOT NULL,
    name varchar(255) DEFAULT ''
);

create table if not exists personal_server(
    id bigserial NOT NULL PRIMARY KEY,
    owner integer NOT NULL,
    server integer NOT NULL references server(id) ON DELETE CASCADE
);

create table if not exists drive_folder (
    id bigserial NOT NULL PRIMARY KEY,
    drive_channel integer NOT NULL,
    foldername varchar(255) NOT NULL,
    parent_folder integer,
    creator integer NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_folder) REFERENCES drive_folder(id) ON DELETE CASCADE
);

create table if not exists drive_file (
    id bigserial NOT NULL PRIMARY KEY,
    drive_channel integer NOT NULL,
    filename varchar(255) NOT NULL,
    filepath text NOT NULL,
    size bigint,
    uploader integer NOT NULL,
    version_count integer NOT NULL DEFAULT 1,
    parent_folder integer,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_folder) REFERENCES drive_folder(id) ON DELETE CASCADE
);

create table if not exists drive_file_version (
    id bigserial NOT NULL PRIMARY KEY,
    drive_file integer NOT NULL REFERENCES drive_file(id) ON DELETE CASCADE,
    version_number integer NOT NULL,
    filename varchar(255) NOT NULL,
    filepath text NOT NULL,
    size bigint,
    uploader integer NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(drive_file, version_number)
);

create index if not exists idx_drive_file_version_file on drive_file_version(drive_file);

create table if not exists call_session (
    id bigserial NOT NULL PRIMARY KEY,
    conversation_id integer NOT NULL,
    participants jsonb NOT NULL DEFAULT '[]',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    call_type varchar(10) NOT NULL DEFAULT 'audio',
    mode varchar(10) NOT NULL DEFAULT 'p2p',
    active boolean NOT NULL DEFAULT true
);

create index if not exists idx_call_session_conversation on call_session(conversation_id);
create index if not exists idx_call_session_active on call_session(active);

create table if not exists channel_permission (
    id bigserial NOT NULL PRIMARY KEY,
    channel integer NOT NULL,
    channel_type varchar(20) NOT NULL,
    role integer NOT NULL references role(id) ON DELETE CASCADE,
    server integer NOT NULL references server(id) ON DELETE CASCADE,
    permissions jsonb DEFAULT '{}'
);

create index if not exists idx_channel_permission_channel on channel_permission(channel, channel_type);
create index if not exists idx_channel_permission_role on channel_permission(role);

create table if not exists device_token (
    id bigserial NOT NULL PRIMARY KEY,
    account integer NOT NULL references mycelium_account(id) ON DELETE CASCADE,
    token text NOT NULL,
    platform varchar(10) NOT NULL DEFAULT 'fcm', -- 'ios', 'android', 'fcm'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account, token)
);

create index if not exists idx_device_token_account on device_token(account);

create table if not exists poll (
    id bigserial NOT NULL PRIMARY KEY,
    message integer NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    question text NOT NULL,
    multiple_choice boolean DEFAULT false,
    allow_user_options boolean DEFAULT false
);

create index if not exists idx_poll_message on poll(message);

create table if not exists poll_option (
    id bigserial NOT NULL PRIMARY KEY,
    poll integer NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
    text text NOT NULL,
    creator integer NOT NULL
);

create index if not exists idx_poll_option_poll on poll_option(poll);

create table if not exists poll_vote (
    id bigserial NOT NULL PRIMARY KEY,
    poll integer NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
    option integer NOT NULL REFERENCES poll_option(id) ON DELETE CASCADE,
    voter integer NOT NULL,
    UNIQUE(poll, option, voter)
);

create index if not exists idx_poll_vote_poll on poll_vote(poll);
create index if not exists idx_poll_vote_option on poll_vote(option);

