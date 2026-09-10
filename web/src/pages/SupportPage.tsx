import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, MessageCircle, Send } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../lib/api';

type TicketSummary = { id: string; subject: string; status: string; created_at: string; last_message: string | null };
type ThreadMessage = { id: string; sender_type: 'USER' | 'ADMIN'; sender_name: string; message: string; created_at: string };
type TicketThread = { id: string; subject: string; status: string; created_at: string; messages: ThreadMessage[] };

function statusBadge(status: string) {
  const map: Record<string, string> = {
    OPEN: 'bg-gold-100 text-gold-700',
    PENDING: 'bg-brand-100 text-brand-700',
    CLOSED: 'bg-slate-200 text-slate-600',
  };
  return map[status] ?? 'bg-slate-200 text-slate-600';
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<TicketThread | null>(null);
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  function loadTickets() {
    setLoading(true);
    api
      .get<{ data: TicketSummary[] }>('/support/tickets/mine')
      .then((r) => setTickets(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load complaints.'))
      .finally(() => setLoading(false));
  }
  useEffect(loadTickets, []);

  function openTicket(id: string) {
    setOpenId(id);
    setThread(null);
    api
      .get<{ data: TicketThread }>(`/support/tickets/${id}`)
      .then((r) => setThread(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load this complaint.'));
  }

  async function sendReply() {
    if (!openId || !reply.trim()) return;
    setSendingReply(true);
    try {
      await api.post(`/support/tickets/${openId}/reply`, { message: reply.trim() });
      setReply('');
      const r = await api.get<{ data: TicketThread }>(`/support/tickets/${openId}`);
      setThread(r.data);
      loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reply failed to send.');
    } finally {
      setSendingReply(false);
    }
  }

  async function submitNewComplaint() {
    setFormError('');
    if (subject.trim().length < 3) return setFormError('Subject must be at least 3 characters.');
    if (message.trim().length < 3) return setFormError('Message must be at least 3 characters.');
    setSubmitting(true);
    try {
      await api.post('/support/tickets', { subject: subject.trim(), message: message.trim() });
      setSubject('');
      setMessage('');
      setShowNew(false);
      loadTickets();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Unable to send your complaint.');
    } finally {
      setSubmitting(false);
    }
  }

  // Thread / detail view
  if (openId) {
    return (
      <AppShell>
        <div className="max-w-2xl">
          <button
            onClick={() => {
              setOpenId(null);
              setThread(null);
            }}
            className="flex items-center gap-2 text-sm font-semibold text-ink-600 hover:text-ink"
          >
            <ArrowLeft size={16} /> Back to complaints
          </button>

          {!thread ? (
            <div className="mt-6 flex justify-center py-10">
              <Loader2 className="animate-spin text-gold-500" />
            </div>
          ) : (
            <>
              <header className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-parchment-line bg-parchment p-5">
                <div>
                  <h1 className="font-display text-xl font-bold text-ink">{thread.subject}</h1>
                  <p className="mt-1 text-xs text-ink-600">Opened {new Date(thread.created_at).toLocaleString()}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge(thread.status)}`}>{thread.status}</span>
              </header>

              <section className="mt-4 space-y-3">
                {thread.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_type === 'ADMIN' ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        m.sender_type === 'ADMIN' ? 'bg-white border border-parchment-line text-ink' : 'bg-ink text-cream'
                      }`}
                    >
                      <p className="mb-1 text-xs font-bold opacity-70">{m.sender_type === 'ADMIN' ? m.sender_name || 'Support' : 'You'}</p>
                      <p className="whitespace-pre-wrap leading-5">{m.message}</p>
                      <time className="mt-1 block text-[10px] opacity-60">{new Date(m.created_at).toLocaleString()}</time>
                    </div>
                  </div>
                ))}
              </section>

              <section className="mt-5 flex flex-col gap-2 rounded-2xl border border-parchment-line bg-parchment p-4 sm:flex-row">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Write a reply..."
                  className="flex-1 resize-none rounded-lg border border-parchment-line bg-cream px-3 py-2 text-sm"
                />
                <button
                  onClick={sendReply}
                  disabled={sendingReply || !reply.trim()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-ink disabled:opacity-50"
                >
                  {sendingReply ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Send
                </button>
              </section>
            </>
          )}
        </div>
      </AppShell>
    );
  }

  // List view
  return (
    <AppShell>
      <div className="max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Complaints & Support</h1>
            <p className="mt-1 text-sm text-ink-600">Send a complaint or question straight to our support team.</p>
          </div>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="shrink-0 rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-ink hover:bg-gold-400"
          >
            {showNew ? 'Cancel' : 'New complaint'}
          </button>
        </div>

        {showNew && (
          <section className="mt-4 rounded-2xl border border-parchment-line bg-parchment p-5">
            <h2 className="font-display font-bold text-ink">Raise a new complaint</h2>
            <div className="mt-3 space-y-3">
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject (e.g. Wallet funding not credited)"
                className="w-full rounded-lg border border-parchment-line bg-cream px-3 py-2 text-sm"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Describe your issue in detail..."
                className="w-full resize-none rounded-lg border border-parchment-line bg-cream px-3 py-2 text-sm"
              />
              {formError && <p className="text-sm font-medium text-ember-600">{formError}</p>}
              <button
                onClick={submitNewComplaint}
                disabled={submitting}
                className="flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-ink disabled:opacity-50"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit complaint
              </button>
            </div>
          </section>
        )}

        <section className="mt-5 space-y-3">
          {error && <p className="rounded-xl bg-ember-500/10 p-4 text-sm text-ember-600">{error}</p>}
          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-gold-500" />
            </div>
          )}
          {!loading && !tickets.length && !error && (
            <div className="rounded-2xl border border-parchment-line bg-parchment p-10 text-center text-ink-600">
              <MessageCircle className="mx-auto mb-3 text-gold-400" />
              <p>You have no complaints yet. Tap "New complaint" to reach support.</p>
            </div>
          )}
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => openTicket(t.id)}
              className="flex w-full items-center justify-between gap-4 rounded-2xl border border-parchment-line bg-parchment p-4 text-left hover:border-gold-400"
            >
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-ink">{t.subject}</h3>
                <p className="mt-1 truncate text-xs text-ink-600">{t.last_message ?? 'No messages yet'}</p>
                <p className="mt-1 text-[11px] text-slate-400">{new Date(t.created_at).toLocaleString()}</p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${statusBadge(t.status)}`}>{t.status}</span>
            </button>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
