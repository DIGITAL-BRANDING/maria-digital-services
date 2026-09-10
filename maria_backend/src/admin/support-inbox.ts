import type { Request, Router } from 'express';
import { prisma } from '../lib/prisma.js';
import type { AdminSessionUser } from './auth.js';

declare module 'express-session' {
  interface SessionData { adminUser?: AdminSessionUser; }
}

// Same gotcha as user-wallet.ts / bulk-pricing.ts: AdminJSExpress mounts
// express-formidable ahead of any route on this router, so the body is
// already parsed into req.fields (formidable's property) by the time a
// handler here runs - NOT req.body. Do not add express.urlencoded()/json()
// here, it throws "stream is not readable" since the stream is consumed.
type FormidableFields = Record<string, string | string[] | undefined>;
function field(req: Request, name: string): string {
  const v = ((req as unknown as { fields?: FormidableFields }).fields ?? {})[name];
  return typeof v === 'string' ? v : '';
}

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);

const canManageTickets = (role?: string) => role === 'SUPER_ADMIN' || role === 'FINANCE' || role === 'SUPPORT';

const STYLE = `body{font-family:Arial,sans-serif;background:#f5f6f8;color:#18212f;margin:0;padding:28px}
a{color:#8b6c00;text-decoration:none}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.tabs{margin:16px 0;display:flex;gap:8px}
.tabs a{padding:8px 14px;border-radius:8px;background:#fff;box-shadow:0 1px 4px #0001;font-weight:bold}
.tabs a.active{background:#d4af37;color:#111}
.list{background:#fff;border-radius:10px;box-shadow:0 1px 4px #0001;overflow:hidden}
.row{display:block;padding:16px 20px;border-bottom:1px solid #eee;color:#18212f}
.row:hover{background:#faf7ec}
.row .subject{font-weight:bold}
.row .meta{color:#64748b;font-size:13px;margin-top:3px}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:bold;margin-left:8px}
.badge.OPEN{background:#fde68a;color:#7a5900}
.badge.PENDING{background:#bfdbfe;color:#1e3a8a}
.badge.CLOSED{background:#e2e8f0;color:#475569}
.thread{background:#fff;border-radius:10px;box-shadow:0 1px 4px #0001;padding:20px;margin-top:16px}
.msg{max-width:75%;padding:12px 14px;border-radius:12px;margin-bottom:12px;font-size:14px;line-height:1.4}
.msg.ADMIN{background:#eef2ff;margin-right:auto}
.msg.USER{background:#111827;color:#fff;margin-left:auto}
.msg .who{font-weight:bold;font-size:12px;opacity:0.7;margin-bottom:4px}
.msg .when{font-size:11px;opacity:0.55;margin-top:6px}
form.reply{margin-top:20px;display:flex;gap:10px}
textarea{flex:1;padding:10px;border-radius:8px;border:1px solid #ccc;font-family:inherit;resize:vertical;min-height:60px}
button{padding:10px 18px;border-radius:8px;border:1px solid #ccc;background:#d4af37;font-weight:bold;cursor:pointer}
button.secondary{background:#fff}
.empty{padding:40px;text-align:center;color:#64748b}
`;

/** AdminJS companion page for handling user complaints without the
 * paste-the-ticket-ID workaround the raw SupportTicketMessage resource
 * requires. Lists tickets by status and lets an admin reply/close inline. */
