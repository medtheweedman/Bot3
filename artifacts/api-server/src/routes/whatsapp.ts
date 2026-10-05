import { Router, type IRouter } from "express";
import { and, count, desc, eq, ne } from "drizzle-orm";
import {
  AddWhatsAppContactBody,
  AddWhatsAppContactResponse,
  DeleteWhatsAppContactParams,
  DismissWhatsAppInboxMessageParams,
  GenerateWhatsAppInboxReplySuggestionsBody,
  GenerateWhatsAppInboxReplySuggestionsParams,
  GenerateWhatsAppInboxReplySuggestionsResponse,
  GenerateWhatsAppInboxDraftParams,
  GenerateWhatsAppInboxDraftResponse,
  GetWhatsAppStatusResponse,
  ListWhatsAppInboxResponse,
  ListWhatsAppContactsResponse,
  SaveWhatsAppInboxDraftBody,
  SaveWhatsAppInboxDraftParams,
  SaveWhatsAppInboxDraftResponse,
  SendWhatsAppInboxReplyBody,
  SendWhatsAppInboxReplyParams,
  UpdateWhatsAppSettingsBody,
} from "@workspace/api-zod";
import {
  db,
  whatsAppContactsTable,
  whatsAppConversationMemoryTable,
  whatsAppInboxTable,
  whatsAppSettingsTable,
} from "@workspace/db";
import {
  WhatsAppInboxActionError,
  whatsAppManager,
} from "../lib/whatsapp-manager";
import {
  CreatorReplyServiceError,
  generateWhatsAppReplySuggestionsWithMemory,
  generateWhatsAppReplyWithMemory,
} from "../lib/creator-reply-service";
import {
  getWhatsAppConversationContext,
  saveWhatsAppConversationSummary,
} from "../lib/whatsapp-memory";

const router: IRouter = Router();

function normalizePhoneNumber(input: string): string | null {
  if (!/^[+\d\s().-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, "");
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

function formatInboxMessage(
  message: typeof whatsAppInboxTable.$inferSelect,
  isAdultApproved: boolean,
  conversationSummary: string | null = null,
) {
  return {
    id: message.id,
    contactId: message.contactId,
    phoneNumber: `+${message.phoneNumber}`,
    displayName: message.displayName,
    messageText: message.messageText,
    replyDraft: message.replyDraft,
    isAdultApproved,
    conversationSummary,
    status: message.status,
    receivedAt: message.receivedAt.toISOString(),
  };
}

async function isAdultApprovedContact(contactId: number | null): Promise<boolean> {
  if (contactId === null) return false;
  const [contact] = await db
    .select({ adultConfirmed: whatsAppContactsTable.adultConfirmed })
    .from(whatsAppContactsTable)
    .where(eq(whatsAppContactsTable.id, contactId))
    .limit(1);
  return contact?.adultConfirmed === true;
}

router.get("/whatsapp/status", async (_req, res): Promise<void> => {
  const status = await whatsAppManager.getStatus();
  res.json(GetWhatsAppStatusResponse.parse(status));
});

router.post("/whatsapp/connect", async (req, res): Promise<void> => {
  try {
    await whatsAppManager.connect();
    res.json(GetWhatsAppStatusResponse.parse(await whatsAppManager.getStatus()));
  } catch (error) {
    req.log.error({ err: error }, "Could not start WhatsApp connection.");
    res.status(503).json({ error: "WhatsApp connection is unavailable right now." });
  }
});

router.post("/whatsapp/disconnect", async (req, res): Promise<void> => {
  try {
    await whatsAppManager.disconnect();
    res.json(GetWhatsAppStatusResponse.parse(await whatsAppManager.getStatus()));
  } catch (error) {
    req.log.error({ err: error }, "Could not disconnect WhatsApp.");
    res.status(500).json({ error: "WhatsApp could not be disconnected right now." });
  }
});

router.patch("/whatsapp/settings", async (req, res): Promise<void> => {
  const parsed = UpdateWhatsAppSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the auto-reply settings." });
    return;
  }

  const creatorName = parsed.data.creatorName.trim();
  const personaNotes = parsed.data.personaNotes?.trim() || null;
  if (parsed.data.autoReplyEnabled) {
    const [approvedContactCount] = await db
      .select({ value: count() })
      .from(whatsAppContactsTable)
      .where(eq(whatsAppContactsTable.adultConfirmed, true));
    if (!approvedContactCount?.value) {
      res.status(400).json({
        error: "Confirm at least one contact is 18 or older before enabling auto-replies.",
      });
      return;
    }
    if ((await whatsAppManager.getStatus()).connection !== "connected") {
      res.status(400).json({
        error: "Connect WhatsApp before enabling auto-replies.",
      });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: "Gemini is not configured for automatic replies.",
      });
      return;
    }
  }

  await db
    .insert(whatsAppSettingsTable)
    .values({
      id: 1,
      autoReplyEnabled: parsed.data.autoReplyEnabled,
      creatorName,
      tone: parsed.data.tone,
      personaNotes,
    })
    .onConflictDoUpdate({
      target: whatsAppSettingsTable.id,
      set: {
        autoReplyEnabled: parsed.data.autoReplyEnabled,
        creatorName,
        tone: parsed.data.tone,
        personaNotes,
        updatedAt: new Date(),
      },
    });

  res.json(GetWhatsAppStatusResponse.parse(await whatsAppManager.getStatus()));
});

