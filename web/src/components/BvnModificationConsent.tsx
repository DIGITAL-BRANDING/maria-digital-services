export function BvnModificationConsent({ open, onAgree, onClose }: { open: boolean; onAgree: () => void; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4">
      <section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="bg-sky-700 px-6 py-5 text-center text-xl font-bold text-white">Consent &amp; Authorization Agreement</header>
        <div className="overflow-y-auto p-6 text-sm leading-6 text-slate-700">
          <p>Read this carefully before requesting a BVN modification; if you can abide by these terms, click "I Agreed." If not, click "Not Agreed."</p>
          <ol className="mt-4 list-decimal space-y-3 pl-5">
            <li>I authorize this platform and its agents to access and use my personal data, including my BVN, to process and modify my BVN record as requested.</li>
            <li>I understand this platform is not affiliated with NIBSS or any bank, but I voluntarily authorize this platform and its trusted agents to help modify my BVN details on my behalf.</li>
            <li>Banks and NIBSS recommend modifications be done personally through an official channel. By using this platform, I voluntarily authorize the request to proceed on my behalf.</li>
            <li>I confirm that I am the BVN owner or have full consent and authorization from the BVN owner to act on their behalf.</li>
            <li>I agree to pay the fixed service fee and authorize the platform to use lawful methods necessary to complete the requested modification.</li>
            <li>Updates may reflect immediately in NIBSS records, but individual banks may delay synchronizing their own copy of your details.</li>
            <li>Wallet funds are non-withdrawable. Failed services are refunded to the wallet only.</li>
            <li>I will not submit the same request on another platform while it is being processed here.</li>
            <li>This agreement applies to all past, current, and future BVN modification requests submitted through this platform.</li>
            <li>If there is a delay, issue, or network failure on the bank/NIBSS side, I agree to wait until it is resolved and not submit duplicate requests.</li>
          </ol>
          <p className="mt-4 font-semibold">I agree to the terms above and authorize this platform to proceed with my BVN modification.</p>
        </div>
        <footer className="flex justify-center gap-3 border-t p-4">
          <button onClick={onClose} className="rounded-xl bg-rose-600 px-5 py-2.5 font-semibold text-white">
            Not Agreed
          </button>
          <button onClick={onAgree} className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white">
            I Agreed
          </button>
        </footer>
      </section>
    </div>
  );
}
