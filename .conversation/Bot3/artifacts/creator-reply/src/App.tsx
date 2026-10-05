import { useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useDraftCreatorReply, useHealthCheck } from '@workspace/api-client-react';
import type { CreatorReplyInput, CreatorReplyInputTone } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import WhatsAppPage from '@/pages/whatsapp';
import { Route, Switch, useLocation, Router as WouterRouter, Link } from 'wouter';
import {
  getGetAuthSessionQueryKey,
  getGetWhatsAppStatusQueryKey,
  getListWhatsAppContactsQueryKey,
  useCreateAuthSession,
  useDeleteAuthSession,
  useGetAuthSession,
} from '@workspace/api-client-react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCheck,
  CircleHelp,
  Clipboard,
  Feather,
  LockKeyhole,
  MessageCircle,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  WandSparkles,
} from 'lucide-react';

const queryClient = new QueryClient();

const tones: { value: CreatorReplyInputTone; label: string; description: string }[] = [
  { value: 'playful', label: 'Playful', description: 'Light, teasing energy' },
  { value: 'warm', label: 'Warm', description: 'Affectionate and easy' },
  { value: 'confident', label: 'Confident', description: 'Poised and direct' },
  { value: 'soft', label: 'Soft', description: 'Gentle and thoughtful' },
  { value: 'spicy', label: 'Spicy', description: 'Bold, teasing, suggestive' },
];

const spicyStarterQuestions = [
  'That last photo is making it hard to focus. What are you up to tonight?',
  'You always know how to get my attention. What would you say if I were there?',
  'You’re trouble, aren’t you? Tell me something I wouldn’t guess about you.',
];

function getGenerationErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
  }

  if (error instanceof Error) {
    if (error.message === 'Failed to fetch') {
      return 'Couldn’t reach the reply service. Your details are still here—please try again.';
    }
    return error.message.replace(/^HTTP \d{3}\s*[^:]*:\s*/, '');
  }

  return 'We couldn’t make a draft just now. Your details are still here—please try again.';
}

