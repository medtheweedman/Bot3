import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  boolean,
  index,
  integer,
  pgTable,
  pgEnum,
  serial,
  smallint,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const whatsAppAuthTable = pgTable("whatsapp_auth", {
  id: smallint("id").primaryKey(),
  encryptedPayload: text("encrypted_payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const whatsAppSettingsTable = pgTable("whatsapp_settings", {
  id: smallint("id").primaryKey(),
  autoReplyEnabled: boolean("auto_reply_enabled").notNull().default(false),
  creatorName: varchar("creator_name", { length: 80 }).notNull().default(""),
  tone: varchar("tone", { length: 16 }).notNull().default("spicy"),
  personaNotes: text("persona_notes"),
  lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const whatsAppContactsTable = pgTable("whatsapp_contacts", {
  id: serial("id").primaryKey(),
  phoneNumber: varchar("phone_number", { length: 15 }).notNull().unique(),
  displayName: varchar("display_name", { length: 80 }),
  adultConfirmed: boolean("adult_confirmed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const whatsAppInboxStatus = pgEnum("whatsapp_inbox_status", [
  "pending",
  "sending",
  "uncertain",
  "replied",
]);

export const whatsAppInboxTable = pgTable(
  "whatsapp_inbox",
  {
    id: serial("id").primaryKey(),
    messageId: varchar("message_id", { length: 128 }).notNull().unique(),
    contactId: integer("contact_id").references(() => whatsAppContactsTable.id, {
      onDelete: "set null",
    }),
    phoneNumber: varchar("phone_number", { length: 15 }).notNull(),
    displayName: varchar("display_name", { length: 80 }),
    messageText: text("message_text").notNull(),
    replyDraft: text("reply_draft"),
    status: whatsAppInboxStatus("status").notNull().default("pending"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    statusReceivedAtIndex: index("whatsapp_inbox_status_received_at_idx").on(
      table.status,
      table.receivedAt,
    ),
  }),
);

export const whatsAppProcessedMessagesTable = pgTable("whatsapp_processed_messages", {
  messageId: varchar("message_id", { length: 128 }).primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertWhatsAppAuthSchema = createInsertSchema(whatsAppAuthTable).omit({
  updatedAt: true,
});
export const insertWhatsAppSettingsSchema = createInsertSchema(whatsAppSettingsTable).omit({
  updatedAt: true,
});
export const insertWhatsAppContactSchema = createInsertSchema(whatsAppContactsTable).omit({
  id: true,
  createdAt: true,
});
export const insertWhatsAppInboxSchema = createInsertSchema(whatsAppInboxTable).omit({
  id: true,
  receivedAt: true,
  updatedAt: true,
});
export const insertWhatsAppProcessedMessageSchema = createInsertSchema(
  whatsAppProcessedMessagesTable,
).omit({
  processedAt: true,
});

export type InsertWhatsAppAuth = z.infer<typeof insertWhatsAppAuthSchema>;
export type InsertWhatsAppSettings = z.infer<typeof insertWhatsAppSettingsSchema>;
export type InsertWhatsAppContact = z.infer<typeof insertWhatsAppContactSchema>;
export type InsertWhatsAppInboxMessage = z.infer<typeof insertWhatsAppInboxSchema>;
export type InsertWhatsAppProcessedMessage = z.infer<
  typeof insertWhatsAppProcessedMessageSchema
>;
export type WhatsAppSettings = typeof whatsAppSettingsTable.$inferSelect;
export type WhatsAppContact = typeof whatsAppContactsTable.$inferSelect;
export type WhatsAppInboxMessage = typeof whatsAppInboxTable.$inferSelect;
export type WhatsAppAuth = typeof whatsAppAuthTable.$inferSelect;
export type WhatsAppProcessedMessage = typeof whatsAppProcessedMessagesTable.$inferSelect;