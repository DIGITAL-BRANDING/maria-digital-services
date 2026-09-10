import { useEffect, useState } from 'react';
import { Copy, Users, Wallet } from 'lucide-react';
import AppShell from '../components/AppShell';
import { api } from '../lib/api';

type ReferralStats = {
  referral_code: string;
  total_referrals: number;
  total_earned: number;
  pending_commission: number;
  paid_commission: number;
  commission_rate: number;
  referees: { name: string; joined_at: string; total_transactions: number; commission_earned: number }[];
};

export default function ReferralPage() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState('');
  useEffect(() => { api.get<{ data: ReferralStats }>('/referral/stats').then((r) => setStats(r.data)).catch(() => setMessage('Unable to load referral details.')); }, []);
  const link = `${window.location.origin}/register?ref=${stats?.referral_code ?? ''}`;
  function copy() { void navigator.clipboard.writeText(link); setMessage('Referral link copied.'); }
  async function withdraw() { try { await api.post('/referral/withdraw', { amount: Number(amount) }); setAmount(''); setMessage('Commission moved to your wallet.'); const r = await api.get<{ data: ReferralStats }>('/referral/stats'); setStats(r.data); } catch (e) { setMessage(e instanceof Error ? e.message : 'Withdrawal failed.'); } }
  return <AppShell><div className="max-w-4xl"><h1 className="font-display text-2xl font-bold text-ink">Referral earnings</h1><p className="mt-1 text-sm text-ink-600">Earn {((stats?.commission_rate ?? 0.01) * 100).toFixed(2)}% whenever someone you referred completes a purchase.</p><section className="mt-5 rounded-2xl bg-ink p-6 text-cream"><div className="flex items-center gap-3"><Users className="text-gold-400"/><div><p className="text-xs uppercase tracking-widest text-gold-400">Your referral link</p><p className="mt-1 break-all font-mono text-sm">{link}</p></div></div><button onClick={copy} className="mt-4 flex items-center gap-2 rounded-lg bg-gold-400 px-4 py-2 text-sm font-bold text-ink"><Copy size={15}/>Copy link</button></section><div className="mt-5 grid gap-3 sm:grid-cols-3">{[['Referrals', stats?.total_referrals ?? 0], ['Pending', `₦${(stats?.pending_commission ?? 0).toLocaleString()}`], ['Total earned', `₦${(stats?.total_earned ?? 0).toLocaleString()}`]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-parchment-line bg-parchment p-4"><p className="text-xs text-ink-600">{label}</p><p className="mt-1 font-display text-xl font-bold text-ink">{value}</p></div>)}</div><section className="mt-5 rounded-2xl border border-parchment-line bg-parchment p-5"><h2 className="font-display font-bold text-ink">Move earnings to wallet</h2><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount in ₦" className="rounded-lg border border-parchment-line bg-cream px-3 py-2 text-sm"/><button onClick={withdraw} disabled={!amount} className="flex items-center justify-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-ink disabled:opacity-50"><Wallet size={15}/>Withdraw</button></div></section>{message && <p className="mt-4 text-sm font-medium text-gold-700">{message}</p>}</div></AppShell>;
}
