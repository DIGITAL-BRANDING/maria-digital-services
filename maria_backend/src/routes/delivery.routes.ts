import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listUserDeliveries, signedDeliveryUrl } from '../services/user-delivery.service.js';

export const deliveryRoutes = Router();
deliveryRoutes.use(requireAuth);
deliveryRoutes.get('/', async (req, res) => {
  const rows = await listUserDeliveries(req.user!.id);
  res.json({ status: true, data: rows.map((r) => ({ id: r.id, title: r.title, description: r.description, file_name: r.fileName, mime_type: r.mimeType, file_size: r.fileSize, reference: r.reference, created_at: r.createdAt.toISOString() })) });
});
deliveryRoutes.get('/:id/download', async (req, res) => {
  const result = await signedDeliveryUrl(req.user!.id, req.params.id);
  if (!result || !result.url) return res.status(404).json({ status: false, message: 'Delivery not found' });
  res.json({ status: true, data: { url: result.url, file_name: result.row.fileName, mime_type: result.row.mimeType, expires_in: 300 } });
});
