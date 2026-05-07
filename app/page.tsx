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
    <div className="min-h-screen flex items-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-slate-900">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[40rem] h-[40rem] bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute top-1/3 -left-40 w-[40rem] h-[40rem] bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '11s' }} />
        <div className="absolute -bottom-40 right-1/3 w-[40rem] h-[40rem] bg-emerald-500/8 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '14s' }} />
      </div>

      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-cyan-300 text-xs font-mono uppercase tracking-wider mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Bright Data · Brighton SEO 2026 · Live demo
          </div>
          <h1 className="text-6xl md:text-7xl xl:text-8xl font-bold text-zinc-50 mb-6 tracking-tight leading-[0.95]">
            How visible is{' '}
            <span className="bg-gradient-to-r from-cyan-300 via-cyan-400 to-purple-400 bg-clip-text text-transparent">
              your brand?
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 max-w-2xl mx-auto leading-relaxed">
            Across <span className="text-cyan-300 font-semibold">Google</span>,{' '}
            <span className="text-cyan-300 font-semibold">ChatGPT</span>,{' '}
            <span className="text-cyan-300 font-semibold">Perplexity</span>,{' '}
            <span className="text-cyan-300 font-semibold">Grok</span> and{' '}
            <span className="text-cyan-300 font-semibold">Gemini</span>.
            <br />Live audit. ~3 minutes.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-8 max-w-2xl mx-auto">
          <Stat n="8" label="buyer-intent keywords" />
          <Stat n="5" label="ranked competitors" />
          <Stat n="4" label="AI engines queried" />
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-950/70 border border-zinc-800 rounded-2xl p-6 md:p-8 space-y-5 backdrop-blur-sm shadow-2xl">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Brand</label>
              <input
                type="text"
                required
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Linear, monday.com, your company..."
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 text-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Market</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4 text-xl text-zinc-100 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
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
                  className="mt-2 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-zinc-500 mb-2">
              Email me the report <span className="text-zinc-600 normal-case">(optional)</span>
            </label>
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
            className="w-full px-6 py-5 bg-gradient-to-r from-cyan-500 to-cyan-400 hover:from-cyan-400 hover:to-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-900 text-2xl font-bold rounded-xl transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-[1.01] active:scale-[0.99]"
          >
            {submitting ? 'Starting audit...' : 'Run my audit →'}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-zinc-600 font-mono uppercase tracking-wider">
          Powered by Bright Data SERP · Web Unlocker · AI Search APIs
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl px-4 py-4 text-center backdrop-blur-sm">
      <div className="text-3xl md:text-4xl font-bold bg-gradient-to-br from-cyan-300 to-purple-300 bg-clip-text text-transparent">{n}</div>
      <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 mt-1">{label}</div>
    </div>
  );
}