router.get("/whatsapp/contacts", async (_req, res): Promise<void> => {
  const contacts = await db
    .select()
    .from(whatsAppContactsTable)
    .orderBy(desc(whatsAppContactsTable.createdAt));
  const response = contacts.map((contact) => ({
    id: contact.id,
    phoneNumber: `+${contact.phoneNumber}`,
    displayName: contact.displayName,
    adultConfirmed: contact.adultConfirmed,
    createdAt: contact.createdAt.toISOString(),
  }));
  res.json(ListWhatsAppContactsResponse.parse(response));
});

router.post("/whatsapp/contacts", async (req, res): Promise<void> => {
  const parsed = AddWhatsAppContactBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.adultConfirmed) {
    res.status(400).json({
      error: "Confirm this contact is 18 or older before approving them.",
    });
    return;
  }

  const phoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);
  if (!phoneNumber) {
    res.status(400).json({
      error: "Enter a valid international phone number with 7–15 digits.",
    });
    return;
  }

  try {
    const [contact] = await db
      .insert(whatsAppContactsTable)
      .values({
        phoneNumber,
        displayName: parsed.data.displayName?.trim() || null,
        adultConfirmed: true,
      })
      .onConflictDoUpdate({
        target: whatsAppContactsTable.phoneNumber,
        set: {
          displayName: parsed.data.displayName?.trim() || null,
          adultConfirmed: true,
        },
      })
      .returning();
    await db
      .update(whatsAppInboxTable)
      .set({ contactId: contact.id, updatedAt: new Date() })
      .where(eq(whatsAppInboxTable.phoneNumber, phoneNumber));
    res
      .status(201)
      .json(
        AddWhatsAppContactResponse.parse({
          id: contact.id,
          phoneNumber: `+${contact.phoneNumber}`,
          displayName: contact.displayName,
          adultConfirmed: contact.adultConfirmed,
          createdAt: contact.createdAt.toISOString(),
        }),
      );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "This phone number is already approved." });
      return;
    }
    req.log.error({ err: error }, "Could not add an approved WhatsApp contact.");
    res.status(500).json({ error: "The contact could not be added right now." });
  }
});

router.delete("/whatsapp/contacts/:contactId", async (req, res): Promise<void> => {
  const params = DeleteWhatsAppContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid contact." });
    return;
  }

  const [deleted] = await db
    .delete(whatsAppContactsTable)
    .where(eq(whatsAppContactsTable.id, params.data.contactId))
    .returning({ id: whatsAppContactsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Contact not found." });
    return;
  }

  const [remaining] = await db
    .select({ value: count() })
    .from(whatsAppContactsTable)
    .where(eq(whatsAppContactsTable.adultConfirmed, true));
  if (!remaining?.value) {
    await db
      .update(whatsAppSettingsTable)
      .set({ autoReplyEnabled: false, updatedAt: new Date() })
      .where(eq(whatsAppSettingsTable.id, 1));
  }

  res.status(204).send();
});

