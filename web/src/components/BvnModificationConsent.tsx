import { AlertCircle, CheckCircle2, ShieldAlert, X } from 'lucide-react';

export function BvnModificationConsent({
  open,
  onAgree,
  onClose
}: {
  open: boolean;
  onAgree: () => void;
  onClose: () => void
}) {
  if (!open) return null;

  const termsGroups = [
    {
      title: "Authorization & Data Usage",
      icon: ShieldAlert,
      color: "from-blue-50 to-blue-100",
      borderColor: "border-blue-200",
      items: [
        "I authorize this platform and its agents to access and use my personal data, including my BVN, to process and modify my BVN record as requested.",
        "I understand this platform is not affiliated with NIBSS or any bank, but I voluntarily authorize this platform and its trusted agents to help modify my BVN details on my behalf."
      ]
    },
    {
      title: "Regulatory & Official Guidance",
      icon: AlertCircle,
      color: "from-amber-50 to-amber-100",
      borderColor: "border-amber-200",
      items: [
        "Banks and NIBSS recommend modifications be done personally through an official channel. By using this platform, I voluntarily authorize the request to proceed on my behalf.",
        "I confirm that I am the BVN owner or have full consent and authorization from the BVN owner to act on their behalf."
      ]
    },
    {
      title: "Payment & Processing",
      icon: CheckCircle2,
      color: "from-emerald-50 to-emerald-100",
      borderColor: "border-emerald-200",
      items: [
        "I agree to pay the fixed service fee and authorize the platform to use lawful methods necessary to complete the requested modification.",
        "Updates may reflect immediately in NIBSS records, but individual banks may delay synchronizing their own copy of your details."
      ]
    },
    {
      title: "Terms & Conditions",
      icon: ShieldAlert,
      color: "from-slate-50 to-slate-100",
      borderColor: "border-slate-200",
      items: [
        "Wallet funds are non-withdrawable. Failed services are refunded to the wallet only.",
        "I will not submit the same request on another platform while it is being processed here.",
        "This agreement applies to all past, current, and future BVN modification requests submitted through this platform.",
        "If there is a delay, issue, or network failure on the bank/NIBSS side, I agree to wait until it is resolved and not submit duplicate requests."
      ]
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <section className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <header className="relative bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-8 sm:px-8">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 sm:right-6 sm:top-6 p-2 hover:bg-blue-500/30 rounded-lg transition-colors"
          >
            <X size={24} className="text-white" />
          </button>

          <div className="flex items-start gap-3">
            <ShieldAlert size={32} className="text-blue-200 shrink-0 mt-1" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">
                Consent & Authorization
              </h1>
              <p className="text-blue-100 text-sm sm:text-base mt-2">
                Please review and accept the terms before proceeding
              </p>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1">
          <div className="p-6 sm:p-8 space-y-8">
            {/* Important Notice */}
            <div className="bg-gradient-to-r from-red-50 to-rose-50 border-l-4 border-rose-500 rounded-lg p-4 sm:p-5">
              <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                <span className="font-bold text-rose-700">⚠️ Important:</span> Read this carefully before requesting a BVN modification. This is a binding agreement.
              </p>
            </div>

            {/* Terms Groups */}
            {termsGroups.map((group, groupIdx) => {
              const Icon = group.icon;
              return (
                <div key={groupIdx} className="space-y-3">
                  <div className={`bg-gradient-to-r ${group.color} border ${group.borderColor} rounded-xl p-4`}>
                    <div className="flex items-center gap-3 mb-3">
                      <Icon size={20} className="shrink-0 text-slate-700" />
                      <h2 className="font-bold text-slate-900 text-base sm:text-lg">
                        {group.title}
                      </h2>
                    </div>
                    <ul className="space-y-2 ml-7">
                      {group.items.map((item, idx) => (
                        <li key={idx} className="flex gap-3">
                          <span className="text-slate-400 font-semibold text-sm shrink-0 mt-0.5">•</span>
                          <p className="text-slate-700 text-sm sm:text-base leading-relaxed">
                            {item}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}

            {/* Confirmation Message */}
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-4 sm:p-5">
              <p className="text-slate-800 font-semibold text-sm sm:text-base text-center">
                ✓ I understand and accept all terms and conditions above
              </p>
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <footer className="border-t border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 p-4 sm:p-6 flex gap-3 justify-center sm:justify-end">
          <button
            onClick={onClose}
            className="px-6 py-3 sm:px-8 rounded-lg font-semibold text-slate-700 bg-white border-2 border-slate-300 hover:bg-slate-50 transition-all duration-200 text-sm sm:text-base"
          >
            ← Decline
          </button>
          <button
            onClick={onAgree}
            className="px-6 py-3 sm:px-8 rounded-lg font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2 text-sm sm:text-base"
          >
            <CheckCircle2 size={20} />
            I Agree & Continue
          </button>
        </footer>
      </section>
    </div>
  );
}
