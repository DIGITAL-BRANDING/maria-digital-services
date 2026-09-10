import { useEffect, useState } from 'react';
import { Download, PackageOpen } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../lib/api';

type Delivery = { id: string; title: string; description?: string | null; file_name: string; mime_type: string; file_size: number; reference?: string | null; created_at: string };
export default function DeliveriesPage() {
  const [items, setItems] = useState<Delivery[]>([]); const [error, setError] = useState('');
  useEffect(() => { api.get<{data: Delivery[]}>('/deliveries').then(r => setItems(r.data)).catch(e => setError(e.message)); }, []);
  async function download(id: string, name: string) { const r = await api.get<{data: {url: string}}>('/deliveries/' + id + '/download'); const a = document.createElement('a'); a.href = r.data.url; a.download = name; a.target = '_blank'; a.click(); }
  return <AppShell><header className="rounded-2xl border border-gold-500/40 bg-ink p-6 text-cream shadow-xl"><p className="text-sm font-semibold text-gold-300">Account resources</p><h1 className="mt-1 text-3xl font-bold">My Deliveries</h1><p className="mt-2 text-sm text-cream/70">Files manually delivered to your account by support.</p></header><section className="mt-6 space-y-3">{error && <p className="rounded-xl bg-ember-500/10 p-4 text-sm text-ember-600">{error}</p>}{!items.length && !error && <div className="rounded-2xl border border-gold-500/30 bg-ink-soft p-10 text-center text-cream/70"><PackageOpen className="mx-auto mb-3 text-gold-400"/><p>No deliveries yet.</p></div>}{items.map(item => <article key={item.id} className="flex items-center justify-between gap-4 rounded-2xl border border-gold-500/35 bg-ink p-4 text-cream shadow-lg"><div><h2 className="font-semibold text-gold-200">{item.title}</h2><p className="text-xs text-cream/65">{item.file_name} · {new Date(item.created_at).toLocaleString()}</p>{item.description && <p className="mt-1 text-sm text-cream/75">{item.description}</p>}</div><button onClick={() => download(item.id, item.file_name)} className="flex shrink-0 items-center gap-2 rounded-xl bg-gold-500 px-3 py-2 text-sm font-bold text-ink hover:bg-gold-400"><Download size={16}/>Download</button></article>)}</section></AppShell>;
}
