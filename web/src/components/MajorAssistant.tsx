import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Bot, Send, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { PinConfirmDialog } from './PinConfirmDialog';

type Language = 'choose' | 'ha' | 'en';
type Task = 'choose' | 'data' | 'airtime' | 'fund' | 'generic';
type Receipt = { title: string; amount: number; reference: string; status: 'success' | 'failed'; details: [string, string][] };
type Message = { text: string; user?: boolean; options?: string[]; receipt?: Receipt };
type Plan = { id?: string; plan_id?: string; name?: string; size?: string; price?: number; amount?: number };
// Mirrors AssistantField/AssistantWorkflow in the backend's
// assistant-workflow.service.ts - one config drives result checker PIN and
// every NIN/BVN verification service, so a new service needs no new stage.
type WorkflowFieldOption = { value: string; label: string; labelHa: string };
type WorkflowField = { key: string; label: string; labelHa: string; required: boolean; input: string; options?: WorkflowFieldOption[] };
type Workflow = { id: string; title: string; titleHa: string; fields: WorkflowField[]; purchaseEndpoint?: string; submitEndpoint?: string; statusEndpoint?: string; async: boolean; priceMode: 'result' | 'verification' | 'none'; priceServiceKeyTemplate?: string; priceValueMap?: Record<string, Record<string, string>>; status: 'active' | 'guided' };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
const networks = ['MTN', 'AIRTEL', 'GLO', '9MOBILE'];
// Word-boundary safe (unlike a plain .includes(), which let 'corporate'
// misfire inside "incorporated" etc - same bug class already fixed on the
// backend's assistant-workflow.service.ts).
function parseDataType(lower: string): string {
  if (/\bcorporate\b/.test(lower)) return 'CORPORATE';
  if (/\bshare\b|\bdata\s*share\b/.test(lower)) return 'DATA SHARE';
  if (/\bgift(ing)?\b/.test(lower)) return 'GIFTING';
  if (/\bsme\s*2\b|\bsme2\b/.test(lower)) return 'SME2';
  if (/\bcoupon\b/.test(lower)) return 'DATA COUPON';
  if (/\bsme\b/.test(lower)) return 'SME';
  return '';
}
function planLabel(p: Plan): string {
  const name = p.name ?? p.size ?? '';
  const price = Number(p.price ?? p.amount ?? 0);
  const validity = (p as { validity?: string }).validity;
  const validityPart = validity && validity !== 'Validity varies' ? ` (${validity})` : '';
  return `${name} — ₦${price.toLocaleString()}${validityPart}`;
}

