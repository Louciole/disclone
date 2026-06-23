"""Message display-enrichment and notification helpers shared between the
messaging/conversation/server route modules and forumManager.

Module-level functions taking the live Mycelium instance as ``self``; they call
back into class methods (db access, checkChannelAccess, sendPushNotification,
_sheet_ref, _get_sheet_col_widths) via ``self``.
"""
import json
import re


def notifyChannelMesage(self, uid, channel, message, channel_type="textual"):
    if channel:
        server_id = channel["server"]
        mention_targets = set()

        # Parse <@everyone> – notify all server members
        if "<@everyone>" in message["body"]:
            server_members = self.db.getFilters("accessserver", ["server", "=", server_id])
            for m in server_members:
                mention_targets.add(m["account"])

        # Parse <@here> – notify online server members
        if "<@here>" in message["body"]:
            server_members = self.db.getFilters("accessserver", ["server", "=", server_id])
            for m in server_members:
                online = self.db.getSomething("active_client", m["account"], "userid")
                if online:
                    mention_targets.add(m["account"])

        # Parse <@&roleId> – notify all members with that role
        role_mentions = re.findall(r'<@&(\d+)>', message["body"])
        for role_id in role_mentions:
            role_members = self.db.getFilters("role_attribution", ["role", "=", int(role_id), "and", "server", "=", server_id])
            for rm in role_members:
                mention_targets.add(rm["account"])

        # Parse <@userId> – notify specific users (for explicit @user mentions)
        user_mentions = re.findall(r'<@(\d+)>', message["body"])
        for mentioned_uid in user_mentions:
            mention_targets.add(int(mentioned_uid))

        mention_targets.discard(uid)  # Don't notify the sender

        # For private channels, filter targets to only those who can view the channel
        if channel.get("is_private"):
            mention_targets = {t for t in mention_targets if self.checkChannelAccess(t, channel["id"], channel_type, "view")}

        # Broadcast the message to ALL server members (for live display in active channel views)
        # Mention targets additionally get offline notifications
        all_members = self.db.getFilters("accessserver", ["server", "=", server_id])
        for m in all_members:
            member_uid = m["account"]
            if member_uid == uid:
                continue
            # Skip private channel members without access
            if channel.get("is_private") and not self.checkChannelAccess(member_uid, channel["id"], channel_type, "view"):
                continue
            self.sendNotification(member_uid, {"type": "message", "content": message})

        sender = self.db.getSomething("mycelium_account", uid)
        sender_name = sender.get("display", "Someone") if sender else "Someone"
        sender_pfp = sender.get("pfp") if sender else None
        avatar_url = f"https://mycelium.carbonlab.dev/static/attachments/{sender_pfp}" if sender_pfp else ""

        # Offline notifs only for mention targets
        for target_uid in mention_targets:
            notif = self.db.getFilters("offline_notifs", ["account", "=", target_uid, "and", "conversation", "=", channel["id"]])
            if notif:
                self.db.edit("offline_notifs", notif[0]["id"], "number", notif[0]["number"] + 1)
            else:
                self.db.insertDict("offline_notifs", {"account": target_uid, "conversation": channel["id"]})

            # Push Notification for a channel message — same unified "message"
            # contract as DMs (repliable + threaded). serverId marks it as a
            # channel (drives navigation + a distinct thread id); groupTitle is
            # the channel name shown as the conversation title.
            self.sendPushNotification(target_uid, {
                "title": sender_name,
                "body": message.get("body", "New message"),
                "data": {
                    "type": "message",
                    "convId": str(channel["id"]),
                    "serverId": str(server_id),
                    "groupTitle": channel.get("name", "channel"),
                    "avatarUrl": avatar_url,
                }
            })


def _enrichMessagesWithPolls(self, messages, uid):
    """Enrich messages that have poll attachments with full poll data."""
    for msg in messages:
        attachments = msg.get("attachments")
        if attachments:
            if isinstance(attachments, str):
                try:
                    attachments = json.loads(attachments)
                except:
                    continue
            for att in attachments:
                if isinstance(att, dict) and att.get("type") == "poll":
                    poll = self.db.getSomething("poll", att["pollId"])
                    if poll:
                        options = self.db.getAll("poll_option", poll["id"], "poll")
                        votes = self.db.getAll("poll_vote", poll["id"], "poll")
                        # Build votes dict: {option_id: [voter_ids]}
                        votes_dict = {}
                        for v in votes:
                            oid = v["option"]
                            if oid not in votes_dict:
                                votes_dict[oid] = []
                            votes_dict[oid].append(v["voter"])
                        msg["poll"] = {
                            "id": poll["id"],
                            "question": poll["question"],
                            "multiple_choice": poll["multiple_choice"],
                            "allow_user_options": poll["allow_user_options"],
                            "options": [{"id": o["id"], "text": o["text"], "creator": o["creator"]} for o in options],
                            "votes": {str(k): v for k, v in votes_dict.items()}
                        }


def _enrichMessagesWithReactions(self, messages):
    for msg in messages:
        reactions = self.db.getAll("message_reaction", msg["id"], "message")
        reactions_dict = {}
        for r in reactions:
            emoji = r["emoji"]
            if emoji not in reactions_dict:
                reactions_dict[emoji] = []
            reactions_dict[emoji].append(r["account"])
        msg["reactions"] = reactions_dict


def _enrichMessagesWithConvBlocks(self, messages):
    for msg in messages:
        atts = msg.get("attachments") or []
        if isinstance(atts, str):
            try: atts = json.loads(atts)
            except: atts = []
        if not isinstance(atts, list):
            atts = []
        for att in atts:
            if isinstance(att, dict) and att.get("type") == "conv_spreadsheet":
                sheet = self.db.getSomething("note_spreadsheet", att["uuid"], "block_uuid")
                if sheet:
                    cells_data = self.db.getFilters("note_spreadsheet_cell",
                        ["spreadsheet_id", "=", sheet["id"]]) or []
                    cells = {self._sheet_ref(c["col_idx"], c["row_idx"]): c["value"]
                             for c in cells_data}
                    col_widths = self._get_sheet_col_widths(sheet["id"])
                    msg["convSpreadsheet"] = {
                        "uuid": sheet["block_uuid"], "id": sheet["id"],
                        "rows": sheet["rows"], "cols": sheet["cols"],
                        "cells": cells, "col_widths": col_widths
                    }
