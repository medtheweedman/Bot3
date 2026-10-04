---
name: WhatsApp reply delivery safety
description: Safety invariant for manually approved outgoing WhatsApp replies.
---

If a send outcome cannot be confirmed, mark the inbox item as uncertain and require the operator to check WhatsApp before retrying or dismissing it. Never retry such a reply automatically.

**Why:** a network or provider error after submission can mean WhatsApp accepted the message even though confirmation did not return, which risks sending duplicates.

**How to apply:** Preserve this behavior when changing manual inbox sends, retries, reconnect recovery, or future background jobs.