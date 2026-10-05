import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
  type AuthenticationCreds,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WAMessage,
} from "@whiskeysockets/baileys";
import {
  and,
  count,
  eq,
  lt,
} from "drizzle-orm";
import {
  db,
  whatsAppAuthTable,
  whatsAppContactsTable,
  whatsAppInboxTable,
  whatsAppProcessedMessagesTable,
  whatsAppSettingsTable,
} from "@workspace/db";
import {
  GetWhatsAppStatusResponse,
  type CreatorReplyInput,
  type WhatsAppStatus,
} from "@workspace/api-zod";
import QRCode from "qrcode";
import { logger } from "./logger";

type PersistedAuth = {
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
};

type SettingsRow = typeof whatsAppSettingsTable.$inferSelect;

export class WhatsAppInboxActionError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppInboxActionError";
  }
}

const SETTINGS_ID = 1;
const AUTH_ID = 1;
const BAILEYS_LOGGER = logger.child(
  { component: "baileys" },
  { level: "silent" },
);
const toneOptions = new Set(["playful", "warm", "confident", "soft", "spicy"]);

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return createHash("sha256")
    .update("creator-reply-studio:whatsapp-auth:v1\0")
    .update(secret)
    .digest();
}

function encryptAuthState(state: PersistedAuth): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = JSON.stringify(state, BufferJSON.replacer);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptAuthState(envelope: string): PersistedAuth {
  const [version, ivText, tagText, ciphertextText, ...extra] = envelope.split(".");
  if (
    version !== "v1" ||
    !ivText ||
    !tagText ||
    !ciphertextText ||
    extra.length > 0
  ) {
    throw new Error("The stored WhatsApp session has an invalid format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext, BufferJSON.reviver) as PersistedAuth;
  if (!parsed || typeof parsed !== "object" || !parsed.creds || !parsed.keys) {
    throw new Error("The stored WhatsApp session could not be read.");
  }
  return parsed;
}

function extractPhoneDigits(jid: string): string | null {
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) return null;
  const digits = jid.split("@", 1)[0]?.split(":", 1)[0];
  return digits && /^\d{7,15}$/.test(digits) ? digits : null;
}

function isPhoneJid(jid: string | null | undefined): jid is string {
  return Boolean(jid?.endsWith("@s.whatsapp.net") || jid?.endsWith("@c.us"));
}

function getJidServer(jid: string | null | undefined): string {
  if (!jid) return "unknown";
  return jid.slice(jid.lastIndexOf("@") + 1);
}

function displayPhoneNumber(jid: string | undefined): string | null {
  if (!jid) return null;
  const digits = extractPhoneDigits(jid);
  return digits ? `+${digits}` : null;
}

function extractText(message: WAMessage): string | null {
  let content: unknown = message.message;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!content || typeof content !== "object") return null;
    const record = content as Record<string, unknown>;
    const nested =
      record.ephemeralMessage ??
      record.viewOnceMessage ??
      record.viewOnceMessageV2 ??
      record.documentWithCaptionMessage;
    if (!nested || typeof nested !== "object") break;
    content = (nested as Record<string, unknown>).message;
  }
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  const conversation = record.conversation;
  if (typeof conversation === "string") return conversation.trim() || null;
  const extended = record.extendedTextMessage;
  if (extended && typeof extended === "object") {
    const text = (extended as Record<string, unknown>).text;
    if (typeof text === "string") return text.trim() || null;
  }
  return null;
}

function getSafeTone(value: string): CreatorReplyInput["tone"] {
  return toneOptions.has(value)
    ? (value as CreatorReplyInput["tone"])
    : "spicy";
}

class WhatsAppManager {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private connection: WhatsAppStatus["connection"] = "disconnected";
  private phoneNumber: string | null = null;
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private manualStop = false;
  private connectTask: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private lastMessageCleanupAt = 0;

