'use client';

import { useState } from 'react';
import DemoBanner from '@/components/demo-banner';
import Twin from '@/components/twin';

export default function Home() {
  const [quota, setQuota] = useState<{ remaining: number; daily_limit: number } | null>(null);

  return (
    <main className="bg-atmosphere relative min-h-screen overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" />

      <DemoBanner quota={quota} />

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
        <header className="animate-rise mb-8 max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--copper)]">
            Portfolio demo
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[1.1] text-[var(--sand)] sm:text-5xl md:text-6xl">
            Vitor Alves
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--sand-muted)] sm:text-lg">
            Senior frontend engineer. This page is a live digital twin: persona, memory, and model
            wired through a small serverless AWS architecture.
          </p>
        </header>

        <div className="animate-rise-delay h-[min(680px,70vh)] flex-1">
          <Twin onQuotaChange={setQuota} />
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--sand-muted)]">
          <p>Next.js · Lambda · Bedrock · Terraform · CloudFront</p>
          <a
            href="https://github.com/vitoralves/twin"
            className="text-[var(--copper)] transition hover:text-[var(--sand)]"
            target="_blank"
            rel="noreferrer"
          >
            View source
          </a>
        </footer>
      </div>
    </main>
  );
}
