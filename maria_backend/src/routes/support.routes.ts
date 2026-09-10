import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';

export const supportRoutes = Router();

supportRoutes.use(requireAuth);

// POST /api/support/tickets - matches AppEndpoints.createTicket in
// support_screen.dart, which posts {subject, message}.
supportRoutes.post('/tickets', async (req, res) => {
  const body = z
    .object({
      subject: z.string().trim().min(3).max(200),
      message: z.string().trim().min(3).max(4000)
    })
    .parse(req.body);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: user.id,
      subject: body.subject,
      messages: {
        create: {
          senderType: 'USER',
          senderId: user.id,
          senderName: user.fullName,
          message: body.message
        }
      }
    }
  });

  res.status(201).json({
    status: true,
    message: 'Ticket created',
    data: {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      created_at: ticket.createdAt.toISOString(),
      last_message: body.message
    }
  });
});

// GET /api/support/tickets/mine - matches AppEndpoints.myTickets, which
// expects an array (optionally wrapped in {data: [...]}) of
// {id, subject, status, created_at, last_message}.
supportRoutes.get('/tickets/mine', async (req, res) => {
  const tickets = await prisma.supportTicket.findMany({
    where: { userId: req.user!.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: 1 }
    }
  });

  res.json({
    status: true,
    data: tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      created_at: t.createdAt.toISOString(),
      last_message: t.messages[0]?.message ?? null
    }))
  });
});

// GET /api/support/tickets/:id - full thread for one ticket. Not wired up
// in the Flutter UI yet (the ticket list has no tap handler), but useful
// once a detail/reply screen is added, and handy for testing via curl.
supportRoutes.get('/tickets/:id', async (req, res) => {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { messages: { orderBy: { createdAt: 'asc' } } }
  });
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  }

  res.json({
    status: true,
    data: {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      created_at: ticket.createdAt.toISOString(),
      messages: ticket.messages.map((m) => ({
        id: m.id,
        sender_type: m.senderType,
        sender_name: m.senderName,
        message: m.message,
        created_at: m.createdAt.toISOString()
      }))
    }
  });
});

// POST /api/support/tickets/:id/reply - lets the user add a follow-up
// message to their own ticket, and reopens it if it had been closed.
supportRoutes.post('/tickets/:id/reply', async (req, res) => {
  const body = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

  await prisma.$transaction([
    prisma.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        senderType: 'USER',
        senderId: user.id,
        senderName: user.fullName,
        message: body.message
      }
    }),
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: 'OPEN' }
    })
  ]);

  res.json({ status: true, message: 'Reply sent' });
});