  async restore(): Promise<void> {
    await this.ensureSettings();
    await this.updateSettings({ autoReplyEnabled: false });
    await db
      .update(whatsAppInboxTable)
      .set({ status: "uncertain", updatedAt: new Date() })
      .where(eq(whatsAppInboxTable.status, "sending"));
    const [savedSession] = await db
      .select({ id: whatsAppAuthTable.id })
      .from(whatsAppAuthTable)
      .where(eq(whatsAppAuthTable.id, AUTH_ID))
      .limit(1);
    if (!savedSession) return;

    try {
      await this.connect();
    } catch (error) {
      this.connection = "error";
      this.lastError = "The saved WhatsApp session could not be restored.";
      logger.error({ err: error }, "Could not restore WhatsApp connection.");
    }
  }

  async connect(): Promise<void> {
    this.manualStop = false;
    if (this.socket) return;
    if (this.connectTask) return this.connectTask;

    this.connection = "connecting";
    this.lastError = null;
    this.connectTask = this.createSocket();
    try {
      await this.connectTask;
    } finally {
      this.connectTask = null;
    }
  }

  async disconnect(): Promise<void> {
    this.manualStop = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.connection = "disconnected";
    this.phoneNumber = null;
    this.qrDataUrl = null;
    this.lastError = null;

    await db.delete(whatsAppAuthTable).where(eq(whatsAppAuthTable.id, AUTH_ID));
    await this.updateSettings({ autoReplyEnabled: false });
    if (socket) {
      try {
        await socket.logout();
      } catch (error) {
        logger.warn({ err: error }, "WhatsApp logout did not complete cleanly.");
        socket.end(undefined);
      }
    }
  }

  async getStatus(): Promise<WhatsAppStatus> {
    const settings = await this.ensureSettings();
    const [contactCount] = await db
      .select({ value: count() })
      .from(whatsAppContactsTable);
    const status = {
      connection: this.connection,
      phoneNumber: this.phoneNumber,
      qrDataUrl: this.qrDataUrl,
      lastError: this.lastError,
      autoReplyEnabled: settings.autoReplyEnabled,
      creatorName: settings.creatorName,
      tone: getSafeTone(settings.tone),
      personaNotes: settings.personaNotes,
      approvedContactCount: contactCount?.value ?? 0,
      lastReplyAt: settings.lastReplyAt?.toISOString() ?? null,
    };
    return GetWhatsAppStatusResponse.parse(status);
  }

  private async createSocket(): Promise<void> {
    const loaded = await this.loadAuthState();
    let keysData = loaded.keys;
    const creds = loaded.creds;

    const persist = async (): Promise<void> => {
      await this.queueAuthWrite({ creds, keys: keysData });
    };

    const baseKeyStore: SignalKeyStore = {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ): Promise<Record<string, SignalDataTypeMap[T]>> => {
        const result: Record<string, SignalDataTypeMap[T]> = {};
        for (const id of ids) {
          const value = keysData[type]?.[id];
          if (value === undefined || value === null) continue;
          const restoredValue =
            type === "app-state-sync-key"
              ? proto.Message.AppStateSyncKeyData.fromObject(
                  value as proto.Message.IAppStateSyncKeyData,
                )
              : value;
          result[id] = restoredValue as SignalDataTypeMap[T];
        }
        return result;
      },
      set: async (updates: SignalDataSet): Promise<void> => {
        const next: Record<string, Record<string, unknown>> = Object.fromEntries(
          Object.entries(keysData).map(([category, values]) => [
            category,
            { ...values },
          ]),
        );
        for (const [category, values] of Object.entries(updates)) {
          if (!values) continue;
          const target = (next[category] ??= {});
          for (const [id, value] of Object.entries(values)) {
            if (value === null) delete target[id];
            else target[id] = value;
          }
        }
        keysData = next;
        await persist();
      },
      clear: async (): Promise<void> => {
        keysData = {};
        await persist();
      },
    };
    const auth = {
      creds,
      keys: makeCacheableSignalKeyStore(baseKeyStore, BAILEYS_LOGGER),
    };

    const socket = makeWASocket({
      auth,
      logger: BAILEYS_LOGGER,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
    });
    this.socket = socket;

