'use client';

import { useState } from 'react';
import { Audit, DiscoveredBrand } from '@/lib/types';

interface Props {
  audit: Audit;
  onConfirm: (overrideUrl?: string) => Promise<void>;
}

export default function DiscoveryCard({ audit, onConfirm }: Props) {
  const [editing, setEditing] = useState(false);
  const [editedUrl, setEditedUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const brand = audit.brand;
  const discoveryStage = audit.stages.find((s) => s.id === 0);
  const isRunning = audit.status === 'discovering';
  const isAwaiting = audit.status === 'awaiting_confirmation';
  const isFailed = audit.status === 'failed' && discoveryStage?.status === 'failed';

  const handleConfirm = async (override?: string) => {
    setSubmitting(true);
    setErr(null);
    try {
      await onConfirm(override);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to continue');
      setSubmitting(false);
    }
  };

  if (isFailed) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
        <div className="text-red-300 font-medium mb-2">Brand discovery failed</div>
        <div className="text-sm text-red-200/80 mb-4">{discoveryStage?.error || audit.error || 'unknown error'}</div>
        <a href="/" className="inline-flex items-center text-sm text-cyan-400 hover:text-cyan-300">Try again</a>
      </div>
    );
  }

  if (isRunning || !brand) {
    return (
      <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" />
          <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
            Discovering {audit.input.brandName}
          </span>
        </div>
        <div className="text-zinc-300 text-sm">
          We are not asking the LLM what your company does. We are reading your actual site.
        </div>
        <div className="mt-4 text-xs text-zinc-500 font-mono">
          {discoveryStage?.subTasks.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-0.5">
              <span className={s.status === 'complete' ? 'text-emerald-400' : s.status === 'running' ? 'text-yellow-400' : s.status === 'failed' ? 'text-red-400' : 'text-zinc-600'}>
                {s.status === 'complete' ? '✓' : s.status === 'running' ? '●' : s.status === 'failed' ? '✗' : '·'}
              </span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isAwaiting) {
    const profile = brand.brandProfile;
    return (
      <div className="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-cyan-500/30 rounded-xl p-6">
        <div className="text-xs uppercase tracking-wider text-cyan-300 mb-2">We found you</div>
        <div className="flex items-center justify-between mb-4">
          <a href={brand.url} target="_blank" rel="noopener noreferrer" className="text-2xl font-semibold text-zinc-50 hover:text-cyan-300 transition-colors">
            {brand.domain}
          </a>
          <span className="text-xs text-zinc-500 font-mono">{brand.url}</span>
        </div>

        <div className="bg-zinc-950/40 rounded-lg p-4 mb-5 space-y-2 text-sm">
          <div><span className="text-zinc-500">Category:</span> <span className="text-zinc-200">{profile.category}</span></div>
          <div><span className="text-zinc-500">Value prop:</span> <span className="text-zinc-200">{profile.valueProp}</span></div>
          {profile.targetSegments.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-zinc-500 shrink-0">Segments:</span>
              <div className="flex flex-wrap gap-1.5">
                {profile.targetSegments.map((s, i) => (
                  <span key={i} className="text-xs bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-300">{s}</span>
                ))}
              </div>
            </div>
          )}
          {profile.keyFeatures.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-zinc-500 shrink-0">Features:</span>
              <div className="flex flex-wrap gap-1.5">
                {profile.keyFeatures.slice(0, 6).map((f, i) => (
                  <span key={i} className="text-xs bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-300">{f}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {err && <div className="mb-3 text-sm text-red-400">{err}</div>}

        {!editing ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleConfirm()}
              disabled={submitting}
              className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-zinc-900 font-semibold rounded-lg transition-colors"
            >
              {submitting ? 'Starting audit...' : 'This is us, continue'}
            </button>
            <button
              onClick={() => {
                setEditing(true);
                setEditedUrl(brand.url);
              }}
              disabled={submitting}
              className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-colors"
            >
              Not us, edit URL
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleConfirm(editedUrl.trim());
            }}
            className="flex gap-2"
          >
            <input
              type="url"
              required
              value={editedUrl}
              onChange={(e) => setEditedUrl(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 font-mono text-sm focus:outline-none focus:border-cyan-500"
              placeholder="https://"
              autoFocus
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-zinc-900 font-semibold rounded-lg transition-colors"
            >
              Use this URL
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    );
  }

  // Stage 0 already complete and pipeline running - render compact summary
  return (
    <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-zinc-100 font-medium">{brand.domain}</span>
          <span className="text-zinc-500 text-sm">- {brand.brandProfile.category}</span>
        </div>
        <a href={brand.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:text-cyan-300 font-mono">
          {brand.url}
        </a>
      </div>
    </div>
  );
}

export type { DiscoveredBrand };
