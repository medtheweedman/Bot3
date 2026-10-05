import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetWhatsAppStatusQueryKey,
  getListWhatsAppInboxQueryKey,
  useAddWhatsAppContact,
  useDeleteWhatsAppContact,
  useGenerateWhatsAppInboxReplySuggestions,
  useListWhatsAppInbox,
  useSendWhatsAppInboxReply,
} from "@workspace/api-client-react";
import type { WhatsAppInboxMessage } from "@workspace/api-client-react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock3,
  LoaderCircle,
  MessageSquareText,
  Send,
  Sparkles,
} from "lucide-react";

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === "string") return message;
    }
  }
  if (error instanceof Error) {
    if (error.message === "Failed to fetch") {
      return "Couldn’t reach WhatsApp. Check the connection and try again.";
    }
    return error.message.replace(/^HTTP \d{3}\s*[^:]*:\s*/, "");
  }
  return "The reply could not be sent. Please try again.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Received recently";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

type Conversation = {
  phoneNumber: string;
  displayName: string | null;
  contactId: number | null;
  isAdultApproved: boolean;
  conversationSummary: string | null;
  messages: WhatsAppInboxMessage[];
  latestReceivedAt: string;
};

function groupConversations(messages: WhatsAppInboxMessage[]): Conversation[] {
  const grouped = new Map<string, Conversation>();
  for (const message of messages) {
    const conversation = grouped.get(message.phoneNumber);
    if (conversation) {
      conversation.messages.push(message);
      if (message.receivedAt > conversation.latestReceivedAt) {
        conversation.latestReceivedAt = message.receivedAt;
        conversation.displayName = message.displayName ?? conversation.displayName;
      }
      if (message.contactId !== null) conversation.contactId = message.contactId;
      conversation.isAdultApproved ||= message.isAdultApproved;
      conversation.conversationSummary =
        message.conversationSummary ?? conversation.conversationSummary;
    } else {
      grouped.set(message.phoneNumber, {
        phoneNumber: message.phoneNumber,
        displayName: message.displayName,
        contactId: message.contactId,
        isAdultApproved: message.isAdultApproved,
        conversationSummary: message.conversationSummary,
        messages: [message],
        latestReceivedAt: message.receivedAt,
      });
    }
  }

  return [...grouped.values()]
    .map((conversation) => ({
      ...conversation,
      messages: [...conversation.messages].sort(
        (a, b) => a.receivedAt.localeCompare(b.receivedAt),
      ),
    }))
    .sort((a, b) => b.latestReceivedAt.localeCompare(a.latestReceivedAt));
}

type MessageProps = {
  message: WhatsAppInboxMessage;
  connected: boolean;
  sending: boolean;
  onSend: (reply: string) => void;
};