    socket.ev.on("creds.update", (update) => {
      Object.assign(creds, update);
      void persist().catch((error) => {
        logger.error({ err: error }, "Could not persist WhatsApp credentials.");
      });
    });

    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(socket, update);
    });

    socket.ev.on("messages.upsert", ({ type, messages }) => {
      logger.info(
        {
          upsertType: type,
          messageCount: messages.length,
          textMessageCount: messages.filter((message) => !!extractText(message))
            .length,
          remoteJidServers: [
            ...new Set(messages.map((message) => getJidServer(message.key.remoteJid))),
          ],
          alternatePhoneJidCount: messages.filter((message) =>
            isPhoneJid(message.key.remoteJidAlt),
          ).length,
        },
        "WhatsApp message batch received.",
      );
      if (type !== "notify") return;
      for (const message of messages) {
        void this.handleIncomingMessage(socket, message).catch((error) => {
          logger.warn({ err: error }, "Could not process an incoming WhatsApp message.");
        });
      }
    });
  }

  private async handleConnectionUpdate(
    socket: ReturnType<typeof makeWASocket>,
    update: {
      connection?: "close" | "connecting" | "open";
      qr?: string;
      lastDisconnect?: { error?: unknown };
    },
  ): Promise<void> {
    if (this.socket !== socket) return;

    if (update.qr) {
      try {
        this.qrDataUrl = await QRCode.toDataURL(update.qr, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 280,
        });
        this.connection = "awaiting_qr";
        this.lastError = null;
      } catch (error) {
        this.connection = "error";
        this.lastError = "A pairing QR code could not be created.";
        logger.error({ err: error }, "Could not render WhatsApp pairing QR.");
      }
    }

    if (update.connection === "open") {
      this.connection = "connected";
      this.qrDataUrl = null;
      this.phoneNumber = displayPhoneNumber(socket.user?.id);
      this.lastError = null;
      logger.info("WhatsApp connection opened.");
    }

    if (update.connection !== "close") return;

    this.socket = null;
    this.qrDataUrl = null;
    const error = update.lastDisconnect?.error;
    const statusCode =
      error && typeof error === "object"
        ? (error as { output?: { statusCode?: unknown } }).output?.statusCode
        : undefined;

    if (this.manualStop) {
      this.connection = "disconnected";
      this.phoneNumber = null;
      return;
    }

    if (statusCode === DisconnectReason.loggedOut) {
      this.connection = "disconnected";
      this.phoneNumber = null;
      this.lastError = "WhatsApp signed out. Pair the account again to reconnect.";
      await db.delete(whatsAppAuthTable).where(eq(whatsAppAuthTable.id, AUTH_ID));
      await this.updateSettings({ autoReplyEnabled: false });
      logger.warn("WhatsApp session was signed out.");
      return;
    }

    this.connection = "connecting";
    this.phoneNumber = null;
    this.lastError = "Connection interrupted. Reconnecting automatically.";
    logger.warn(
      { statusCode },
      "WhatsApp connection closed; scheduling a reconnect.",
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((reconnectError) => {
        this.connection = "error";
        this.lastError = "Could not reconnect to WhatsApp.";
        logger.error({ err: reconnectError }, "WhatsApp reconnect failed.");
      });
    }, 2500);
  }

  private async handleIncomingMessage(
    socket: ReturnType<typeof makeWASocket>,
    message: WAMessage,
  ): Promise<void> {
    if (
      this.socket !== socket ||
      this.connection !== "connected" ||
      message.key.fromMe
    ) {
      return;
    }
    const remoteJid = message.key.remoteJid;
    const messageId = message.key.id;
    if (
      !remoteJid ||
      !messageId ||
      remoteJid.endsWith("@g.us") ||
      remoteJid.endsWith("@broadcast") ||
      remoteJid.endsWith("@newsletter")
    ) {
      return;
    }

    let phoneJid = isPhoneJid(remoteJid)
      ? remoteJid
      : isPhoneJid(message.key.remoteJidAlt)
        ? message.key.remoteJidAlt
        : null;
    if (
      !phoneJid &&
      (remoteJid.endsWith("@lid") || remoteJid.endsWith("@hosted.lid"))
    ) {
      try {
        phoneJid = await socket.signalRepository.lidMapping.getPNForLID(remoteJid);
      } catch {
        logger.warn(
          { jidServer: getJidServer(remoteJid) },
          "Could not map an incoming WhatsApp LID to a phone number.",
        );
        return;
      }
    }
    const phoneDigits = phoneJid ? extractPhoneDigits(phoneJid) : null;
    if (!phoneDigits) return;

    const text = extractText(message);
    if (!text || text.length > 4000) return;

    const [claimed] = await db
      .insert(whatsAppProcessedMessagesTable)
      .values({ messageId })
      .onConflictDoNothing()
      .returning({ messageId: whatsAppProcessedMessagesTable.messageId });
    if (!claimed) return;

    await this.pruneProcessedMessageIds();

    let inboxItem: { id: number } | undefined;
    try {
      [inboxItem] = await db
        .insert(whatsAppInboxTable)
        .values({
          messageId,
          contactId: null,
          phoneNumber: phoneDigits,
          displayName: message.pushName?.trim().slice(0, 80) || null,
          messageText: text,
        })
        .onConflictDoNothing()
        .returning({ id: whatsAppInboxTable.id });
    } catch (error) {
      await db
        .delete(whatsAppProcessedMessagesTable)
        .where(eq(whatsAppProcessedMessagesTable.messageId, messageId))
        .catch((rollbackError) => {
          logger.error(
            { err: rollbackError },
            "Could not release an inbound message after inbox storage failed.",
          );
        });
      throw error;
    }
    if (!inboxItem) return;
  }

  async sendReviewedReply(inboxId: number, replyText: string): Promise<void> {
    const reply = replyText.trim();
    if (!reply || reply.length > 4000) {
      throw new WhatsAppInboxActionError(400, "Enter a reply of 1–4000 characters.");
    }

    const socket = this.socket;
    if (!socket || this.connection !== "connected") {
      throw new WhatsAppInboxActionError(
        503,
        "WhatsApp is not connected. Reconnect before sending this reply.",
      );
    }

    const [message] = await db
      .select()
      .from(whatsAppInboxTable)
      .where(eq(whatsAppInboxTable.id, inboxId))
      .limit(1);
    if (!message) {
      throw new WhatsAppInboxActionError(404, "This message is no longer in the inbox.");
    }
    if (message.status !== "pending") {
      throw new WhatsAppInboxActionError(
        409,
        "This message is already being sent or needs your attention before it can be sent.",
      );
    }

    const [claimed] = await db
      .update(whatsAppInboxTable)
      .set({
        status: "sending",
        replyDraft: reply,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsAppInboxTable.id, inboxId),
          eq(whatsAppInboxTable.status, "pending"),
        ),
      )
      .returning({ id: whatsAppInboxTable.id });
    if (!claimed) {
      throw new WhatsAppInboxActionError(
        409,
        "This message is already being handled. Refresh the inbox.",
      );
    }

    if (this.socket !== socket || this.connection !== "connected") {
      await db
        .update(whatsAppInboxTable)
        .set({ status: "pending", updatedAt: new Date() })
        .where(
          and(
            eq(whatsAppInboxTable.id, inboxId),
            eq(whatsAppInboxTable.status, "sending"),
          ),
        );
      throw new WhatsAppInboxActionError(
        503,
        "WhatsApp disconnected before the reply could be sent. Reconnect and try again.",
      );
    }

    try {
      await socket.sendMessage(`${message.phoneNumber}@s.whatsapp.net`, {
        text: reply,
      });
    } catch (error) {
      await db
        .update(whatsAppInboxTable)
        .set({ status: "uncertain", updatedAt: new Date() })
        .where(
          and(
            eq(whatsAppInboxTable.id, inboxId),
            eq(whatsAppInboxTable.status, "sending"),
          ),
        );
      logger.warn(
        { err: error },
        "Could not confirm delivery of a reviewed WhatsApp reply.",
      );
      throw new WhatsAppInboxActionError(
        503,
        "WhatsApp could not confirm whether this reply was sent. Check the chat before retrying.",
      );
    }

    try {
      const [replied] = await db
        .update(whatsAppInboxTable)
        .set({ status: "replied", updatedAt: new Date() })
        .where(
          and(
            eq(whatsAppInboxTable.id, inboxId),
            eq(whatsAppInboxTable.status, "sending"),
          ),
        )
        .returning({ id: whatsAppInboxTable.id });
      if (!replied) {
        throw new Error("Sent reply could not be recorded in the inbox.");
      }
    } catch (error) {
      await db
        .update(whatsAppInboxTable)
        .set({ status: "uncertain", updatedAt: new Date() })
        .where(
          and(
            eq(whatsAppInboxTable.id, inboxId),
            eq(whatsAppInboxTable.status, "sending"),
          ),
        )
        .catch((updateError) => {
          logger.error(
            { err: updateError },
            "Could not mark an unconfirmed WhatsApp reply as uncertain.",
          );
        });
      logger.error(
        { err: error },
        "WhatsApp accepted a reply, but the inbox could not confirm it.",
      );
      throw new WhatsAppInboxActionError(
        503,
        "WhatsApp accepted the reply for sending, but the inbox could not confirm it. Check the chat before retrying.",
      );
    }
    await this.updateSettings({ lastReplyAt: new Date() }).catch((error) => {
      logger.warn({ err: error }, "Could not update the last WhatsApp reply time.");
    });
    logger.info("Reviewed WhatsApp reply sent.");
  }

  private async pruneProcessedMessageIds(): Promise<void> {
    const now = Date.now();
    if (now - this.lastMessageCleanupAt < 24 * 60 * 60 * 1000) return;
    this.lastMessageCleanupAt = now;
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
    await db
      .delete(whatsAppProcessedMessagesTable)
      .where(lt(whatsAppProcessedMessagesTable.processedAt, cutoff));
    await db
      .delete(whatsAppInboxTable)
      .where(
        and(
          eq(whatsAppInboxTable.status, "pending"),
          lt(whatsAppInboxTable.receivedAt, cutoff),
        ),
      );
  }

  private async ensureSettings(): Promise<SettingsRow> {
    const [existing] = await db
      .select()
      .from(whatsAppSettingsTable)
      .where(eq(whatsAppSettingsTable.id, SETTINGS_ID))
      .limit(1);
    if (existing) return existing;

    await db
      .insert(whatsAppSettingsTable)
      .values({ id: SETTINGS_ID })
      .onConflictDoNothing();
    const [created] = await db
      .select()
      .from(whatsAppSettingsTable)
      .where(eq(whatsAppSettingsTable.id, SETTINGS_ID))
      .limit(1);
    if (!created) throw new Error("Could not initialize WhatsApp settings.");
    return created;
  }

  private async updateSettings(
    values: Partial<
      Pick<
        SettingsRow,
        | "autoReplyEnabled"
        | "creatorName"
        | "tone"
        | "personaNotes"
        | "lastReplyAt"
      >
    >,
  ): Promise<void> {
    await this.ensureSettings();
    await db
      .update(whatsAppSettingsTable)
      .set(values)
      .where(eq(whatsAppSettingsTable.id, SETTINGS_ID));
  }

  private async loadAuthState(): Promise<PersistedAuth> {
    const [stored] = await db
      .select({ encryptedPayload: whatsAppAuthTable.encryptedPayload })
      .from(whatsAppAuthTable)
      .where(eq(whatsAppAuthTable.id, AUTH_ID))
      .limit(1);
    if (stored) return decryptAuthState(stored.encryptedPayload);
    return { creds: initAuthCreds(), keys: {} };
  }

  private async queueAuthWrite(state: PersistedAuth): Promise<void> {
    const encryptedPayload = encryptAuthState(state);
    const write = this.persistenceQueue.then(async () => {
      await db
        .insert(whatsAppAuthTable)
        .values({ id: AUTH_ID, encryptedPayload })
        .onConflictDoUpdate({
          target: whatsAppAuthTable.id,
          set: { encryptedPayload, updatedAt: new Date() },
        });
    });
    this.persistenceQueue = write.catch((error) => {
      logger.error({ err: error }, "Could not persist encrypted WhatsApp auth state.");
    });
    await write;
  }
}

export const whatsAppManager = new WhatsAppManager();