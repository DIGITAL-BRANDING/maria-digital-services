import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Bell, LayoutDashboard, LogOut, Menu, Smartphone, X, IdCard, Phone, BriefcaseBusiness, Fingerprint, ShieldCheck, CheckCircle2, MapPin, Search, Unlink, FilePenLine, Baby, Receipt, Newspaper, History, WalletCards, MessageCircle, BadgeCheck, Settings2, ChevronDown, Folder, PackageOpen } from 'lucide-react';
import Logo from './Logo';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import MajorAssistant from './MajorAssistant';
import NotificationPopup from './NotificationPopup';
import WhatsappFloat from './WhatsappFloat';

type Notice = { id: string; title: string; body: string; is_read: boolean; created_at: string };
const items = [
 ['Dashboard','/dashboard',LayoutDashboard],['NIN_Phone Verification','/nin',IdCard],['Phone Multiple','/phone',Phone],['CAC Services','/cac',BriefcaseBusiness],['BVN Verification','/bvn',Fingerprint],['BVN Licence Creation','/bvn-license',BadgeCheck],['BVN Modification','/bvn-modification',FilePenLine],['BVN CRM','/bvn-crm',Settings2],['IPE Clerance (Instant)','/ipe',ShieldCheck],['Validation','/validation',CheckCircle2],['Personalization','/tracking',MapPin],['BVN Retrieval','/bvn-ret',Search],['Self Service Unlink','/delink',Unlink],['NIN Modifications','/modification',FilePenLine],['Birth Attestation','/attestation',Baby],['TIN Certificate','/tin',Receipt],['Newspaper Publication','/newspaper',Newspaper],['Demographic Search','/demo',Search],['Service History','/verifications',History],['My Deliveries','/deliveries',PackageOpen],['Wallet Summary','/history',WalletCards],['Complaints & Support','/support',MessageCircle],
] as const;

const historyFolders = [['All Service History','/verifications'],['NIN Verification History','/verifications?group=NIN'],['BVN Verification History','/verifications?group=BVN'],['CAC History','/verifications?group=CAC'],['NIN Modification History','/verifications?group=NIN_MODIFICATION'],['BVN Modification History','/verifications?group=BVN_MODIFICATION'],['IPE & Validation History','/verifications?group=IPE'],['Other Services History','/verifications?group=OTHER']] as const;
function Sidebar({ close }: { close?: () => void }) {
  const { logout } = useAuth(); const nav = useNavigate();
  const [historyOpen, setHistoryOpen] = useState(false);
  return <aside className="premium-sidebar flex h-full w-64 flex-col px-3 py-5"><Link to="/dashboard" onClick={close} className="mb-8 px-3"><Logo dark /></Link><nav className="flex-1 space-y-1 overflow-y-auto">{items.map(([label,to,Icon]) => label === 'Service History' ? <div key={to}><button onClick={() => setHistoryOpen((open) => !open)} className="premium-nav-link flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold"><Icon size={17}/><span className="flex-1 text-left">Service History</span><ChevronDown size={15} className={historyOpen ? 'rotate-180' : ''}/></button>{historyOpen && <div className="ml-5 mt-1 space-y-1 border-l border-white/20 pl-2">{historyFolders.map(([name, path]) => <NavLink key={path} to={path} onClick={close} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/80 hover:bg-white/10"><Folder size={13}/>{name}</NavLink>)}</div>}</div> : <NavLink key={to} to={to} onClick={close} className={({isActive}) => `premium-nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${isActive ? 'is-active' : ''}`}><Icon size={17}/>{label}</NavLink>)}</nav><button onClick={() => { logout(); close?.(); nav('/login'); }} className="premium-logout flex items-center gap-3 px-3 py-4 text-sm font-semibold"><LogOut size={18}/>Logout</button></aside>;
}

function NotificationBell() {
  const [items, setItems] = useState<Notice[]>([]); const [open, setOpen] = useState(false);
  const load = () => api.get<{data?: Notice[]}>('/notifications?limit=10').then(r => setItems(r.data ?? [])).catch(() => {});
  useEffect(() => { load(); const timer = window.setInterval(load, 30000); return () => window.clearInterval(timer); }, []);
  const unread = items.filter(n => !n.is_read).length;
  async function toggle() { setOpen(v => !v); if (unread) { const ids = items.filter(n => !n.is_read).map(n => n.id); setItems(v => v.map(n => ({...n, is_read: true}))); await api.post('/notifications/read', {ids}).catch(() => {}); } }
  // Positioning note: the panel below is `fixed` to the viewport (not
  // `absolute` relative to this button's own tiny wrapper div) deliberately
  // - the bell sits inside the header's flex row next to other icons/text
  // ("Secure services"), so an `absolute right-0` here aligns to the edge
  // of the bell's own cramped wrapper rather than the actual screen edge,
  // leaving the panel shifted left with dashboard tiles visible peeking out
  // from behind its right edge on mobile. `fixed` + explicit
  // viewport-relative offsets sidesteps that entirely, and the backdrop
  // gives it a proper mobile sheet feel (tap outside to close) instead of
  // floating awkwardly over other content.
  return <div className="relative"><button onClick={toggle} aria-label="Open notifications" className="relative rounded-xl border border-parchment-line bg-parchment p-2 text-gold-700 hover:bg-gold-50"><Bell size={19}/>{unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-ember-500 px-1 text-center text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}</button>{open && <>
    <button aria-label="Close notifications backdrop" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-950/30" />
    <section className="fixed right-3 top-16 z-50 mt-2 flex max-h-[calc(100vh-100px)] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-parchment-line bg-white shadow-2xl"><header className="flex shrink-0 items-center justify-between border-b border-parchment-line px-4 py-3"><b className="text-sm text-ink">Recent notifications</b><button onClick={() => setOpen(false)} aria-label="Close notifications"><X size={17}/></button></header><div className="overflow-y-auto">{items.length ? items.map(n => <article key={n.id} className="border-b border-slate-100 px-4 py-3 last:border-0"><p className="text-sm font-bold text-ink">{n.title}</p><p className="mt-1 text-xs leading-5 text-ink-600">{n.body}</p><time className="mt-2 block text-[10px] text-slate-400">{new Date(n.created_at).toLocaleString()}</time></article>) : <p className="p-5 text-center text-sm text-ink-600">No notifications yet.</p>}</div></section>
  </>}</div>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth(); const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="min-h-screen bg-[#f5f7fb]"><div className="fixed inset-y-0 left-0 z-30 hidden lg:block"><Sidebar/></div><header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur lg:ml-64"><div className="flex h-16 items-center justify-between px-5"><button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-brand-700 lg:hidden"><Menu/></button><span className="hidden text-sm text-slate-500 sm:block">Welcome back, {user?.full_name?.split(' ')[0] ?? 'User'}</span><Link to="/dashboard" className="lg:hidden"><Logo/></Link><div className="flex items-center gap-3"><NotificationBell/><span className="flex items-center gap-2 text-sm font-medium text-slate-600"><Smartphone size={17} className="text-brand-600"/><span className="hidden sm:inline">Secure services</span></span></div></div></header>{mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-slate-950/35"/><div className="relative h-full"><button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 z-10 rounded-lg p-2"><X/></button><Sidebar close={() => setMobileOpen(false)}/></div></div>}<main className="px-5 py-7 lg:ml-64 lg:px-8">{children}</main><NotificationPopup/><MajorAssistant/><WhatsappFloat sidebarOffset/></div>;
}