export default function MajorAssistant() {
  const [open, setOpen] = useState(false); const [language, setLanguage] = useState<Language>('choose'); const [task, setTask] = useState<Task>('choose'); const [stage, setStage] = useState<'language'|'task'|'network'|'dataType'|'phone'|'plan'|'amount'|'review'|'genericField'|'genericReview'|'done'>('language');
  const [workflows, setWorkflows] = useState<Workflow[]>([]); const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null); const [collected, setCollected] = useState<Record<string, unknown>>({}); const [fieldIndex, setFieldIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([{ text: 'Sannu! Welcome to MARIA AI Assistant.\nChoose a language / Zaɓi yare:', options: ['Hausa', 'English'] }]); const [text, setText] = useState(''); const [network, setNetwork] = useState(''); const [phone, setPhone] = useState(''); const [plans, setPlans] = useState<Plan[]>([]); const [plan, setPlan] = useState<Plan | null>(null); const [amount, setAmount] = useState(0); const [pinOpen, setPinOpen] = useState(false); const [busy, setBusy] = useState(false); const [listening, setListening] = useState(false); const [fabPosition, setFabPosition] = useState({ x: Math.max(16, window.innerWidth - 150), y: Math.max(16, window.innerHeight - 80) }); const inputRef = useRef<HTMLInputElement>(null); const genericPriceRef = useRef(0);
  const [dataType, setDataType] = useState('');
  const ha = language === 'ha'; const tr = (en: string, h: string) => ha ? h : en;
  useEffect(() => { inputRef.current?.focus(); }, [stage, open]);
  useEffect(() => { if (open) { const panels = document.querySelectorAll<HTMLElement>('.overflow-y-auto'); const panel = panels[panels.length - 1]; panel?.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' }); } }, [messages, busy, open]);
  function moveFab(event: PointerEvent<HTMLButtonElement>) { const button = event.currentTarget; button.setPointerCapture(event.pointerId); const move = (e: globalThis.PointerEvent) => setFabPosition({ x: Math.max(8, Math.min(window.innerWidth - 130, e.clientX - 55)), y: Math.max(8, Math.min(window.innerHeight - 55, e.clientY - 25)) }); const stop = () => { button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', stop); }; button.addEventListener('pointermove', move); button.addEventListener('pointerup', stop); }
  const add = (message: Message) => setMessages(prev => [...prev, message]);
  function startVoice() { const Recognition = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition; if (!Recognition) { add({ text: tr('Voice input is not supported in this browser. You can type instead.', 'Wannan browser bai goyi bayan voice input ba. Rubuta saƙonka.') }); return; } const recognition = new Recognition(); recognition.lang = ha ? 'ha-NG' : 'en-NG'; recognition.interimResults = false; recognition.onresult = (event) => { const spoken = event.results[0][0].transcript; setText(spoken); void answer(spoken); }; recognition.onerror = () => setListening(false); recognition.onend = () => setListening(false); setListening(true); recognition.start(); }
  const reset = () => { setTask('choose'); setNetwork(''); setDataType(''); setPhone(''); setPlan(null); setPlans([]); setAmount(0); setActiveWorkflow(null); setCollected({}); setFieldIndex(0); setStage('task'); add({ text: tr('What else can I help you with?', 'Me kuma zan taimaka maka da shi?'), options: [tr('Buy Data','Siyan Data'), tr('Buy Airtime','Siyan Airtime'), tr('Result Checker PIN','Result Checker PIN'), tr('NIN / BVN Verification','NIN / BVN Verification')] }); };
  // "Why did my transaction fail?" - a safe, non-technical explanation
  // built from GET /assistant/last-transaction, which deliberately never
  // returns provider/technical detail (see that endpoint's doc-comment in
  // the backend's assistant.routes.ts). Checked at the top of answer(), so
  // it works from any stage, not just at the initial greeting.
  async function explainLastTransaction() {
    setBusy(true);
    try {
      const res = await api.get<{ data?: { found?: boolean; status?: string; description?: string; amount?: number } }>('/assistant/last-transaction');
      const data = res.data;
      if (!data?.found) { add({ text: tr("You don't have any transactions yet.", 'Ba ka da wata transaction tukuna.') }); return; }
      const amountText = `₦${Number(data.amount ?? 0).toLocaleString()}`;
      const description = data.description ?? tr('your last transaction', 'transaction ɗinka na ƙarshe');
      if (data.status === 'success') {
        add({ text: tr(`${description} (${amountText}) was successful.`, `${description} (${amountText}) ta yi nasara.`) });
      } else if (data.status === 'pending') {
        add({ text: tr(`${description} (${amountText}) is still processing. This usually finishes within a few minutes - if it has taken longer, tap below to talk to a human.`, `${description} (${amountText}) tana ci gaba da aiki. Yawanci takan ƙare cikin ƴan mintuna - idan ta ɗauki lokaci mai tsawo, danna ƙasa don magana da mutum.`), options: [tr('Talk to a human', 'Magana da mutum')] });
      } else if (data.status === 'failed') {
        add({ text: tr(`${description} (${amountText}) did not go through. If your wallet was debited, it should be refunded automatically - if you do not see that reflected, let us connect you to support.`, `${description} (${amountText}) bata yi nasara ba. Idan an cire kuɗi daga wallet ɗinka, ya kamata a mayar maka kai tsaye - idan ba ka gani ba, bari mu haɗa ka da support.`), options: [tr('Talk to a human', 'Magana da mutum')] });
      } else if (data.status === 'reversed') {
        add({ text: tr(`${description} (${amountText}) did not go through, and was refunded back to your wallet.`, `${description} (${amountText}) bata yi nasara ba, kuma an mayar da kuɗin zuwa wallet ɗinka.`) });
      } else {
        add({ text: tr(`${description} (${amountText}) - status: ${data.status}.`, `${description} (${amountText}) - matsayi: ${data.status}.`) });
      }
    } catch { add({ text: tr('I could not check your last transaction right now. Please try again shortly.', 'Ban iya duba transaction ɗinka na ƙarshe yanzu ba. Sake gwadawa ba da daɗewa ba.') }); } finally { setBusy(false); }
  }
  async function ensureWorkflows(): Promise<Workflow[]> { if (workflows.length) return workflows; try { const res = await api.get<{ data?: Workflow[] }>('/assistant/workflows'); const list = res.data ?? []; setWorkflows(list); return list; } catch { return []; } }
  // Server-declared paths already include the "/api" prefix that api.get/post
  // add themselves (see lib/api.ts's `${API_BASE}/api${path}`), so strip it.
  const stripApiPrefix = (p: string) => p.replace(/^\/api/, '');
  async function answer(raw: string) {
    const value = raw.trim(); if (!value || busy) return; setText(''); add({ text: value, user: true }); const lower = value.toLowerCase();
    if (/(human|support|agent|live chat|ma'aikaci|mutum)/.test(lower)) { await handoff('Customer requested human support'); return; }
    if (/^(help|what can you do|what services|which services|list services|services|menu|options?)\??$|(ayyukan?\s*(da\s*)?ku(ke)?\s*(bayarwa|yi)|wace\s*sabis|wane\s*sabis|me\s*(za\s*ka|kuke)\s*iya\s*(yi|taimaka)|taimako\??$)/.test(lower)) {
      const list = await ensureWorkflows();
      if (list.length === 0) { await handoff('Customer asked for service list, catalog unavailable'); return; }
      const names = list.filter((w) => w.status === 'active').map((w) => `• ${tr(w.title, w.titleHa)}`).join('\n');
      add({ text: tr(`Here's what I can help you do right now:\n\n${names}\n\nJust tell me what you need - e.g. "buy 1GB MTN data" - and I'll take it from there.`, `Ga abubuwan da zan iya taimaka maka da su yanzu:\n\n${names}\n\nKawai gaya mini abin da kake bukata - misali "siyamin 1GB na MTN" - zan ci gaba daga nan.`) });
      return;
    }
    if (/(why.*(fail|failed|not work|didn.?t work)|transaction.*(fail|status)|me\s*yasa.*(gaza|kasa|bai\s*yi\s*ba|bai\s*shiga\s*ba)|ban\s*samu\s*ba|ban\s*same\s*ba)/.test(lower)) { await explainLastTransaction(); return; }
    const mentionedNetwork = networks.find((item) => new RegExp(`(?<![a-z0-9])${item.toLowerCase()}(?![a-z0-9])`).test(lower));
    if (mentionedNetwork && network && mentionedNetwork !== network && stage !== 'language' && stage !== 'task') { setNetwork(mentionedNetwork); setDataType(''); setPlans([]); setPlan(null); setStage(task === 'data' ? 'dataType' : 'phone'); add({ text: tr(`Okay, I changed the network from ${network} to ${mentionedNetwork}. Let us continue.`, `To, na canza network daga ${network} zuwa ${mentionedNetwork}. Mu ci gaba.`), options: task === 'data' ? ['Corporate','Data Share','Gifting','SME','SME 2','Data Coupon'] : undefined }); return; }
    if (stage === 'language') { const isHa = lower.includes('hausa'); setLanguage(isHa ? 'ha' : 'en'); setStage('task'); add({ text: isHa ? 'Me kake so in taimaka maka da shi?' : 'What would you like to do?', options: isHa ? ['Siyan Data','Siyan Airtime','Cika Wallet','Result Checker PIN','NIN / BVN Verification'] : ['Buy Data','Buy Airtime','Fund Wallet','Result Checker PIN','NIN / BVN Verification'] }); return; }
    if (stage === 'task' && /(fund|top ?up|wallet|cika wallet|saka kudi|add money|deposit)/.test(lower)) { setTask('fund'); setStage('amount'); add({ text: tr('How much would you like to add to your wallet?', 'Nawa kake so ka saka a wallet ɗinka?') }); return; }
    if (stage === 'task') {
      type Parsed = { data?: { workflow?: string; fields?: { network?: string; data_type?: string; phone?: string; data_size?: string; amount?: number } } };
      let parsed: Parsed | null = null;
      if (/(last|saved|previous|karshe|ajiye)/.test(lower)) {
        try {
          const saved = await api.get<{ data?: Array<{ phone: string; network?: string; type: string }> }>('/assistant/beneficiaries');
          const wanted = lower.includes('data') ? 'data' : lower.includes('airtime') ? 'airtime' : undefined;
          const recipient = (saved.data ?? []).find((item) => !wanted || item.type === wanted);
          if (!recipient) { add({ text: tr('I could not find a saved recipient yet. Please provide the phone number.', 'Ban samu saved recipient ba tukuna. Don Allah rubuta lambar waya.') }); setStage('phone'); return; }
          parsed = { data: { workflow: recipient.type, fields: { phone: recipient.phone, network: recipient.network } } };
          add({ text: tr(`I found ${recipient.phone}${recipient.network ? ` on ${recipient.network}` : ''} as your recent recipient.`, `Na samu ${recipient.phone}${recipient.network ? ` na ${recipient.network}` : ''} a recent recipients.`) });
        } catch { add({ text: tr('I could not load saved recipients. Please provide the phone number.', 'Ba a iya ɗauko saved recipients ba. Rubuta lambar waya.') }); setStage('phone'); return; }
      } else { try { parsed = await api.post<Parsed>('/assistant/parse', { message: value }); } catch { /* retain the local fallback below */ } }
      void audit({ stage: 'intent', outcome: 'waiting' });
      const fields = parsed?.data?.fields ?? {}; const parsedWorkflow = parsed?.data?.workflow;
      if (parsedWorkflow && parsedWorkflow !== 'data' && parsedWorkflow !== 'airtime') {
        const list = await ensureWorkflows();
        const match = list.find((w) => w.id === parsedWorkflow);
        if (match && match.status === 'active') { await startGenericWorkflow(match); return; }
        add({ text: tr('That service is recognised, but its secure purchase workflow is not active yet. I can connect you to support.', 'Na gane wannan sabis, amma workflow ɗinsa bai fara aiki ba. Zan haɗa ka da support yanzu.'), options: [tr('Talk to support','Yi magana da support')] });
        return;
      }
      const next: 'data' | 'airtime' = parsedWorkflow === 'data' ? 'data' : parsedWorkflow === 'airtime' ? 'airtime' : lower.includes('data') ? 'data' : 'airtime';
      setTask(next); if (!fields.network) { setStage('network'); add({ text: tr('Which network: MTN, Airtel, Glo or 9mobile?', 'Wanne layi/network: MTN, Airtel, Glo ko 9mobile?'), options: ['MTN','Airtel','Glo','9mobile'] }); return; }
      setNetwork(fields.network); if (next === 'data' && !fields.data_type) { setStage('dataType'); add({ text: tr('Which data type: Corporate, Data Share, Gifting, SME, SME 2 or Data Coupon?', 'Wanne nau’in Data: Corporate, Data Share, Gifting, SME, SME 2 ko Data Coupon?'), options: ['Corporate','Data Share','Gifting','SME','SME 2','Data Coupon'] }); return; }
      setDataType(fields.data_type ?? ''); if (!fields.phone) { setStage('phone'); add({ text: tr('Enter the 11-digit Nigerian phone number.', 'Rubuta lambar Najeriya mai digit 11.') }); return; }
      setPhone(fields.phone); if (next === 'airtime') { if (!fields.amount) { setStage('amount'); add({ text: tr('How much airtime should I buy? (minimum ₦50)', 'Nawa zan saya na airtime? (daga ₦50)') }); return; } setAmount(fields.amount); setStage('review'); await review(null, fields.amount); return; }
      setDataType(fields.data_type ?? '');
      setBusy(true); try { const response = await api.get<{data?: Plan[]}>(`/data/plans/${fields.network}?category=${encodeURIComponent(fields.data_type ?? '')}`); const list = response.data ?? []; setPlans(list); const selected = fields.data_size ? list.find(p => `${p.name ?? ''} ${p.size ?? ''}`.replace(/\s/g,'').toLowerCase().includes(fields.data_size!.toLowerCase())) : undefined; if (selected) { const price = Number(selected.price ?? selected.amount ?? 0); setPlan(selected); setAmount(price); setStage('review'); await review(selected, price); } else { setStage('plan'); add({ text: tr(`Choose a plan (${list.length} available):`, `Zaɓi data plan (${list.length} suna akwai):`), options: list.map(p => `${p.name ?? p.size} — ₦${Number(p.price ?? p.amount ?? 0).toLocaleString()}`) }); } } catch { add({ text: tr('I could not load plans. Please try again.', 'Ba a iya ɗauko plan ba. Sake gwadawa.') }); } finally { setBusy(false); } return;
    }
    if (stage === 'dataType') { const type = parseDataType(lower); if (!type) { add({ text: tr('Please choose a data type from the buttons.', 'Zaɓi nau’in Data daga maɓallan.') }); return; } setDataType(type); setStage('phone'); add({ text: tr('Enter the 11-digit Nigerian phone number.', 'Rubuta lambar Najeriya mai digit 11.') }); return; }
    if (stage === 'network') { const n = networks.find(x => new RegExp(`(?<![a-z0-9])${x.toLowerCase()}(?![a-z0-9])`).test(lower)) ?? (/\bnine\s*mobile\b|\betisalat\b/.test(lower) ? '9MOBILE' : undefined); if (!n) { add({ text: tr('Please choose MTN, Airtel, Glo or 9mobile.', 'Don Allah zaɓi MTN, Airtel, Glo ko 9mobile.') }); return; } setNetwork(n); setStage(task === 'data' ? 'dataType' : 'phone'); add({ text: task === 'data' ? tr('Which data type: Corporate, Data Share, Gifting, SME, SME 2 or Data Coupon?', 'Wanne nau’in Data: Corporate, Data Share, Gifting, SME, SME 2 ko Data Coupon?') : tr('Enter the 11-digit Nigerian phone number.', 'Rubuta lambar Najeriya mai digit 11.'), options: task === 'data' ? ['Corporate','Data Share','Gifting','SME','SME 2','Data Coupon'] : [] }); return; }
    if (stage === 'phone') { const p = value.replace(/\D/g,''); if (p.length !== 11 || !p.startsWith('0')) { add({ text: tr('Please enter a valid 11-digit Nigerian number.', 'Don Allah rubuta lamba mai digit 11.') }); return; } setPhone(p); if (task === 'airtime') { setStage('amount'); add({ text: tr('How much airtime should I buy? (minimum ₦50)', 'Nawa zan saya na airtime? (daga ₦50)') }); return; } setBusy(true); try { const response = await api.get<{data?: Plan[]}>(`/data/plans/${network}?category=${encodeURIComponent(dataType)}`); const list = [...(response.data ?? [])].sort((a, b) => Number(a.price ?? a.amount ?? 0) - Number(b.price ?? b.amount ?? 0)); setPlans(list); setStage('plan'); add({ text: tr(`Choose a plan (${list.length} available, cheapest first) - or just say "cheapest":`, `Zaɓi data plan (${list.length} suna akwai, mafi rahusa da farko) - ko ka ce "mafi rahusa":`), options: list.map(planLabel) }); } catch { add({ text: tr('I could not load plans. Please try again.', 'Ba a iya ɗauko plan ba. Sake gwadawa.') }); } finally { setBusy(false); } return; }
    if (stage === 'plan') {
      const clean = (input: string) => input.toLowerCase().replace(/[^a-z0-9.]/g, '');
      // "Which one is cheapest/simplest?" - answered directly instead of
      // making the customer name a specific plan; `plans` is already
      // sorted cheapest-first above.
      const wantsCheapest = /(cheap|lowest|affordable|simple|easiest|best|rahusa|sauki|mafi)/.test(lower);
      const found = (wantsCheapest ? plans[0] : undefined)
        ?? plans.find((p) => clean(planLabel(p)) === clean(value))
        ?? plans.find((p) => { const price = Number(p.price ?? p.amount ?? 0); return price > 0 && value.replace(/[^0-9]/g, '') === String(Math.round(price)); })
        ?? (plans.length === 1 ? plans[0] : undefined);
      if (!found) { add({ text: tr('I could not match that to a plan - tap one of the buttons above, tell me the size (e.g. "1GB"), or say "cheapest".', 'Ban gane ba - danna ɗaya daga maɓallan, ko faɗa girman (misali "1GB"), ko ka ce "mafi rahusa".') }); return; }
      setPlan(found); setAmount(Number(found.price ?? found.amount ?? 0)); setStage('review'); await review(found, Number(found.price ?? found.amount ?? 0)); return;
    }
    if (stage === 'amount') { const a = Number(value.replace(/[^0-9.]/g,'')); if (!Number.isFinite(a) || a < 50) { add({ text: tr('Enter ₦50 or more.', 'Rubuta ₦50 ko fiye.') }); return; } if (task === 'fund') { add({ text: tr(`I will take you to secure wallet funding for ₦${a.toLocaleString()}. Your card/bank details and PIN must only be entered on the secure payment page.`, `Zan kai ka secure funding page na ₦${a.toLocaleString()}. Kada ka rubuta card/bank details ko PIN a chat.`), options: [tr('Continue to funding','Ci gaba zuwa funding'), tr('Start again','Fara kuma')] }); setAmount(a); setStage('review'); return; } setAmount(a); setStage('review'); await review(null, a); return; }
    if (stage === 'review') { if (task === 'fund' && /(continue|ci gaba|yes|eh|confirm)/.test(lower)) { window.location.assign(`/fund-wallet?amount=${encodeURIComponent(amount)}`); return; } if (/(yes|eh|confirm)/.test(lower)) setPinOpen(true); else reset(); return; }
    if (stage === 'genericField') { await handleGenericFieldAnswer(value, lower); return; }
    if (stage === 'genericReview') { if (/(yes|eh|confirm)/.test(lower)) setPinOpen(true); else reset(); return; }
  }
  async function handoff(reason: string) { try { const result = await api.post<{data?: {ticket_id?: string}}>('/assistant/fallback', { reason, stage }); add({ text: tr(`I’ve connected this to human support. Ticket: ${result.data?.ticket_id ?? 'created'}.`, `Na haɗa wannan da human support. Ticket: ${result.data?.ticket_id ?? 'an ƙirƙira'}.`) }); } catch { add({ text: tr('Support handoff is temporarily unavailable. Please open Support from your account menu.', 'Ba a samu support handoff yanzu ba. Buɗe Support daga account menu.') }); } }
  async function review(selectedPlan: Plan | null, price: number) { try { const wallet = await api.get<{balance?: number; data?: {balance?:number}}>('/wallet/balance'); const balance = Number(wallet.balance ?? wallet.data?.balance ?? 0); if (balance < price) { add({ text: tr(`Your wallet balance is ₦${balance.toLocaleString()}, but this needs ₦${price.toLocaleString()}. Fund wallet first.`, `Wallet ɗinka yana da ₦${balance.toLocaleString()}, amma wannan na bukatar ₦${price.toLocaleString()}. Cika wallet farko.`) }); reset(); return; } const item = task === 'data' ? (selectedPlan ? planLabel(selectedPlan) : 'data') : tr('airtime','airtime'); add({ text: tr(`Summary: ${item} on ${network} for ${phone} — ₦${price.toLocaleString()}. Wallet: ₦${balance.toLocaleString()}. Proceed?`, `Takaitawa: ${item} na ${network} zuwa ${phone} — ₦${price.toLocaleString()}. Wallet: ₦${balance.toLocaleString()}. A ci gaba?`), options: [tr('Yes, confirm','Eh, tabbatar'), tr('No, start again','A’a, a fara kuma')] }); } catch { add({ text: tr('I could not check your wallet. I can connect you to support.', 'Ba a iya duba wallet ba. Zan haɗa ka da support.'), options: [tr('Talk to support','Yi magana da support')] }); } }
  async function audit(event: { stage: string; outcome: 'started'|'waiting'|'success'|'failed'|'fallback'|'cancelled'; error_code?: string; transaction_ref?: string }) { try { await api.post('/assistant/events', { intent: task, ...event }); } catch { /* observability must never block a customer */ } }
  async function startGenericWorkflow(workflow: Workflow) {
    setTask('generic'); setActiveWorkflow(workflow); setCollected({}); setFieldIndex(0); setStage('genericField');
    await askNextGenericField(workflow, {}, 0);
  }
  async function askNextGenericField(workflow: Workflow, current: Record<string, unknown>, index: number) {
    let i = index;
    while (i < workflow.fields.length && Object.prototype.hasOwnProperty.call(current, workflow.fields[i].key)) i++;
    setFieldIndex(i);
    if (i >= workflow.fields.length) { await genericReview(workflow, current); return; }
    const field = workflow.fields[i]; const label = tr(field.label, field.labelHa); const optional = field.required === false;
    add({ text: optional ? `${label}\n${tr('(optional — reply "skip" to leave it out)', '(ba tilas ba — rubuta "skip" idan ba ka so)')}` : label, options: field.options ? field.options.map((o) => tr(o.label, o.labelHa)) : undefined });
  }
  async function handleGenericFieldAnswer(raw: string, lower: string) {
    if (!activeWorkflow) return;
    const field = activeWorkflow.fields[fieldIndex]; const required = field.required !== false;
    if (!required && (lower === 'skip' || lower === 'tsallake')) { await askNextGenericField(activeWorkflow, collected, fieldIndex + 1); return; }
    let error: string | null = null; let value: unknown;
    switch (field.input) {
      case 'phone': { const digits = raw.replace(/\D/g, ''); if (digits.length !== 11 || !digits.startsWith('0')) error = tr('Please enter a valid 11-digit Nigerian number.', 'Don Allah rubuta lamba mai digit 11.'); value = digits; break; }
      case 'nin': { const digits = raw.replace(/\D/g, ''); if (digits.length !== 11) error = tr('NIN must be exactly 11 digits.', 'NIN dole ya kasance digit 11.'); value = digits; break; }
      case 'bvn': { const digits = raw.replace(/\D/g, ''); if (digits.length !== 11) error = tr('BVN must be exactly 11 digits.', 'BVN dole ya kasance digit 11.'); value = digits; break; }
      case 'email': { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim())) error = tr('Please enter a valid email address.', 'Don Allah rubuta ingantaccen email.'); value = raw.trim(); break; }
      case 'quantity': { const q = Number(raw.trim()); if (!Number.isInteger(q) || q < 1 || q > 10) error = tr('Enter a quantity between 1 and 10.', 'Rubuta adadi tsakanin 1 zuwa 10.'); value = q; break; }
      case 'select': { const options = field.options ?? []; const match = options.find((o) => lower.includes(o.label.toLowerCase()) || lower.includes(o.value.toLowerCase()) || lower.includes(o.labelHa.toLowerCase())); if (!match) error = tr('Please choose one of the listed options.', 'Zaɓi ɗaya daga cikin zaɓuɓɓukan da aka jera.'); value = match?.value; break; }
      default: { if (!raw.trim()) error = tr('This cannot be empty. Please try again.', 'Wannan ba zai iya zama fanko ba. Sake gwadawa.'); value = raw.trim(); }
    }
    if (error) { add({ text: error }); return; }
    const nextCollected = { ...collected, [field.key]: value };
    setCollected(nextCollected);
    await askNextGenericField(activeWorkflow, nextCollected, fieldIndex + 1);
  }
  async function genericReview(workflow: Workflow, current: Record<string, unknown>) {
    setBusy(true);
    try {
      let unitPrice = 0;
      if (workflow.priceMode === 'result') {
        const exam = String(current.examType ?? '').toLowerCase();
        const res = await api.get<{ data?: { unitPrice?: number; unit_price?: number } }>(`/result/${exam}/price`);
        unitPrice = Number(res.data?.unitPrice ?? res.data?.unit_price ?? 0);
      } else if (workflow.priceMode === 'verification' && workflow.priceServiceKeyTemplate) {
        // A value with an entry in priceValueMap[field] substitutes that
        // exact suffix (e.g. NIN Validation's 'bank_validation' -> 'BANK',
        // not the naive uppercase 'BANK_VALIDATION'; a missing/skipped
        // optional field resolves via the '' entry). Any field without a
        // priceValueMap entry at all just gets upper-cased directly, same
        // as before.
        const key = workflow.priceServiceKeyTemplate.replace(/\{(\w+)\}/g, (_m, k: string) => {
          const raw = String(current[k] ?? '');
          const mapped = workflow.priceValueMap?.[k]?.[raw];
          return mapped ?? raw.toUpperCase();
        });
        const res = await api.get<{ data?: { service: string; unitPrice?: number; unit_price?: number }[] }>('/verification/prices');
        const row = (res.data ?? []).find((r) => r.service === key);
        unitPrice = row ? Number(row.unitPrice ?? row.unit_price ?? 0) : 0;
      }
      const quantity = typeof current.quantity === 'number' ? current.quantity : 1;
      const total = unitPrice * quantity;
      genericPriceRef.current = total;
      const wallet = await api.get<{ balance?: number; data?: { balance?: number } }>('/wallet/balance');
      const balance = Number(wallet.balance ?? wallet.data?.balance ?? 0);
      if (total > 0 && balance < total) {
        add({ text: tr(`Your wallet balance is ₦${balance.toLocaleString()}, but this needs ₦${total.toLocaleString()}. Please fund your wallet first.`, `Wallet ɗinka yana da ₦${balance.toLocaleString()}, amma wannan na bukatar ₦${total.toLocaleString()}. Cika wallet ɗin ka farko.`) });
        reset(); return;
      }
      const title = tr(workflow.title, workflow.titleHa);
      const summary = Object.entries(current).map(([k, v]) => `${k}: ${v}`).join('\n');
      add({
        text: total > 0
          ? tr(`Summary: ${title}\n${summary}\n\nPrice: ₦${total.toLocaleString()}. Wallet: ₦${balance.toLocaleString()}.\n\nProceed?`, `Takaitawa: ${title}\n${summary}\n\nKuɗi: ₦${total.toLocaleString()}. Wallet: ₦${balance.toLocaleString()}.\n\nA ci gaba?`)
          : tr(`Summary: ${title}\n${summary}\n\nProceed?`, `Takaitawa: ${title}\n${summary}\n\nA ci gaba?`),
        options: [tr('Yes, confirm', 'Eh, tabbatar'), tr('No, start again', 'A’a, a fara kuma')],
      });
      setStage('genericReview');
    } catch {
      add({ text: tr('I could not check pricing or your wallet right now. Please try again.', 'Ba a iya duba farashi ko wallet yanzu ba. Sake gwadawa.') });
      reset();
    } finally { setBusy(false); }
  }
  async function confirmGenericPurchase(pin: string) {
    setPinOpen(false);
    if (!activeWorkflow) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...collected, pin };
      delete body.examType;
      if (activeWorkflow.async && activeWorkflow.submitEndpoint) {
        const res = await api.post<{ status: boolean; data?: { ticket_id?: string } }>(stripApiPrefix(activeWorkflow.submitEndpoint), body);
        const ticketId = res.data?.ticket_id;
        void audit({ stage: 'submit', outcome: 'waiting', transaction_ref: ticketId });
        if (!ticketId) { add({ text: tr('Your request was submitted, but I could not track its status. Please check Transactions for updates.', 'An aika buƙatarka, amma ban iya bin diddigin matsayinta ba. Duba Transactions don sabuntawa.') }); reset(); return; }
        add({ text: tr(`Submitted! Reference: ${ticketId}. I will keep checking and let you know as soon as it is ready.`, `An aika! Reference: ${ticketId}. Zan cigaba da duba har sai ya shirya.`) });
        await pollGenericTicket(activeWorkflow.statusEndpoint ?? '', ticketId);
      } else if (activeWorkflow.purchaseEndpoint) {
        const endpoint = stripApiPrefix(activeWorkflow.purchaseEndpoint).replace(':examType', String(collected.examType ?? '').toLowerCase());
        const res = await api.post<{ status: boolean; message?: string; data?: { reference?: string; pin?: string; pdf_base64?: string; pdf_url?: string } }>(endpoint, body);
        void audit({ stage: 'purchase', outcome: res.status ? 'success' : 'failed', transaction_ref: res.data?.reference });
        const pdf = res.data?.pdf_base64?.replace(/^data:application\/pdf;base64,/i, '');
        if (res.status && pdf) { const link = document.createElement('a'); link.href = `data:application/pdf;base64,${pdf}`; link.download = `${res.data?.reference ?? 'verification-slip'}.pdf`; link.click(); }
        const delivery = res.data?.pin ? `\n\n${tr('Your PIN:', 'PIN ɗinka:')} ${res.data.pin}` : pdf ? `\n\n${tr('Your PDF download has started.', 'An fara sauke PDF ɗinka.')}` : '';
        add({ text: res.status ? `${tr(res.message ?? 'Your request was successful.', res.message ?? 'Buƙatarka ta yi nasara.')}${delivery}` : tr(`${res.message ?? 'Request failed.'} Your wallet has not been charged for a failed request.`, `${res.message ?? 'Ya gaza.'} Ba za a cire maka kuɗi ba idan ya gaza.`), receipt: res.status ? { title: tr(activeWorkflow.title, activeWorkflow.titleHa), amount: genericPriceRef.current, reference: res.data?.reference ?? '-', status: 'success', details: res.data?.pin ? [[tr('PIN','PIN'), res.data.pin]] : [] } : undefined });
        reset();
      }
    } catch (error) {
      void audit({ stage: 'purchase', outcome: 'failed', error_code: error instanceof ApiError ? error.code : 'PURCHASE_ERROR' });
      add({ text: error instanceof ApiError ? error.message : tr('Request failed. Please try again.', 'Ya gaza. Sake gwadawa.') });
    } finally { setBusy(false); }
  }
  async function pollGenericTicket(statusEndpointTemplate: string, ticketId: string) {
    const endpoint = stripApiPrefix(statusEndpointTemplate).replace(':ticketId', ticketId);
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      try {
        const res = await api.get<{ data?: { status?: string } }>(endpoint);
        const status = res.data?.status?.toLowerCase();
        if (status === 'success') { add({ text: tr(`Your request (${ticketId}) is complete.`, `Buƙatarka (${ticketId}) ta shirya.`), receipt: { title: tr(activeWorkflow?.title ?? 'Request', activeWorkflow?.titleHa ?? 'Buƙata'), amount: genericPriceRef.current, reference: ticketId, status: 'success', details: [] } }); reset(); return; }
        if (status === 'failed') { add({ text: tr(`Your request (${ticketId}) could not be completed. Any charge has been refunded — check Transactions, or contact support if unsure.`, `Ba a iya kammala buƙatar (${ticketId}) ba. An mayar da duk wani caji — duba Transactions, ko tuntuɓi support idan ba ka tabbata ba.`) }); reset(); return; }
        if (attempt === 4) add({ text: tr(`Still processing ${ticketId}… I will keep watching.`, `Ana ci gaba da aiwatar da ${ticketId}… Zan ci gaba da bibiya.`) });
      } catch { /* transient network hiccup — keep trying on the next interval */ }
    }
    add({ text: tr(`This is taking longer than usual. ${ticketId} is still processing — check Transactions for updates, or contact support.`, `Wannan yana ɗaukar lokaci fiye da yadda aka saba. ${ticketId} har yanzu ana aiwatar da shi — duba Transactions, ko tuntuɓi support.`) });
    reset();
  }
  async function purchase(pin: string) { setPinOpen(false); setBusy(true); try { const res = task === 'data' ? await api.post<{status:boolean;message?:string;data?:{reference?:string}}>('/data/purchase',{network,plan_id:plan?.id ?? plan?.plan_id,phone,amount,pin}) : await api.post<{status:boolean;message?:string;data?:{reference?:string}}>('/airtime/purchase',{network,phone,amount,pin}); void audit({ stage: 'purchase', outcome: res.status ? 'success' : 'failed', transaction_ref: res.data?.reference }); add({ text: res.status ? tr(res.message ?? 'Purchase complete.', res.message ?? 'An gama siya.') : tr(res.message ?? 'Purchase failed.', res.message ?? 'Siyan ta gaza.') }); } catch (error) { void audit({ stage: 'purchase', outcome: 'failed', error_code: error instanceof ApiError ? error.code : 'PURCHASE_ERROR' }); add({ text: error instanceof ApiError ? error.message : tr('Purchase failed. Please try again.','Siyan ta gaza. Sake gwadawa.') }); } finally { setBusy(false); reset(); } }
  return <><button aria-label="Open MARIA AI Assistant" onPointerDown={moveFab} onClick={()=>setOpen(true)} style={{ left: fabPosition.x, top: fabPosition.y, touchAction: 'none' }} className="fixed z-[60] flex items-center gap-2 rounded-full bg-brand-600 px-4 py-3 text-sm font-bold text-white shadow-2xl shadow-brand-900/40 transition hover:scale-105"><Sparkles size={18} className="animate-pulse"/> AI Help</button>{open && <section className="fixed bottom-4 right-4 z-50 flex h-[min(680px,calc(100vh-32px))] w-[min(410px,calc(100vw-32px))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"><header className="flex items-center justify-between bg-brand-700 px-4 py-4 text-white"><div className="flex items-center gap-2"><Bot/><div><b>MARIA AI Assistant</b><p className="text-xs text-white/75">Secure service guide</p></div></div><button onClick={()=>setOpen(false)} aria-label="Close assistant"><X/></button></header><div className="bg-brand-50 px-4 py-2 text-center text-[11px] text-brand-800">No external AI • PIN is never typed in chat</div><div className="flex-1 space-y-3 overflow-y-auto p-4">{messages.map((m,i)=><div key={i} className={m.user?'ml-10 text-right':'mr-6'}><div className={`inline-block whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${m.user?'bg-brand-600 text-white':'bg-slate-100 text-slate-800'}`}>{m.text}</div>{m.receipt && <ReceiptCard receipt={m.receipt} ha={ha} />}{m.options && <div className="mt-2 flex flex-wrap gap-2">{m.options.map(o=><button key={o} onClick={()=>answer(o)} className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">{o}</button>)}</div>}</div>)}</div>{busy && <div className="h-1 animate-pulse bg-brand-500"/>}<form onSubmit={e=>{e.preventDefault();answer(text)}} className="flex gap-2 border-t p-3"><button type="button" aria-label="Speak" onClick={startVoice} className={`rounded-xl p-2 ${listening?'bg-rose-100 text-rose-700':'bg-brand-50 text-brand-700'}`}>{listening ? '●' : '🎙️'}</button><input ref={inputRef} autoComplete="tel" inputMode={stage === 'phone' ? 'tel' : stage === 'amount' ? 'decimal' : 'text'} value={text} onChange={e=>setText(e.target.value)} placeholder={stage === 'phone' ? tr('Enter phone number…','Rubuta lambar waya…') : tr('Type your reply…','Rubuta amsarka…')} className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"/><button disabled={busy} className="rounded-xl bg-brand-600 p-2 text-white disabled:opacity-50"><Send size={18}/></button></form></section>}<PinConfirmDialog open={pinOpen} onClose={()=>setPinOpen(false)} onVerified={task === 'generic' ? confirmGenericPurchase : purchase}/></>;
}

// Shown instantly in the conversation the moment a purchase succeeds - the
// web equivalent of the Flutter app's _ReceiptCard (major_ai_assistant_screen.dart).
// No PDF/share here (browsers have no native share sheet the way the app
// does) - "Copy reference" covers the same "I need to prove this to someone"
// need well enough for the web surface.
function ReceiptCard({ receipt, ha }: { receipt: Receipt; ha: boolean }) {
  const ok = receipt.status === 'success';
  return <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex items-center gap-2">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{ok ? '✓' : '✕'}</span>
      <b className="text-sm text-slate-800">{receipt.title}</b>
    </div>
    <div className="mt-2 text-lg font-extrabold text-slate-900">₦{receipt.amount.toLocaleString()}</div>
    {receipt.details.map(([k, v]) => <div key={k} className="mt-1 flex justify-between text-xs"><span className="text-slate-500">{k}</span><span className="font-semibold text-slate-700">{v}</span></div>)}
    <div className="mt-1 flex justify-between text-xs"><span className="text-slate-500">{ha ? 'Lambar Reference' : 'Reference'}</span><span className="font-mono font-semibold text-slate-700">{receipt.reference}</span></div>
    <button onClick={() => navigator.clipboard.writeText(receipt.reference)} className="mt-2 w-full rounded-lg border border-brand-200 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">{ha ? 'Kwafi Reference' : 'Copy reference'}</button>
  </div>;
}