function Home() {
  const [question, setQuestion] = useState('');
  const [clientName, setClientName] = useState('');
  const [personaName, setPersonaName] = useState('');
  const [personaNotes, setPersonaNotes] = useState('');
  const [tone, setTone] = useState<CreatorReplyInputTone>('spicy');
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState('');

  const health = useHealthCheck();
  const draftMutation = useDraftCreatorReply();

  const generateDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    if (!adultConfirmed) {
      setFormError('Please confirm this is an adult client before drafting.');
      return;
    }
    if (!question.trim() || !personaName.trim()) {
      setFormError('Add the client question and your creator name to continue.');
      return;
    }

    const payload: CreatorReplyInput = {
      question: question.trim(),
      adultConfirmed: true,
      personaName: personaName.trim(),
      tone,
      ...(clientName.trim() ? { clientName: clientName.trim() } : {}),
      ...(personaNotes.trim() ? { personaNotes: personaNotes.trim() } : {}),
    };
    setReply('');
    setCopied(false);
    draftMutation.mutate(
      { data: payload },
      {
        onSuccess: (draft) => setReply(draft.reply),
      },
    );
  };

  const copyReply = async () => {
    if (!reply.trim()) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setFormError('Copy is unavailable in this browser. Select the reply and copy it manually.');
    }
  };

  const resetDraft = () => {
    setQuestion('');
    setClientName('');
    setReply('');
    setCopied(false);
    setFormError('');
    draftMutation.reset();
  };

  const hasDraft = !!reply && !draftMutation.isPending;

  return (
    <main className="studio-grain min-h-[100dvh] overflow-hidden">
      <div className="relative z-10 mx-auto w-full max-w-[1280px] px-5 pb-10 sm:px-8 lg:px-12">
        <header className="flex h-[78px] items-center justify-between border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-[12px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
              <Feather size={18} strokeWidth={1.8} />
            </div>
            <div>
              <div className="font-serif text-[19px] font-semibold leading-none tracking-[-.03em]">reply studio</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">creator workspace</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.72)] px-3 py-1.5 sm:flex">
              <span className={`size-1.5 rounded-full ${health.isError ? 'bg-[hsl(var(--destructive))]' : health.isLoading ? 'bg-[hsl(var(--muted-foreground))]' : 'bg-[hsl(158_34%_43%)]'}`} />
              <span className="font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                {health.isLoading ? 'connecting' : health.isError ? 'offline' : 'workspace ready'}
              </span>
              {health.isError && (
                <button type="button" onClick={() => health.refetch()} aria-label="Retry connection" data-testid="button-retry-health" className="ml-1 text-muted-foreground hover:text-foreground">
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--secondary-foreground))]">
              <LockKeyhole size={13} strokeWidth={1.8} />
              <span>Creator workspace</span>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-[1000px] pt-10 sm:pt-[58px]">
          <div className="reveal mb-9 flex flex-col justify-between gap-5 sm:mb-11 sm:flex-row sm:items-end">
            <div className="max-w-[650px]">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--primary))]">
                <span className="h-px w-6 bg-[hsl(var(--primary))]" />
                a little help finding the words
              </div>
              <h1 className="font-serif text-[38px] leading-[1.04] tracking-[-.04em] text-foreground sm:text-[54px]">
                Make it sound<br className="hidden sm:block" /> <em className="font-medium text-[hsl(var(--primary))]">like you.</em>
              </h1>
              <p className="mt-4 max-w-[490px] text-[14px] leading-[1.7] text-muted-foreground sm:text-[15px]">
                Shape a natural reply to a client question. Spicy is selected by default; review and edit every draft before you copy it.
              </p>
            </div>
            <button type="button" onClick={resetDraft} data-testid="button-new-draft" className="group flex h-10 w-fit items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.75)] px-4 text-[12px] font-semibold transition-colors hover:border-[hsl(var(--primary)/.4)] hover:text-[hsl(var(--primary))]">
              <RotateCcw size={13} className="transition-transform group-hover:-rotate-45" />
              Start fresh
            </button>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[1.03fr_.97fr] lg:gap-6">
            <form onSubmit={generateDraft} className="reveal space-y-4">
              <section className="rounded-[18px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <div className="mb-5 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-[10px] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
                      <MessageCircle size={16} />
                    </span>
                    <div>
                      <h2 className="text-[14px] font-bold tracking-[-.02em]">The conversation</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">Start with what they asked you.</p>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">01 / 02</span>
                </div>
                <label htmlFor="client-question" className="mb-2 block text-[11px] font-semibold text-foreground">Client question <span className="text-[hsl(var(--primary))]">*</span></label>
                <textarea
                  id="client-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={4000}
                  placeholder="Paste or write their question here…"
                  rows={4}
                  data-testid="input-client-question"
                  className="w-full resize-y rounded-[11px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3.5 py-3 text-[13px] leading-[1.65] outline-none transition focus:border-[hsl(var(--primary)/.55)] focus:ring-2 focus:ring-[hsl(var(--primary)/.09)] placeholder:text-muted-foreground/65"
                />
                <div className="mt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Try a spicy example <span className="font-normal normal-case tracking-normal">(fills the question and selects Spicy)</span></p>
                  <div className="flex flex-wrap gap-2">
                    {spicyStarterQuestions.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => { setQuestion(starter); setTone('spicy'); }}
                        data-testid="button-spicy-starter"
                        className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-left text-[10px] leading-relaxed text-muted-foreground transition hover:border-[hsl(var(--primary)/.45)] hover:text-[hsl(var(--primary))]"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <label htmlFor="client-name" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Their name <span className="font-normal normal-case tracking-normal">(optional)</span></label>
                    <input id="client-name" value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={80} placeholder="e.g. Alex" data-testid="input-client-name" className="h-10 w-full rounded-[9px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-[12px] outline-none transition focus:border-[hsl(var(--primary)/.55)]" />
                  </div>
                  <span className="self-end pb-3 font-mono text-[9px] text-muted-foreground">{question.length}/4000</span>
                </div>
              </section>

              <section className="rounded-[18px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[var(--shadow-sm)] sm:p-6">
                <div className="mb-5 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-[10px] bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]">
                      <Sparkles size={16} />
                    </span>
                    <div>
                      <h2 className="text-[14px] font-bold tracking-[-.02em]">Your voice</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">A few details make it feel personal.</p>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">02 / 02</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                  <div>
                    <label htmlFor="persona-name" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Creator name <span className="text-[hsl(var(--primary))]">*</span></label>
                    <input id="persona-name" value={personaName} onChange={(event) => setPersonaName(event.target.value)} maxLength={80} required placeholder="How should you sign?" data-testid="input-persona-name" className="h-10 w-full rounded-[9px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-[12px] outline-none transition focus:border-[hsl(var(--primary)/.55)]" />
                  </div>
                  <div>
                    <label htmlFor="persona-notes" className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">A note about your style <span className="font-normal normal-case tracking-normal">(optional)</span></label>
                    <input id="persona-notes" value={personaNotes} onChange={(event) => setPersonaNotes(event.target.value)} maxLength={1000} placeholder="Your usual sign-off, a detail…" data-testid="input-persona-notes" className="h-10 w-full rounded-[9px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-[12px] outline-none transition focus:border-[hsl(var(--primary)/.55)]" />
                  </div>
                </div>

                <fieldset className="mt-5">
                  <legend className="mb-2.5 text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Set the tone</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {tones.map((item) => {
                      const active = tone === item.value;
                      return (
                        <button key={item.value} type="button" onClick={() => setTone(item.value)} aria-pressed={active} data-testid={`button-tone-${item.value}`} className={`rounded-[10px] border px-2.5 py-2.5 text-left transition-colors ${active ? 'border-[hsl(var(--primary)/.45)] bg-[hsl(var(--accent)/.72)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:border-[hsl(var(--primary)/.3)]'}`}>
                          <span className={`block text-[11px] font-bold ${active ? 'text-[hsl(var(--primary))]' : 'text-foreground'}`}>{item.label}</span>
                          <span className="mt-1 block text-[9px] leading-[1.4] text-muted-foreground">{item.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-[10px] bg-[hsl(var(--muted)/.68)] px-3 py-3">
                  <input type="checkbox" checked={adultConfirmed} onChange={(event) => setAdultConfirmed(event.target.checked)} data-testid="input-adult-confirmation" className="mt-0.5 size-3.5 accent-[hsl(var(--primary))]" />
                  <span className="text-[10px] leading-[1.5] text-muted-foreground">I confirm the client is an adult. Replies can be teasing and suggestive, but stay <strong className="font-semibold text-foreground">non-explicit</strong>.</span>
                </label>

                {formError && (
                  <div role="alert" data-testid="status-form-error" className="mt-3 flex items-start gap-2 rounded-[9px] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-[11px] leading-relaxed text-[hsl(var(--destructive))]">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />{formError}
                  </div>
                )}
                {draftMutation.isError && (
                  <div role="alert" data-testid="status-generation-error" className="mt-3 flex items-start gap-2 rounded-[9px] bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-[11px] leading-relaxed text-[hsl(var(--destructive))]">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <div className="flex-1">{getGenerationErrorMessage(draftMutation.error)}</div>
                    <button type="button" disabled={!adultConfirmed || !question.trim() || !personaName.trim()} onClick={() => draftMutation.mutate({ data: { question: question.trim(), adultConfirmed: true, personaName: personaName.trim(), tone, ...(clientName.trim() ? { clientName: clientName.trim() } : {}), ...(personaNotes.trim() ? { personaNotes: personaNotes.trim() } : {}) } }, { onSuccess: (draft) => setReply(draft.reply) })} data-testid="button-retry-draft" className="shrink-0 font-semibold underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Retry</button>
                  </div>
                )}
                <button type="submit" disabled={draftMutation.isPending} data-testid="button-generate-draft" className="mt-4 flex h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-[hsl(var(--primary))] text-[12px] font-bold tracking-[.01em] text-[hsl(var(--primary-foreground))] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-75">
                  {draftMutation.isPending ? <><span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" /> Finding the right words…</> : <><WandSparkles size={15} /> Draft a reply</>}
                </button>
                <p className="mt-2.5 text-center text-[9px] text-muted-foreground">A starting point, not a sent message. You’re always in control.</p>
              </section>
            </form>

            <section className="reveal-late overflow-hidden rounded-[18px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-[var(--shadow-sm)] lg:sticky lg:top-6">
              <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-[17px] sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-[10px] bg-[hsl(var(--primary)/.09)] text-[hsl(var(--primary))]">
                    <Feather size={15} />
                  </span>
                  <div>
                    <h2 className="text-[14px] font-bold tracking-[-.02em]">Your draft</h2>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{hasDraft ? 'Make it yours before you copy.' : 'Human-sounding. Up to 2 short lines.'}</p>
                  </div>
                </div>
                <span className="rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">{draftMutation.isPending ? 'working' : hasDraft ? 'editable' : 'waiting'}</span>
              </div>

              <div className="min-h-[340px] p-5 sm:min-h-[390px] sm:p-6">
                {draftMutation.isPending ? (
                  <div role="status" aria-label="Draft loading" data-testid="status-draft-loading" className="space-y-4 pt-1">
                    <div className="skeleton h-3 w-[35%] rounded-full" />
                    <div className="skeleton h-3 w-full rounded-full" />
                    <div className="skeleton h-3 w-[91%] rounded-full" />
                    <div className="skeleton h-3 w-[96%] rounded-full" />
                    <div className="skeleton h-3 w-[68%] rounded-full" />
                    <div className="mt-8 border-t border-[hsl(var(--border))] pt-6">
                      <div className="skeleton h-3 w-[88%] rounded-full" />
                      <div className="skeleton mt-3 h-3 w-[54%] rounded-full" />
                    </div>
                    <p className="pt-4 text-center font-mono text-[10px] text-muted-foreground">Taking a moment to get the tone right…</p>
                  </div>
                ) : hasDraft ? (
                  <div className="reveal">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--secondary-foreground))]">
                        <Check size={12} /> Draft ready
                      </span>
                      <span className="font-mono text-[9px] text-muted-foreground">{reply.length} characters</span>
                    </div>
                    <textarea value={reply} onChange={(event) => { setReply(event.target.value); setCopied(false); }} data-testid="input-editable-reply" aria-label="Edit generated reply" className="min-h-[240px] w-full resize-y rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 font-serif text-[16px] leading-[1.8] text-foreground outline-none transition focus:border-[hsl(var(--primary)/.45)] focus:ring-2 focus:ring-[hsl(var(--primary)/.08)] sm:min-h-[280px]" />
                    <div className="mt-3 flex items-start gap-2 text-[10px] leading-[1.55] text-muted-foreground">
                      <CircleHelp size={13} className="mt-0.5 shrink-0" />
                      <span>Read it once, make any changes you like, then copy. Nothing is sent from this workspace.</span>
                    </div>
                  </div>
                ) : (
                  <div data-testid="status-draft-empty" className="flex min-h-[300px] flex-col items-center justify-center px-3 text-center sm:min-h-[350px]">
                    <div className="relative mb-5 grid size-[66px] place-items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
                      <span className="absolute inset-[6px] rounded-full border border-dashed border-[hsl(var(--primary)/.25)]" />
                      <Feather size={23} strokeWidth={1.4} className="text-[hsl(var(--primary))]" />
                    </div>
                    <h3 className="font-serif text-[21px] italic tracking-[-.02em]">A blank page, for now.</h3>
                    <p className="mt-2 max-w-[230px] text-[11px] leading-[1.7] text-muted-foreground">Add a client question and your voice. Your first draft will appear right here.</p>
                    <div className="mt-6 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.09em] text-muted-foreground/75">
                      <span className="h-px w-5 bg-[hsl(var(--border))]" />made to be edited<span className="h-px w-5 bg-[hsl(var(--border))]" />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--background)/.7)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <LockKeyhole size={12} />
                  <span>Nothing is sent to your client</span>
                </div>
                <button type="button" disabled={!hasDraft || !reply.trim()} onClick={copyReply} data-testid="button-copy-reply" className={`flex h-10 items-center justify-center gap-2 rounded-[9px] px-4 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${copied ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]' : 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))] hover:opacity-90'}`}>
                  {copied ? <><CheckCheck size={14} /> Copied to clipboard</> : <><Clipboard size={14} /> Copy reply</>}
                </button>
              </div>
            </section>
          </div>

          <footer className="mt-8 flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-4 text-[10px] leading-[1.6] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>For adult clients only. Teasing, flirty, non-explicit replies.</span>
            <span className="font-mono text-[9px] uppercase tracking-[.08em]">Review first · send yourself</span>
          </footer>
        </section>
      </div>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/whatsapp" component={WhatsAppPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
  }
  if (error instanceof Error) return error.message.replace(/^HTTP \d{3}\s*[^:]*:\s*/, '');
  return 'Something went wrong. Please try again.';
}

