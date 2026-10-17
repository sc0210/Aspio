"""The retired AI chat's tables, and nothing else.

/chat was removed on 2026-09-17: it matched keywords against four English
templates rather than calling a model, and had no sessions on record. Its API
went with it. The models stay registered so `chat_sessions` and
`chat_messages` remain in Alembic's metadata. Deleting them would make the next
autogenerate emit DROP TABLE for both, and a table drop is a schema change: a
migration plus idempotent SQL for the Pi, shipped on purpose rather than as a
side effect. Account deletion still clears `chat_sessions`
(admin/services.py).
"""