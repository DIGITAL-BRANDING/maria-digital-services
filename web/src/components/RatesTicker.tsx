const RATES = [
  { label: '1GB · MTN', price: '₦350', tag: 'SME' },
  { label: '2GB · Glo', price: '₦480', tag: 'Gifting' },
  { label: 'Airtime · Airtel', price: '2% off', tag: 'VTU' },
  { label: '5GB · 9mobile', price: '₦1,750', tag: 'Corporate' },
  { label: 'Electricity · IKEDC', price: 'Instant', tag: 'Bill' },
  { label: 'DStv · Compact', price: '₦19,000', tag: 'Cable' },
  { label: '1GB · MTN SME', price: '₦345', tag: 'SME' },
  { label: 'Airtime · Glo', price: '3% off', tag: 'VTU' },
];

function Row() {
  return (
    <div className="flex shrink-0 items-center">
      {RATES.map((r, i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-3 whitespace-nowrap">
          <span className="font-mono text-[11px] uppercase tracking-widest text-gold-500/70">
            {r.tag}
          </span>
          <span className="font-mono text-sm text-cream/90">{r.label}</span>
          <span className="font-mono text-sm font-semibold text-gold-400">{r.price}</span>
          <span className="text-ink-line select-none">•</span>
        </div>
      ))}
    </div>
  );
}

export default function RatesTicker() {
  return (
    <div className="ticker-row overflow-hidden border-y border-ink-line bg-ink py-1">
      <div className="ticker-track flex w-max">
        <Row />
        <Row />
      </div>
    </div>
  );
}