export function registerSupportInboxRoutes(router: Router) {
  router.get('/support-inbox', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (!canManageTickets(admin.role)) return res.status(403).send('Forbidden');

    const status = ['OPEN', 'PENDING', 'CLOSED', 'ALL'].includes(String(req.query.status)) ? String(req.query.status) : 'OPEN';
    const where = status === 'ALL' ? {} : { status: status as 'OPEN' | 'PENDING' | 'CLOSED' };

    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
    const userIds = [...new Set(tickets.map((t) => t.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } });
    const usersById = new Map(users.map((u) => [u.id, u]));

    const tabs = ['OPEN', 'PENDING', 'CLOSED', 'ALL']
      .map((s) => `<a class="${s === status ? 'active' : ''}" href="/admin/support-inbox?status=${s}">${s}</a>`)
      .join('');

    const rows = tickets
      .map((t) => {
        const user = usersById.get(t.userId);
        const last = t.messages[0]?.message ?? 'No messages yet';
        return `<a class="row" href="/admin/support-inbox/${t.id}"><span class="subject">${esc(t.subject)}<span class="badge ${t.status}">${t.status}</span></span><div class="meta"><b>${esc(user?.fullName ?? 'Unknown user')}</b> (${esc(user?.email ?? '—')}) · ${esc(last).slice(0, 120)} · ${t.updatedAt.toLocaleString()}</div></a>`;
      })
      .join('');

    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Support Inbox</title><style>${STYLE}</style></head><body>
<div class="top"><div><h1>Support Inbox</h1><p>Complaints and questions sent in by customers from their dashboard.</p></div><a href="/admin">← Back to Admin Dashboard</a></div>
<div class="tabs">${tabs}</div>
<div class="list">${rows || `<div class="empty">No ${status === 'ALL' ? '' : status.toLowerCase()} complaints.</div>`}</div>
</body></html>`);
  });

  router.get('/support-inbox/:id', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (!canManageTickets(admin.role)) return res.status(403).send('Forbidden');

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    if (!ticket) return res.status(404).send('Ticket not found');
    const user = await prisma.user.findUnique({ where: { id: ticket.userId }, select: { fullName: true, email: true } });

    const messages = ticket.messages
      .map(
        (m) =>
          `<div class="msg ${m.senderType}"><div class="who">${esc(m.senderName)}</div><div>${esc(m.message).replace(/\n/g, '<br>')}</div><div class="when">${m.createdAt.toLocaleString()}</div></div>`
      )
      .join('');

    const closeButton =
      ticket.status === 'CLOSED'
        ? `<form method="post" action="/admin/support-inbox/${ticket.id}/reopen"><button class="secondary" type="submit">Reopen ticket</button></form>`
        : `<form method="post" action="/admin/support-inbox/${ticket.id}/close"><button class="secondary" type="submit">Mark as closed</button></form>`;

    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(ticket.subject)}</title><style>${STYLE}</style></head><body>
<div class="top"><div><h1>${esc(ticket.subject)} <span class="badge ${ticket.status}">${ticket.status}</span></h1><p><b>${esc(user?.fullName ?? 'Unknown user')}</b> (${esc(user?.email ?? '—')}) · opened ${ticket.createdAt.toLocaleString()}</p></div><a href="/admin/support-inbox">← Back to inbox</a></div>
<div class="thread">${messages}
<form class="reply" method="post" action="/admin/support-inbox/${ticket.id}/reply">
  <textarea name="message" placeholder="Write a reply to this customer..." required></textarea>
  <button type="submit">Send reply</button>
</form>
${closeButton}
</div>
</body></html>`);
  });

  router.post('/support-inbox/:id/reply', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (!canManageTickets(admin.role)) return res.status(403).send('Forbidden');

    const message = field(req, 'message').trim();
    if (message.length > 0) {
      const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
      if (ticket) {
        await prisma.$transaction([
          prisma.supportTicketMessage.create({
            data: {
              ticketId: ticket.id,
              senderType: 'ADMIN',
              senderId: admin.id,
              senderName: admin.fullName ?? 'Support',
              message
            }
          }),
          prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'PENDING' } })
        ]);
      }
    }
    res.redirect(`/admin/support-inbox/${req.params.id}`);
  });

  router.post('/support-inbox/:id/close', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (!canManageTickets(admin.role)) return res.status(403).send('Forbidden');
    await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status: 'CLOSED' } }).catch(() => null);
    res.redirect(`/admin/support-inbox/${req.params.id}`);
  });

  router.post('/support-inbox/:id/reopen', async (req, res) => {
    const admin = req.session?.adminUser;
    if (!admin) return res.redirect('/admin/login');
    if (!canManageTickets(admin.role)) return res.status(403).send('Forbidden');
    await prisma.supportTicket.update({ where: { id: req.params.id }, data: { status: 'OPEN' } }).catch(() => null);
    res.redirect(`/admin/support-inbox/${req.params.id}`);
  });
}
