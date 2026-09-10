import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { api } from '../lib/api';

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  type?: string;
  is_read?: boolean;
  created_at?: string;
};

export default function NotificationPopup() {
  const [notice, setNotice] = useState<NotificationItem | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await api.get<{ data?: NotificationItem[] }>('/notifications?limit=20');
        if (!active) return;
        const unread = (response.data ?? []).find((item) => !item.is_read && !dismissed.includes(item.id));
        if (unread) setNotice(unread);
      } catch {
        // Notifications are optional; never block access to the services.
      }
    };
    void load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [dismissed]);

  const close = async () => {
    if (!notice) return;
    const id = notice.id;
    setNotice(null);
    setDismissed((items) => [...items, id]);
    try { await api.post('/notifications/read', { ids: [id] }); } catch { /* best effort */ }
  };

  if (!notice) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="notification-title">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-brand-700 px-5 py-4 text-white">
          <div className="flex items-center gap-3"><span className="rounded-full bg-white/15 p-2"><Bell size={20} /></span><h2 id="notification-title" className="text-base font-bold">{notice.title}</h2></div>
          <button onClick={close} aria-label="Close notification" className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white"><X size={19} /></button>
        </div>
        <div className="px-5 py-6"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{notice.body}</p></div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-5 py-4"><button onClick={close} className="rounded-xl bg-brand-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-200">OK / Continue</button></div>
      </div>
    </div>
  );
}