router.get("/whatsapp/inbox", async (_req, res): Promise<void> => {
  const messages = await db
    .select({
      message: whatsAppInboxTable,
      adultConfirmed: whatsAppContactsTable.adultConfirmed,
      summary: whatsAppConversationMemoryTable.summary,
    })
    .from(whatsAppInboxTable)
    .leftJoin(
      whatsAppContactsTable,
      eq(whatsAppInboxTable.contactId, whatsAppContactsTable.id),
    )
    .leftJoin(
      whatsAppConversationMemoryTable,
      eq(
        whatsAppInboxTable.phoneNumber,
        whatsAppConversationMemoryTable.phoneNumber,
      ),
    )
    .where(ne(whatsAppInboxTable.status, "archived"))
    .orderBy(desc(whatsAppInboxTable.receivedAt));
  res.json(
    ListWhatsAppInboxResponse.parse(
      messages.map(({ message, adultConfirmed, summary }) =>
        formatInboxMessage(message, adultConfirmed === true, summary),
      ),
    ),
  );
});

router.post(
  "/whatsapp/inbox/:inboxId/suggestions",
  async (req, res): Promise<void> => {
    const params = GenerateWhatsAppInboxReplySuggestionsParams.safeParse(
      req.params,
    );
    const body = GenerateWhatsAppInboxReplySuggestionsBody.safeParse(req.body);
    if (!params.success || !body.success || !body.data.adultConfirmed) {
      res.status(400).json({
        error: "Confirm that this person is 18 or older before generating suggestions.",
      });
      return;
    }

    const [message] = await db
      .select()
      .from(whatsAppInboxTable)
      .where(eq(whatsAppInboxTable.id, params.data.inboxId))
      .limit(1);
    if (!message) {
      res.status(404).json({ error: "This message is no longer in the inbox." });
      return;
    }
    if (message.status !== "pending") {
      res.status(409).json({
        error: "This message is no longer waiting for a reply.",
      });
      return;
    }
    if (!(await isAdultApprovedContact(message.contactId))) {
      res.status(403).json({
        error: "Confirm this contact is 18 or older before requesting AI suggestions.",
      });
      return;
    }

    const settings = await whatsAppManager.getStatus();
    let suggestions: string[];
    try {
      const generated = await generateWhatsAppReplySuggestionsWithMemory(
        {
          question: message.messageText,
          adultConfirmed: true,
          personaName: settings.creatorName.trim() || "the creator",
          tone: settings.tone,
          ...(message.displayName ? { clientName: message.displayName } : {}),
          ...(settings.personaNotes
            ? { personaNotes: settings.personaNotes }
            : {}),
        },
        await getWhatsAppConversationContext(message.phoneNumber),
        req.log,
      );
      suggestions = generated.suggestions;
      await saveWhatsAppConversationSummary(
        message.phoneNumber,
        generated.summary,
      );
    } catch (error) {
      if (error instanceof CreatorReplyServiceError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log.error(
        { err: error },
        "Could not generate WhatsApp reply suggestions.",
      );
      res.status(503).json({
        error: "Reply suggestions could not be generated right now.",
      });
      return;
    }

    res.json(
      GenerateWhatsAppInboxReplySuggestionsResponse.parse({ suggestions }),
    );
  },
);

router.post(
  "/whatsapp/inbox/:inboxId/draft",
  async (req, res): Promise<void> => {
    const params = GenerateWhatsAppInboxDraftParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid inbox message." });
      return;
    }

    const [message] = await db
      .select()
      .from(whatsAppInboxTable)
      .where(eq(whatsAppInboxTable.id, params.data.inboxId))
      .limit(1);
    if (!message) {
      res.status(404).json({ error: "This message is no longer in the inbox." });
      return;
    }
    if (message.status !== "pending") {
      res.status(409).json({ error: "This message is no longer waiting for review." });
      return;
    }
    if (!(await isAdultApprovedContact(message.contactId))) {
      res.status(403).json({
        error:
          "AI drafts are limited to contacts approved as adults. You can write a manual reply instead.",
      });
      return;
    }

    const settings = await whatsAppManager.getStatus();
    if (!settings.creatorName.trim()) {
      res.status(400).json({
        error: "Add your creator name in WhatsApp settings before drafting a reply.",
      });
      return;
    }

    let reply: string;
    let conversationSummary = "";
    try {
      const generated = await generateWhatsAppReplyWithMemory(
        {
          question: message.messageText,
          adultConfirmed: true,
          personaName: settings.creatorName,
          tone: settings.tone,
          ...(message.displayName ? { clientName: message.displayName } : {}),
          ...(settings.personaNotes
            ? { personaNotes: settings.personaNotes }
            : {}),
        },
        await getWhatsAppConversationContext(message.phoneNumber),
        req.log,
      );
      reply = generated.reply;
      conversationSummary = generated.summary;
      await saveWhatsAppConversationSummary(
        message.phoneNumber,
        generated.summary,
      );
    } catch (error) {
      if (error instanceof CreatorReplyServiceError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Could not generate a WhatsApp reply draft.");
      res.status(503).json({ error: "A reply draft could not be generated right now." });
      return;
    }

    const [updated] = await db
      .update(whatsAppInboxTable)
      .set({ replyDraft: reply, updatedAt: new Date() })
      .where(
        and(
          eq(whatsAppInboxTable.id, params.data.inboxId),
          eq(whatsAppInboxTable.status, "pending"),
          eq(whatsAppInboxTable.contactId, message.contactId!),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "This message is no longer waiting for review." });
      return;
    }

    const isAdultApproved = await isAdultApprovedContact(updated.contactId);
    res.json(
      GenerateWhatsAppInboxDraftResponse.parse(
        formatInboxMessage(updated, isAdultApproved, conversationSummary),
      ),
    );
  },
);

