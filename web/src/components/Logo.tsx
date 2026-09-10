export default function Logo({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img src="/branding/logo.jpg" alt="MARIA Digital Solutions" className="h-12 w-12 rounded-lg bg-white object-contain p-0.5" />
      <span
        className={`font-display text-lg font-bold tracking-tight ${
          dark ? 'text-cream' : 'text-ink'
        }`}
      >
        MARIA <span className="text-gold-500">Digital Solutions</span>
      </span>
    </div>
  );
}