function ConversationMessage({ message, connected, sending, onSend }: MessageProps) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState(message.replyDraft ?? "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsError, setSuggestionsError] = useState("");
  const generateSuggestions = useGenerateWhatsAppInboxReplySuggestions();
  const uncertain = message.status === "uncertain";
  const activelySending = message.status === "sending";
  const replied = message.status === "replied";

  const requestSuggestions = () => {
    if (!message.isAdultApproved) return;
    setSuggestionsError("");
    generateSuggestions.mutate(
      { inboxId: message.id, data: { adultConfirmed: true } },
      {
        onSuccess: (result) => {
          setSuggestions(result.suggestions);
          void queryClient.invalidateQueries({
            queryKey: getListWhatsAppInboxQueryKey(),
          });
        },
        onError: (error) => setSuggestionsError(getErrorMessage(error)),
      },
    );
  };

  const sendReply = () => {
    const trimmed = reply.trim();
    if (!trimmed) return;
    const recipient = message.displayName || message.phoneNumber;
    if (!window.confirm(`Send this reply to ${recipient} on WhatsApp?\n\n${trimmed}`)) {
      return;
    }
    onSend(trimmed);
  };

  return (
    <article
      className="rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--background)/.72)] p-3.5 sm:p-4"
      data-testid={`card-whatsapp-inbox-${message.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <Clock3 size={11} />
          <time dateTime={message.receivedAt}>{formatDate(message.receivedAt)}</time>
        </p>
        <span
          className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.08em] ${
            uncertain
              ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
              : replied
                ? "bg-[hsl(158_34%_43%/.12)] text-[hsl(158_34%_33%)]"
                : activelySending
                  ? "bg-[hsl(var(--muted))] text-muted-foreground"
                  : "bg-[hsl(35_48%_59%/.15)] text-[hsl(35_48%_34%)]"
          }`}
          data-testid={`status-inbox-message-${message.id}`}
        >
          {uncertain
            ? "Check WhatsApp"
            : replied
              ? "Replied"
              : activelySending
                ? "Sending"
                : "Needs reply"}
        </span>
      </div>

      <div
        className="mt-3 whitespace-pre-wrap break-words rounded-[10px] bg-[hsl(var(--card))] px-3.5 py-3 text-[12px] leading-[1.65]"
        data-testid={`text-inbox-message-${message.id}`}
      >
        {message.messageText}
      </div>

      {replied && message.replyDraft ? (
        <div className="mt-3 rounded-[10px] border border-[hsl(158_34%_43%/.16)] bg-[hsl(158_34%_43%/.06)] px-3.5 py-3">
          <p className="text-[9px] font-bold uppercase tracking-[.08em] text-[hsl(158_34%_33%)]">
            Reply sent
          </p>
          <p
            className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed"
            data-testid={`text-inbox-sent-reply-${message.id}`}
          >
            {message.replyDraft}
          </p>
        </div>
      ) : activelySending ? (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded-[9px] bg-[hsl(var(--muted)/.68)] px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground"
        >
          <LoaderCircle size={13} className="mt-0.5 shrink-0 animate-spin" />
          A reply is being sent. Please wait for confirmation.
        </div>
      ) : uncertain ? (
        <div
          role="alert"
          className="mt-3 rounded-[9px] border border-[hsl(var(--accent-foreground)/.14)] bg-[hsl(var(--accent)/.5)] px-3 py-2.5 text-[10px] leading-relaxed text-[hsl(var(--accent-foreground))]"
          data-testid={`status-inbox-uncertain-${message.id}`}
        >
          Delivery could not be confirmed. Check the WhatsApp chat before taking
          any further action. Do not send the reply again unless you confirm it
          was not delivered.
          {message.replyDraft && (
            <p className="mt-2 border-t border-[hsl(var(--accent-foreground)/.14)] pt-2">
              Reply submitted: {message.replyDraft}
            </p>
          )}
        </div>
      ) : (
        <>
          <div
            className="mt-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"
            data-testid={`section-reply-suggestions-${message.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-[360px] text-[10px] leading-relaxed text-muted-foreground">
                {message.isAdultApproved
                  ? "This contact is marked 18+. Gemini can use the saved summary and full text history for context."
                  : "Confirm this contact is 18+ in the conversation controls before using AI."}
              </p>
              <button
                type="button"
                disabled={
                  !message.isAdultApproved ||
                  generateSuggestions.isPending ||
                  suggestions.length > 0
                }
                onClick={requestSuggestions}
                data-testid={`button-generate-suggestions-${message.id}`}
                className="flex h-9 shrink-0 items-center gap-2 rounded-[9px] border border-[hsl(var(--primary)/.25)] bg-[hsl(var(--primary)/.07)] px-3 text-[10px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)/.12)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generateSuggestions.isPending ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
                {generateSuggestions.isPending
                  ? "Generating…"
                  : suggestions.length
                    ? "Suggestions ready"
                    : generateSuggestions.isError
                      ? "Retry suggestions"
                      : "Get 2 suggestions"}
              </button>
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
              When requested, this conversation history and saved summary are
              sent to Gemini to generate two options. Nothing is sent until you
              press Send reply, unless global auto-reply is enabled.
            </p>
            {suggestionsError && (
              <p
                role="alert"
                data-testid={`status-suggestions-error-${message.id}`}
                className="mt-2 text-[10px] leading-relaxed text-[hsl(var(--destructive))]"
              >
                {suggestionsError}
              </p>
            )}
            {suggestions.length > 0 && (
              <div
                className="mt-3 space-y-2"
                aria-label="Choose a reply suggestion"
                data-testid={`list-reply-suggestions-${message.id}`}
              >
                {suggestions.map((suggestion, index) => (
                  <button
                    key={`${message.id}-suggestion-${index + 1}`}
                    type="button"
                    onClick={() => setReply(suggestion)}
                    data-testid={`button-use-suggestion-${message.id}-${index + 1}`}
                    className="block w-full rounded-[9px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-left text-[10px] leading-relaxed transition hover:border-[hsl(var(--primary)/.4)] hover:bg-[hsl(var(--primary)/.035)]"
                  >
                    <span className="mb-1 block font-mono text-[8px] uppercase tracking-[.08em] text-muted-foreground">
                      Suggestion {index + 1} · select to edit
                    </span>
                    <span className="whitespace-pre-wrap break-words">
                      {suggestion}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <label htmlFor={`inbox-reply-${message.id}`} className="sr-only">
              Reply to {message.displayName || message.phoneNumber}
            </label>
            <textarea
              id={`inbox-reply-${message.id}`}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              maxLength={4000}
              rows={2}
              placeholder="Write a reply…"
              data-testid={`input-inbox-reply-${message.id}`}
              className="min-h-10 flex-1 resize-y rounded-[10px] border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 text-[12px] leading-[1.6] outline-none transition focus:border-[hsl(var(--primary)/.55)] focus:ring-2 focus:ring-[hsl(var(--primary)/.09)] placeholder:text-muted-foreground/65"
            />
            <button
              type="button"
              disabled={!connected || sending || !reply.trim()}
              onClick={sendReply}
              data-testid={`button-send-inbox-reply-${message.id}`}
              className="flex h-10 shrink-0 items-center gap-2 rounded-[9px] bg-[hsl(var(--primary))] px-3.5 text-[10px] font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : (
                <Send size={13} />
              )}
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

type ConversationInboxProps = {
  connection: string | undefined;
};

export function ConversationInbox({ connection }: ConversationInboxProps) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [expandedConversations, setExpandedConversations] = useState<Set<string>>(
    () => new Set(),
  );
  const inbox = useListWhatsAppInbox({
    query: {
      queryKey: getListWhatsAppInboxQueryKey(),
      refetchInterval: connection === "connected" ? 5000 : false,
    },
  });
  const sendReply = useSendWhatsAppInboxReply();
  const approveContact = useAddWhatsAppContact();
  const removeContactApproval = useDeleteWhatsAppContact();
  const messages = inbox.data ?? [];
  const conversations = useMemo(() => groupConversations(messages), [messages]);
  const pendingCount = messages.filter((message) => message.status === "pending").length;
  const toggleConversation = (phoneNumber: string) => {
    setExpandedConversations((current) => {
      const next = new Set(current);
      if (next.has(phoneNumber)) next.delete(phoneNumber);
      else next.add(phoneNumber);
      return next;
    });
  };

  const refreshInbox = () => {
    void queryClient.invalidateQueries({ queryKey: getListWhatsAppInboxQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetWhatsAppStatusQueryKey() });
  };

  const handleSend = (message: WhatsAppInboxMessage, reply: string) => {
    setActionError("");
    setActionMessage("");
    sendReply.mutate(
      { inboxId: message.id, data: { reply } },
      {
        onSuccess: () => {
          setActionMessage("Reply sent. The conversation has been updated.");
          refreshInbox();
        },
        onError: (error) => {
          setActionError(getErrorMessage(error));
          void queryClient.invalidateQueries({
            queryKey: getListWhatsAppInboxQueryKey(),
          });
        },
      },
    );
  };

  const toggleAdultApproval = (conversation: Conversation) => {
    setActionError("");
    setActionMessage("");
    if (conversation.isAdultApproved) {
      if (
        conversation.contactId === null ||
        !window.confirm(
          `Remove the 18+ approval for ${conversation.displayName || conversation.phoneNumber}? Auto-replies to this contact will stop.`,
        )
      ) {
        return;
      }
      removeContactApproval.mutate(
        { contactId: conversation.contactId },
        {
          onSuccess: () => {
            setActionMessage("18+ approval removed.");
            refreshInbox();
          },
          onError: (error) => setActionError(getErrorMessage(error)),
        },
      );
      return;
    }

    if (
      !window.confirm(
        `Confirm that ${conversation.displayName || conversation.phoneNumber} is 18 or older? This is your confirmation; the app does not verify age automatically.`,
      )
    ) {
      return;
    }
    approveContact.mutate(
      {
        data: {
          phoneNumber: conversation.phoneNumber,
          displayName: conversation.displayName,
          adultConfirmed: true,
        },
      },
      {
        onSuccess: () => {
          setActionMessage("Contact approved as 18+.");
          refreshInbox();
        },
        onError: (error) => setActionError(getErrorMessage(error)),
      },
    );
  };

  return (
    <section
      className="mt-5 rounded-[18px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)]"
      data-testid="section-whatsapp-message-inbox"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-[17px] sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-[10px] bg-[hsl(var(--primary)/.09)] text-[hsl(var(--primary))]">
            <MessageSquareText size={16} />
          </span>
          <div>
            <h2 className="text-[14px] font-bold tracking-[-.02em]">Conversations</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Open a contact to view its messages and replies.
            </p>
          </div>
        </div>
        <span
          className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground"
          data-testid="status-inbox-pending-count"
        >
          {pendingCount} need a reply
        </span>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          New direct text messages and replies from this device are remembered
          from pairing onward. Previous WhatsApp history is not imported.
        </p>

        {connection !== "connected" && (
          <p className="rounded-[10px] bg-[hsl(var(--muted)/.68)] px-3.5 py-3 text-[10px] leading-relaxed text-muted-foreground">
            Connect WhatsApp to receive new messages. Existing inbox records
            remain available while disconnected.
          </p>
        )}

        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[9px] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-[11px] leading-relaxed text-[hsl(var(--destructive))]"
            data-testid="status-inbox-action-error"
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
        {actionMessage && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-[9px] bg-[hsl(158_34%_43%/.08)] px-3 py-2.5 text-[11px] text-[hsl(158_34%_33%)]"
            data-testid="status-inbox-action-success"
          >
            <Check size={14} className="shrink-0" />
            {actionMessage}
          </p>
        )}

        {inbox.isLoading ? (
          <div
            role="status"
            aria-label="Loading conversations"
            data-testid="status-inbox-loading"
            className="space-y-3"
          >
            <div className="skeleton h-24 rounded-[14px]" />
            <div className="skeleton h-24 rounded-[14px]" />
          </div>
        ) : inbox.isError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-[10px] bg-[hsl(var(--destructive)/.08)] p-3 text-[11px] text-[hsl(var(--destructive))]"
            data-testid="status-inbox-load-error"
          >
            <span>{getErrorMessage(inbox.error)}</span>
            <button
              type="button"
              onClick={() => inbox.refetch()}
              data-testid="button-retry-inbox"
              className="shrink-0 font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : conversations.length ? (
          <div className="space-y-4" data-testid="list-whatsapp-inbox">
            {conversations.map((conversation) => {
                const expanded = expandedConversations.has(conversation.phoneNumber);
                const latestMessage =
                  conversation.messages[conversation.messages.length - 1];
                const contactName =
                  conversation.displayName || conversation.phoneNumber;
                const pendingInConversation = conversation.messages.filter(
                  (message) => message.status === "pending",
                ).length;
                const messageListId = `conversation-messages-${conversation.phoneNumber.replace(
                  /[^a-zA-Z0-9_-]/g,
                  "_",
                )}`;

                return (
                  <section
                    key={conversation.phoneNumber}
                    className="overflow-hidden rounded-[14px] border border-[hsl(var(--border))]"
                    data-testid={`conversation-${conversation.phoneNumber}`}
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={messageListId}
                      aria-label={`${expanded ? "Collapse" : "Expand"} messages from ${contactName}`}
                      onClick={() => toggleConversation(conversation.phoneNumber)}
                      className="flex w-full items-center justify-between gap-3 bg-[hsl(var(--background)/.7)] px-4 py-3 text-left transition hover:bg-[hsl(var(--background))]"
                      data-testid={`button-toggle-conversation-${conversation.phoneNumber}`}
                    >
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[12px] font-bold">
                          {contactName}
                        </h3>
                        {conversation.displayName && (
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                            {conversation.phoneNumber}
                          </p>
                        )}
                        {latestMessage && (
                          <p className="mt-1 truncate text-[10px] leading-relaxed text-muted-foreground">
                            {latestMessage.messageText}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right">
                          <p className="font-mono text-[9px] text-muted-foreground">
                            {conversation.messages.length}{" "}
                            {conversation.messages.length === 1
                              ? "message"
                              : "messages"}
                          </p>
                          {pendingInConversation > 0 && (
                            <p className="mt-1 text-[9px] font-semibold text-[hsl(var(--primary))]">
                              {pendingInConversation} need
                              {pendingInConversation === 1 ? "s" : ""} reply
                            </p>
                          )}
                          <p className="mt-1 font-mono text-[8px] text-muted-foreground">
                            {formatDate(conversation.latestReceivedAt)}
                          </p>
                        </div>
                        <ChevronDown
                          size={14}
                          aria-hidden="true"
                          className={`shrink-0 text-muted-foreground transition-transform ${
                            expanded ? "rotate-180" : ""
                          }`}
                        />
                      </div>
                    </button>
                    <div
                      id={messageListId}
                      hidden={!expanded}
                      className="space-y-3 border-t border-[hsl(var(--border))] p-3 sm:p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--background)/.7)] p-3">
                        <div className="min-w-[220px] flex-1">
                          <p className="text-[9px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                            Conversation memory
                          </p>
                          <p className="mt-1.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed">
                            {conversation.conversationSummary ||
                              "Memory updates when AI suggestions or an automatic reply are generated."}
                          </p>
                          <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
                            Full text is stored in this project and sent to Gemini
                            when generating replies.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={
                            approveContact.isPending ||
                            removeContactApproval.isPending ||
                            (conversation.isAdultApproved &&
                              conversation.contactId === null)
                          }
                          onClick={() => toggleAdultApproval(conversation)}
                          data-testid={`button-toggle-adult-approval-${conversation.phoneNumber}`}
                          className={`h-9 shrink-0 rounded-[9px] border px-3 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            conversation.isAdultApproved
                              ? "border-[hsl(var(--border))] text-muted-foreground hover:text-[hsl(var(--destructive))]"
                              : "border-[hsl(var(--primary)/.25)] bg-[hsl(var(--primary)/.07)] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/.12)]"
                          }`}
                        >
                          {approveContact.isPending ||
                          removeContactApproval.isPending
                            ? "Saving…"
                            : conversation.isAdultApproved
                              ? "Remove 18+ approval"
                              : "Confirm contact is 18+"}
                        </button>
                      </div>
                      {conversation.messages.map((message) => (
                        <ConversationMessage
                          key={message.id}
                          message={message}
                          connected={connection === "connected"}
                          sending={
                            sendReply.isPending &&
                            sendReply.variables?.inboxId === message.id
                          }
                          onSend={(reply) => handleSend(message, reply)}
                        />
                      ))}
                    </div>
                  </section>
                );
            })}
          </div>
        ) : (
          <div
            className="rounded-[12px] border border-dashed border-[hsl(var(--border))] px-4 py-7 text-center"
            data-testid="status-inbox-empty"
          >
            <span className="mx-auto mb-2 grid size-9 place-items-center rounded-full bg-[hsl(var(--muted))] text-muted-foreground">
              <Sparkles size={15} />
            </span>
            <p className="text-[11px] font-semibold">No conversations yet.</p>
            <p className="mx-auto mt-1 max-w-[300px] text-[10px] leading-relaxed text-muted-foreground">
              New direct text messages from any number will appear here after
              WhatsApp is connected. Previous chat history is not imported.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}