function AccessGate() {
  const [code, setCode] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [currentLocation] = useLocation();
  const queryClient = useQueryClient();
  const session = useGetAuthSession();
  const signIn = useCreateAuthSession();
  const signOut = useDeleteAuthSession();

  if (session.isLoading) {
    return <main className="studio-grain min-h-[100dvh] p-6"><div className="mx-auto mt-24 max-w-md space-y-4" role="status" aria-label="Checking workspace access" data-testid="status-auth-loading"><div className="skeleton h-8 w-2/3 rounded-lg" /><div className="skeleton h-24 rounded-2xl" /><div className="skeleton h-12 rounded-lg" /></div></main>;
  }
  if (session.isError) {
    return <main className="studio-grain min-h-[100dvh] p-6"><section className="mx-auto mt-24 max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6" data-testid="status-auth-error"><h1 className="font-serif text-2xl">Workspace access is unavailable</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">We couldn’t check your studio session. Please check the service connection and try again.</p><button type="button" onClick={() => session.refetch()} data-testid="button-retry-auth" className="mt-5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))]">Try again</button></section></main>;
  }
  if (!session.data?.authenticated) {
    const setupUnavailable = signIn.isError && /not configured|unavailable yet/i.test(errorMessage(signIn.error));
    return (
      <main className="studio-grain min-h-[100dvh] px-5 py-10 sm:grid sm:place-items-center">
        <section className="reveal w-full max-w-[460px] rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-[var(--shadow-sm)] sm:p-8">
          <div className="mb-7 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"><Feather size={19} /></span><div><p className="font-serif text-xl font-semibold tracking-tight">reply studio</p><p className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">a private creator workspace</p></div></div>
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-[hsl(var(--primary))]"><LockKeyhole size={13} /> Private by design</div>
          <h1 className="font-serif text-[30px] leading-tight tracking-[-.03em]">A little space, just for you.</h1>
          <p className="mt-3 text-[13px] leading-[1.7] text-muted-foreground">Enter your 4-digit PIN to open your reply drafts and WhatsApp settings. It is sent securely for sign-in and is not saved in this browser.</p>
          <form onSubmit={(event) => { event.preventDefault(); setSubmitError(''); signIn.mutate({ data: { code } }, { onSuccess: () => { setCode(''); void queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }); }, onError: (error) => setSubmitError(errorMessage(error)) }); }} className="mt-6 space-y-3">
            <label htmlFor="workspace-code" className="block text-[11px] font-semibold">4-digit PIN</label>
            <input id="workspace-code" type="password" inputMode="numeric" pattern="[0-9]{4}" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} required maxLength={4} data-testid="input-access-code" placeholder="••••" className="h-11 w-full rounded-[10px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3.5 text-sm outline-none focus:border-[hsl(var(--primary)/.55)] focus:ring-2 focus:ring-[hsl(var(--primary)/.08)]" />
            {submitError && <div role="alert" data-testid="status-auth-submit-error" className="rounded-lg bg-[hsl(var(--destructive)/.08)] px-3 py-2.5 text-[11px] leading-relaxed text-[hsl(var(--destructive))]">{submitError}</div>}
            {setupUnavailable && <div role="alert" data-testid="status-access-code-setup" className="rounded-lg border border-[hsl(var(--accent-foreground)/.16)] bg-[hsl(var(--accent)/.55)] p-3 text-[11px] leading-relaxed text-[hsl(var(--accent-foreground))]"><strong>Workspace sign-in is not configured.</strong> Check that <code className="font-mono">WHATSAPP_ACCESS_CODE</code> is exactly 4 digits and <code className="font-mono">SESSION_SECRET</code> is at least 32 characters in Replit Secrets. Do not put either value in frontend code.</div>}
            {signIn.isError && !setupUnavailable && <p role="alert" className="text-[11px] text-[hsl(var(--destructive))]">{errorMessage(signIn.error)}</p>}
            <button type="submit" disabled={signIn.isPending || !code.trim()} data-testid="button-access-sign-in" className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-105 disabled:opacity-60">{signIn.isPending ? 'Checking access…' : <>Enter workspace <ArrowRight size={15} /></>}</button>
          </form>
          {!setupUnavailable && <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">The workspace owner sets the 4-digit <code className="font-mono">WHATSAPP_ACCESS_CODE</code> in Replit Secrets. It is separate from your WhatsApp password and pairing QR.</p>}
          <p className="mt-5 border-t border-[hsl(var(--border))] pt-4 text-[10px] leading-relaxed text-muted-foreground">Your access code protects every studio operation. It never appears in the workspace interface after sign-in.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-[100dvh]">
      <nav aria-label="Studio navigation" className="relative z-20 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.96)]">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-5 py-3 sm:px-8 lg:px-12">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <Link href="/" data-testid="link-nav-drafts" className={`flex items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold transition ${currentLocation === '/' ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'text-muted-foreground hover:bg-[hsl(var(--muted))] hover:text-foreground'}`}><Feather size={14} /><span>Draft replies</span></Link>
            <Link href="/whatsapp" data-testid="link-nav-whatsapp" className={`flex items-center gap-2 rounded-full px-3 py-2 text-[11px] font-semibold transition ${currentLocation === '/whatsapp' ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : 'text-muted-foreground hover:bg-[hsl(var(--muted))] hover:text-foreground'}`}><MessageSquareText size={14} /><span>WhatsApp</span></Link>
          </div>
          <button type="button" onClick={() => signOut.mutate(undefined, { onSuccess: () => { queryClient.removeQueries({ queryKey: getGetWhatsAppStatusQueryKey() }); queryClient.removeQueries({ queryKey: getListWhatsAppContactsQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }); } })} disabled={signOut.isPending} data-testid="button-sign-out" className="shrink-0 rounded-full border border-[hsl(var(--border))] px-3 py-2 text-[10px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50">{signOut.isPending ? 'Leaving…' : 'Sign out'}</button>
        </div>
      </nav>
      <Router />
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AccessGate />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;