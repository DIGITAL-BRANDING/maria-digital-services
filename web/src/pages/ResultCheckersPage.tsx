import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpenCheck, GraduationCap, ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { api } from '../lib/api';

type Price = { service: string; unitPrice: number; isActive: boolean };
const exams = [
  { exam: 'WAEC', route: '/waec-result', icon: GraduationCap },
  { exam: 'NECO', route: '/neco-result', icon: BookOpenCheck },
  { exam: 'NABTEB', route: '/nabteb-result', icon: ScrollText },
] as const;

export default function ResultCheckersPage() {
  const nav = useNavigate();
  const [prices, setPrices] = useState<Price[]>([]);
  useEffect(() => { api.get<{ data: Price[] }>('/result/prices').then((r) => setPrices(r.data ?? [])).catch(() => setPrices([])); }, []);
  return <AppShell><button onClick={() => nav('/dashboard')} className="flex items-center gap-1.5 font-body text-sm text-ink-600"><ArrowLeft size={15} /> Dashboard</button><header className="mt-5 rounded-2xl border border-parchment-line bg-parchment p-6"><p className="font-body text-sm font-semibold text-gold-700">Education services</p><h1 className="mt-1 font-display text-3xl font-bold text-ink">Result Checkers</h1><p className="mt-2 font-body text-sm text-ink-600">Choose WAEC, NECO or NABTEB and see its current price.</p></header><div className="mt-6 grid gap-4 sm:grid-cols-3">{exams.map(({ exam, route, icon: Icon }) => { const price = prices.find((p) => p.service === `${exam}_PIN`); return <button key={exam} disabled={!price?.isActive} onClick={() => nav(route)} className="rounded-2xl border border-parchment-line bg-parchment p-5 text-left shadow-sm transition hover:-translate-y-1 disabled:opacity-50"><Icon size={28} className="text-gold-600" /><h2 className="mt-4 font-display text-xl font-bold text-ink">{exam}</h2><p className="mt-2 font-body text-sm text-ink-600">Result checker PIN</p><p className="mt-4 font-mono text-lg font-bold text-gold-700">{price ? `₦${Number(price.unitPrice).toLocaleString()}` : 'Loading…'}</p></button>; })}</div></AppShell>;
}
