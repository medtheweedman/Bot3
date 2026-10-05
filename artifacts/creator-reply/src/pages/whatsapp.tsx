import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetWhatsAppStatusQueryKey,
  useConnectWhatsApp,
  useDisconnectWhatsApp,
  useGetWhatsAppStatus,
  useUpdateWhatsAppSettings,
} from "@workspace/api-client-react";
import { ConversationInbox } from "@/components/whatsapp/conversation-inbox";
import {
  AlertCircle,
  Check,
  Link2,
  LoaderCircle,
  Phone,
  QrCode,
  Wifi,
  WifiOff,
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
      return "Couldn’t reach the WhatsApp service. Check the connection and try again.";
    }
    return error.message.replace(/^HTTP \d{3}\s*[^:]*:\s*/, "");
  }
  return "Something went wrong. Please try again.";
}

function WhatsAppPage() {
  const queryClient = useQueryClient();
  const [connectError, setConnectError] = useState("");
  const [autoReplyError, setAutoReplyError] = useState("");
  const status = useGetWhatsAppStatus({
    query: {
      queryKey: getGetWhatsAppStatusQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.connection === "connecting" ||
        query.state.data?.connection === "awaiting_qr"
          ? 2500
          : 10000,
    },
  });
  const connect = useConnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();
  const updateSettings = useUpdateWhatsAppSettings();
  const currentStatus = status.data;

  const refreshStatus = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetWhatsAppStatusQueryKey(),
    });
  };

  const toggleAutoReply = () => {
    if (!currentStatus) return;
    const nextEnabled = !currentStatus.autoReplyEnabled;
    if (
      nextEnabled &&
      !window.confirm(
        "Turn on automatic replies? New messages from contacts you have confirmed are 18+ may receive an automatically generated, non-explicit reply. You can turn this off at any time.",
      )
    ) {
      return;
    }
    setAutoReplyError("");
    updateSettings.mutate(
      {
        data: {
          autoReplyEnabled: nextEnabled,
          creatorName: currentStatus.creatorName,
          tone: currentStatus.tone,
          personaNotes: currentStatus.personaNotes,
        },
      },
      {
        onSuccess: refreshStatus,
        onError: (error) => setAutoReplyError(getErrorMessage(error)),
      },
    );
  };

  const connectionLabel =
    currentStatus?.connection === "connected"
      ? "Connected"
      : currentStatus?.connection === "awaiting_qr"
        ? "Waiting for QR scan"
        : currentStatus?.connection === "connecting"
          ? "Starting connection"
          : currentStatus?.connection === "error" || status.isError
            ? "Needs attention"
            : "Not connected";

  return (
    <main className="studio-grain min-h-[100dvh] overflow-hidden">
      <div className="relative z-10 mx-auto w-full max-w-[1120px] px-5 pb-12 sm:px-8 lg:px-12">
        <section className="mx-auto max-w-[980px] pt-9 sm:pt-12">
          <div className="reveal mb-8 flex flex-col justify-between gap-4 sm:mb-10 sm:flex-row sm:items-end">
            <div className="max-w-[630px]">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--primary))]">
                <span className="h-px w-6 bg-[hsl(var(--primary))]" />
                a quieter way to keep in touch
              </div>
              <h1 className="font-serif text-[38px] leading-[1.04] tracking-[-.04em] sm:text-[52px]">
                Your WhatsApp,
                <br className="hidden sm:block" />{" "}
                <em className="font-medium text-[hsl(var(--primary))]">
                  on your terms.
                </em>
              </h1>
              <p className="mt-4 max-w-[520px] text-[14px] leading-[1.7] text-muted-foreground">
                Keep conversation context, draft replies with Gemini, or enable
                guarded automatic replies for contacts you confirm are 18+.
              </p>
            </div>
            <div
              className="flex items-center gap-2 self-start rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.8)] px-3.5 py-2 sm:self-auto"
              data-testid="status-whatsapp-connection"
            >
              <span
                className={`size-2 rounded-full ${
                  currentStatus?.connection === "connected"
                    ? "bg-[hsl(158_34%_43%)]"
                    : currentStatus?.connection === "error" || status.isError
                      ? "bg-[hsl(var(--destructive))]"
                      : "bg-[hsl(35_48%_59%)]"
                }`}
              />
              <span className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                {status.isLoading ? "checking" : connectionLabel}
              </span>
            </div>
          </div>

          {status.isLoading ? (
            <div
              role="status"
              aria-label="Loading WhatsApp connection"
              data-testid="status-whatsapp-loading"
              className="skeleton h-[320px] rounded-[18px]"
            />
          ) : status.isError ? (
            <div
              role="alert"
              data-testid="status-whatsapp-load-error"
              className="flex items-start gap-3 rounded-2xl border border-[hsl(var(--destructive)/.22)] bg-[hsl(var(--card))] p-5 text-sm"
            >
              <AlertCircle
                className="mt-0.5 text-[hsl(var(--destructive))]"
                size={18}
              />
              <div className="flex-1">
                <strong>WhatsApp status couldn’t load.</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  {getErrorMessage(status.error)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => status.refetch()}
                data-testid="button-retry-whatsapp-status"
                className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-semibold"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <section
                className="reveal rounded-[18px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)]"
                data-testid="section-whatsapp-connection"
              >
                <div className="flex items-start justify-between border-b border-[hsl(var(--border))] px-5 py-[17px] sm:px-6">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-[10px] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
                      <Link2 size={16} />
                    </span>
                    <div>
                      <h2 className="text-[14px] font-bold tracking-[-.02em]">
                        Link a device
                      </h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Pair your own WhatsApp account to receive conversations.
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    01
                  </span>
                </div>

                <div className="p-5 sm:p-6">
                  <ol className="space-y-3 text-[11px] leading-[1.6] text-muted-foreground">
                    <li className="flex gap-3">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--muted))] font-mono text-[9px] text-foreground">
                        1
                      </span>
                      <span>Open WhatsApp on your phone.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--muted))] font-mono text-[9px] text-foreground">
                        2
                      </span>
                      <span>
                        Go to <strong className="text-foreground">Linked devices</strong>,
                        then choose <strong className="text-foreground">Link a device</strong>.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[hsl(var(--muted))] font-mono text-[9px] text-foreground">
                        3
                      </span>
                      <span>Scan the QR code shown here with your phone.</span>
                    </li>
                  </ol>

                  {currentStatus?.connection === "awaiting_qr" &&
                  currentStatus.qrDataUrl ? (
                    <div
                      className="my-5 rounded-[14px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-center"
                      data-testid="status-whatsapp-qr"
                    >
                      <div className="mx-auto grid size-[240px] max-w-full place-items-center overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-white p-2">
                        <img
                          src={currentStatus.qrDataUrl}
                          alt="WhatsApp device pairing QR code"
                          className="size-full object-contain"
                          data-testid="img-whatsapp-qr"
                        />
                      </div>
                      <p className="mt-3 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                        <QrCode size={13} />
                        QR refreshes automatically while pairing.
                      </p>
                    </div>
                  ) : currentStatus?.connection === "connected" ? (
                    <div
                      className="my-5 flex items-center gap-3 rounded-[13px] border border-[hsl(158_34%_43%/.2)] bg-[hsl(158_34%_43%/.07)] p-4"
                      data-testid="status-whatsapp-connected"
                    >
                      <span className="grid size-9 place-items-center rounded-full bg-[hsl(158_34%_43%/.14)] text-[hsl(158_34%_33%)]">
                        <Check size={17} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-foreground">
                          Device linked
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {currentStatus.phoneNumber || "WhatsApp account connected"}
                        </p>
                      </div>
                    </div>
                  ) : currentStatus?.connection === "connecting" ? (
                    <div
                      role="status"
                      data-testid="status-whatsapp-connecting"
                      className="my-5 flex items-center gap-3 rounded-[13px] bg-[hsl(var(--muted)/.6)] p-4"
                    >
                      <LoaderCircle
                        size={18}
                        className="animate-spin text-[hsl(var(--primary))]"
                      />
                      <div>
                        <p className="text-[12px] font-semibold">
                          Preparing a secure pairing…
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          This can take a few moments.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="my-5 grid min-h-[135px] place-items-center rounded-[14px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background)/.65)] px-4 text-center"
                      data-testid="status-whatsapp-not-paired"
                    >
                      <div>
                        <span className="mx-auto mb-2 grid size-9 place-items-center rounded-full bg-[hsl(var(--muted))] text-muted-foreground">
                          <Phone size={16} />
                        </span>
                        <p className="text-[11px] font-semibold">
                          Your phone is not linked yet.
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Start pairing to create a fresh QR code.
                        </p>
                      </div>
                    </div>
                  )}

                  {(connectError || currentStatus?.lastError) && (
                    <div
                      role="alert"
                      data-testid="status-whatsapp-connect-error"
                      className="mb-4 flex items-start gap-2 rounded-[9px] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-[11px] leading-relaxed text-[hsl(var(--destructive))]"
                    >
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      <span>{connectError || currentStatus?.lastError}</span>
                    </div>
                  )}
                  {connect.isError && !connectError && (
                    <div role="alert" className="mb-4 text-[11px] text-[hsl(var(--destructive))]">
                      {getErrorMessage(connect.error)}
                    </div>
                  )}
                  {disconnect.isError && (
                    <div
                      role="alert"
                      data-testid="status-whatsapp-disconnect-error"
                      className="mb-4 text-[11px] text-[hsl(var(--destructive))]"
                    >
                      {getErrorMessage(disconnect.error)}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {currentStatus?.connection === "connected" ? (
                      <button
                        type="button"
                        disabled={disconnect.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Disconnect this WhatsApp device? New incoming messages will pause until you reconnect.",
                            )
                          ) {
                            setConnectError("");
                            disconnect.mutate(undefined, {
                              onSuccess: refreshStatus,
                            });
                          }
                        }}
                        data-testid="button-disconnect-whatsapp"
                        className="flex h-10 items-center gap-2 rounded-[9px] border border-[hsl(var(--border))] px-4 text-[11px] font-bold text-foreground transition hover:border-[hsl(var(--destructive)/.35)] hover:text-[hsl(var(--destructive))] disabled:opacity-50"
                      >
                        {disconnect.isPending ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : (
                          <WifiOff size={14} />
                        )}
                        Disconnect
                      </button>
                    ) : currentStatus?.connection === "awaiting_qr" ? (
                      <button
                        type="button"
                        onClick={() => void status.refetch()}
                        data-testid="button-refresh-whatsapp-status"
                        className="flex h-10 items-center gap-2 rounded-[9px] border border-[hsl(var(--border))] px-4 text-[11px] font-bold text-foreground transition hover:border-[hsl(var(--primary)/.4)]"
                      >
                        {status.isFetching ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : (
                          <QrCode size={14} />
                        )}
                        Refresh status
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          connect.isPending ||
                          currentStatus?.connection === "connecting"
                        }
                        onClick={() => {
                          setConnectError("");
                          connect.mutate(undefined, {
                            onSuccess: refreshStatus,
                            onError: (error) => setConnectError(getErrorMessage(error)),
                          });
                        }}
                        data-testid="button-connect-whatsapp"
                        className="flex h-10 items-center gap-2 rounded-[9px] bg-[hsl(var(--primary))] px-4 text-[11px] font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 disabled:opacity-60"
                      >
                        {connect.isPending ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : currentStatus?.connection === "error" ? (
                          <QrCode size={14} />
                        ) : (
                          <Wifi size={14} />
                        )}
                        {currentStatus?.connection === "error"
                          ? "Try again"
                          : "Connect WhatsApp"}
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section
                className="reveal mt-5 rounded-[18px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] sm:p-6"
                data-testid="section-whatsapp-auto-reply"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-[620px]">
                    <h2 className="text-[14px] font-bold tracking-[-.02em]">
                      Automatic replies
                    </h2>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      When enabled, Gemini can send short, non-explicit replies
                      to contacts you have confirmed are 18+. Messages from
                      unapproved numbers stay in your inbox.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-3">
                    <span className="text-[10px] font-bold">
                      {currentStatus?.autoReplyEnabled ? "On" : "Off"}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Enable automatic WhatsApp replies"
                      checked={currentStatus?.autoReplyEnabled ?? false}
                      disabled={
                        updateSettings.isPending ||
                        currentStatus?.connection !== "connected" ||
                        (currentStatus?.approvedContactCount ?? 0) === 0
                      }
                      onChange={toggleAutoReply}
                      data-testid="toggle-whatsapp-auto-reply"
                      className="size-4 accent-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                </div>
                <p className="mt-3 text-[9px] leading-relaxed text-muted-foreground">
                  {(currentStatus?.approvedContactCount ?? 0) === 0
                    ? "Open a conversation and confirm a contact is 18+ before enabling this."
                    : currentStatus?.connection !== "connected"
                      ? "Connect WhatsApp before enabling automatic replies."
                      : "Only new incoming messages are considered; enabling this does not send replies to older inbox messages."}
                </p>
                {autoReplyError && (
                  <p
                    role="alert"
                    className="mt-3 text-[10px] text-[hsl(var(--destructive))]"
                    data-testid="status-auto-reply-error"
                  >
                    {autoReplyError}
                  </p>
                )}
              </section>

              <ConversationInbox connection={currentStatus?.connection} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default WhatsAppPage;