router.patch(
  "/whatsapp/inbox/:inboxId/draft",
  async (req, res): Promise<void> => {
    const params = SaveWhatsAppInboxDraftParams.safeParse(req.params);
    const body = SaveWhatsAppInboxDraftBody.safeParse(req.body);
    if (!params.success || !body.success || !body.data.reply.trim()) {
      res.status(400).json({ error: "Enter a reply of 1–4000 characters." });
      return;
    }

    const [updated] = await db
      .update(whatsAppInboxTable)
      .set({ replyDraft: body.data.reply.trim(), updatedAt: new Date() })
      .where(
        and(
          eq(whatsAppInboxTable.id, params.data.inboxId),
          eq(whatsAppInboxTable.status, "pending"),
        ),
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select({ status: whatsAppInboxTable.status })
        .from(whatsAppInboxTable)
        .where(eq(whatsAppInboxTable.id, params.data.inboxId))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "This message is no longer in the inbox." });
        return;
      }
      res.status(409).json({ error: "This message is no longer waiting for review." });
      return;
    }

    const isAdultApproved = await isAdultApprovedContact(updated.contactId);
    res.json(
      SaveWhatsAppInboxDraftResponse.parse(
        formatInboxMessage(updated, isAdultApproved),
      ),
    );
  },
);

router.post(
  "/whatsapp/inbox/:inboxId/send",
  async (req, res): Promise<void> => {
    const params = SendWhatsAppInboxReplyParams.safeParse(req.params);
    const body = SendWhatsAppInboxReplyBody.safeParse(req.body);
    if (!params.success || !body.success || !body.data.reply.trim()) {
      res.status(400).json({ error: "Enter a reply of 1–4000 characters." });
      return;
    }

    try {
      await whatsAppManager.sendReviewedReply(
        params.data.inboxId,
        body.data.reply,
      );
      res.status(204).send();
    } catch (error) {
      if (error instanceof WhatsAppInboxActionError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Could not send a reviewed WhatsApp reply.");
      res.status(503).json({
        error: "Could not confirm whether the reply was sent. Check WhatsApp before retrying.",
      });
    }
  },
);

router.delete(
  "/whatsapp/inbox/:inboxId",
  async (req, res): Promise<void> => {
    const params = DismissWhatsAppInboxMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid inbox message." });
      return;
    }

    const [archived] = await db
      .update(whatsAppInboxTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        and(
          eq(whatsAppInboxTable.id, params.data.inboxId),
          ne(whatsAppInboxTable.status, "sending"),
        ),
      )
      .returning({ id: whatsAppInboxTable.id });
    if (!archived) {
      const [existing] = await db
        .select({ status: whatsAppInboxTable.status })
        .from(whatsAppInboxTable)
        .where(eq(whatsAppInboxTable.id, params.data.inboxId))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "This message is no longer in the inbox." });
        return;
      }
      res.status(409).json({ error: "A reply is currently being sent." });
      return;
    }

    res.status(204).send();
  },
);

export default router;