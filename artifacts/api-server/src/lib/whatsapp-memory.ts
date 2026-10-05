import { asc, eq } from "drizzle-orm";
import {
  db,
  whatsAppConversationMemoryTable,
  whatsAppConversationMessagesTable,
} from "@workspace/db";

export type WhatsAppConversationTurn = {
  direction: "contact" | "creator";
  messageText: string;
  sentAt: string;
};

export type WhatsAppConversationContext = {
  summary: string;
  transcript: WhatsAppConversationTurn[];
};

export async function getWhatsAppConversationContext(
  phoneNumber: string,
): Promise<WhatsAppConversationContext> {
  const [memory] = await db
    .select({ summary: whatsAppConversationMemoryTable.summary })
    .from(whatsAppConversationMemoryTable)
    .where(eq(whatsAppConversationMemoryTable.phoneNumber, phoneNumber))
    .limit(1);
  const messages = await db
    .select({
      direction: whatsAppConversationMessagesTable.direction,
      messageText: whatsAppConversationMessagesTable.messageText,
      sentAt: whatsAppConversationMessagesTable.sentAt,
    })
    .from(whatsAppConversationMessagesTable)
    .where(eq(whatsAppConversationMessagesTable.phoneNumber, phoneNumber))
    .orderBy(
      asc(whatsAppConversationMessagesTable.sentAt),
      asc(whatsAppConversationMessagesTable.id),
    );

  return {
    summary: memory?.summary ?? "",
    transcript: messages.map((message) => ({
      direction: message.direction,
      messageText: message.messageText,
      sentAt: message.sentAt.toISOString(),
    })),
  };
}

export async function saveWhatsAppConversationSummary(
  phoneNumber: string,
  summary: string,
): Promise<void> {
  await db
    .insert(whatsAppConversationMemoryTable)
    .values({ phoneNumber, summary: summary.slice(0, 6000) })
    .onConflictDoUpdate({
      target: whatsAppConversationMemoryTable.phoneNumber,
      set: { summary: summary.slice(0, 6000), updatedAt: new Date() },
    });
}

export async function recordWhatsAppConversationMessage(input: {
  messageId: string;
  phoneNumber: string;
  direction: "contact" | "creator";
  messageText: string;
  sentAt?: Date;
}): Promise<void> {
  await db
    .insert(whatsAppConversationMessagesTable)
    .values({
      ...input,
      sentAt: input.sentAt ?? new Date(),
    })
    .onConflictDoNothing();
}