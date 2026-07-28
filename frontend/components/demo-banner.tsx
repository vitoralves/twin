'use client';

import { useEffect, useState } from 'react';

interface Quota {
  remaining: number;
  daily_limit: number;
}

export default function DemoBanner({
  quota,
}: {
  quota: Quota | null;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const stored = sessionStorage.getItem('twin-banner-dismissed');
    if (stored === '1') setVisible(false);
  }, []);

  if (!visible) return null;

  const remainingLabel =
    quota == null
      ? '5 shared messages / day'
      : `${quota.remaining} of ${quota.daily_limit} shared messages left today`;

  return (
    <div className="animate-rise border-b border-[var(--line)] bg-[rgba(208,138,74,0.12)] px-4 py-3 text-[var(--sand)]">
      <div className="mx-auto flex max-w-3xl items-start justify-between gap-4">
        <p className="text-sm leading-relaxed text-[var(--sand-muted)] sm:text-[15px]">
          This is a hands-on portfolio build: Next.js on CloudFront, a FastAPI twin on Lambda,
          Terraform for the stack, and Amazon Bedrock for the model. The demo shares a global
          daily chat budget ({remainingLabel}, UTC) so cloud spend stays intentional while you
          explore the architecture.
        </p>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem('twin-banner-dismissed', '1');
            setVisible(false);
          }}
          className="shrink-0 text-xs uppercase tracking-[0.14em] text-[var(--copper)] transition hover:text-[var(--sand)]"
          aria-label="Dismiss banner"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
