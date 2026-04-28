'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const COMMON_LOCATIONS = [
  { code: 'us', label: 'United States' },
  { code: 'uk', label: 'United Kingdom' },
  { code: 'il', label: 'Israel' },
  { code: 'de', label: 'Germany' },
  { code: 'fr', label: 'France' },
  { code: 'es', label: 'Spain' },
  { code: 'nl', label: 'Netherlands' },
  { code: 'ca', label: 'Canada' },
  { code: 'au', label: 'Australia' },
  { code: 'in', label: 'India' },
  { code: 'br', label: 'Brazil' },
  { code: 'jp', label: 'Japan' },
];

export default function Home() {
  const router = useRouter();
  const [brandName, setBrandName] = useState('');
  const [location, setLocation] = useState('United States');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName.trim() || !location.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: brandName.trim(),
          location: location.trim(),
          recipientEmail: recipientEmail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || `Failed (${res.status})`);
      }
      const { auditId } = (await res.json()) as { auditId: string };
      router.push(`/audit/${auditId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start audit');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-slate-900">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-40 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 right-1/3 w-96 h-96 bg-emerald-500/8 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-cyan-300 text-xs font-mono uppercase tracking-wider mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Bright Data demo - Brighton SEO 2026
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-zinc-50 mb-4 tracking-tight">
            Competitive Visibility Audit
          </h1>
          <p className="text-lg text-zinc-400 max-w-xl mx-auto">
            Enter a brand and location. We discover the real site, ground keywords in what they actually do today, and audit the full competitive landscape with live Bright Data calls.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-500 mb-2">Brand name</label>
            <input
              type="text"
              required
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Bright Data"
              autoFocus
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-500 mb-2">Location / market</label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 focus:outline-none focus:border-cyan-500 transition-colors"
              >
                {COMMON_LOCATIONS.map((l) => (
                  <option key={l.code} value={l.label}>{l.label}</option>
                ))}
                <option value="">Other (type below)</option>
              </select>
              {!COMMON_LOCATIONS.some((l) => l.label === location) && (
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Country"
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-zinc-500 mb-2">Recipient email <span className="text-zinc-600 normal-case">(optional, can add later)</span></label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          {err && <div className="text-sm text-red-400">{err}</div>}

          <button
            type="submit"
            disabled={submitting || !brandName.trim() || !location.trim()}
            className="w-full px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-900 font-semibold rounded-lg transition-all"
          >
            {submitting ? 'Starting audit...' : 'Run audit'}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-zinc-600 font-mono">
          Powered by Bright Data SERP, Web Unlocker, and Web Scraper APIs
        </div>
      </div>
    </div>
  );
}
