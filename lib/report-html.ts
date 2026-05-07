// =====================================================
// Report renderers - inline-styled HTML for email + plain text fallback.
// Used by /api/audit/[id]/email.
// =====================================================

import { AuditReport } from './types';

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function renderReportEmailHtml(report: AuditReport): string {
  const exec = report.executiveSummary;
  const competitorRows = report.competitors
    .map(
      (c) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#e4e4e7"><a href="https://${escape(c.domain)}" style="color:#22d3ee;text-decoration:none">${escape(c.domain)}</a></td><td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#a1a1aa">${c.appearanceCount} / ${report.keywords.length}</td><td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#a1a1aa">${avgRank(c.rankings)}</td></tr>`
    )
    .join('');

  const aiList = report.aiMentions
    .map(
      (m) => `
      <div style="margin-bottom:16px">
        <div style="font-weight:600;color:#fafafa;margin-bottom:6px">${escape(m.engine)} <span style="color:${m.status === 'success' ? '#22c55e' : '#ef4444'};font-weight:400;font-size:12px">(${escape(m.status)})</span></div>
        ${
          m.brandsMentioned.length
            ? `<div style="color:#a1a1aa;font-size:14px">${m.brandsMentioned
                .slice(0, 8)
                .map(
                  (b) =>
                    `<span style="display:inline-block;background:#1a1a1a;color:#d4d4d8;padding:3px 8px;border-radius:4px;margin:2px 4px 2px 0;font-size:12px">${escape(b.brand)} (${escape(b.sentiment)})</span>`
                )
                .join('')}</div>`
            : '<div style="color:#71717a;font-size:13px;font-style:italic">no brand mentions extracted</div>'
        }
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Competitive Visibility Audit - ${escape(report.brand.domain)}</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#e4e4e7">
  <div style="max-width:680px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;color:#71717a;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px">Competitive Visibility Audit</div>
    <h1 style="font-size:28px;font-weight:700;color:#fafafa;margin:0 0 8px">${escape(report.brand.domain)}</h1>
    <div style="color:#a1a1aa;font-size:15px;margin-bottom:24px">${escape(report.brand.brandProfile.category)} - ${escape(report.brand.brandProfile.valueProp)}</div>

    <div style="background:linear-gradient(135deg,rgba(6,182,212,0.08),rgba(139,92,246,0.08));border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:28px">
      <div style="font-size:12px;color:#22d3ee;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px">Headline</div>
      <div style="font-size:18px;color:#fafafa;font-weight:600;line-height:1.4;margin-bottom:12px">${escape(exec.headline)}</div>
      <div style="font-size:14px;color:#a1a1aa;font-style:italic;line-height:1.5">${escape(exec.narrativeArc)}</div>
    </div>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Key findings</h2>
    <ul style="margin:0;padding-left:20px;color:#d4d4d8;font-size:14px;line-height:1.6">
      ${exec.keyFindings.map((f) => `<li style="margin-bottom:6px">${escape(f)}</li>`).join('')}
    </ul>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Quick wins (under 30 days)</h2>
    <div style="color:#d4d4d8;font-size:14px;line-height:1.5">
      ${exec.quickWins
        .map(
          (r) => `<div style="margin-bottom:14px;padding:12px;background:rgba(16,185,129,0.06);border-left:3px solid #10b981;border-radius:4px"><div style="color:#fafafa;font-weight:600;margin-bottom:4px">${escape(r.action)}</div><div style="color:#a1a1aa;font-size:13px">${escape(r.rationale)}</div></div>`
        )
        .join('')}
    </div>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Strategic plays (1-3 quarters)</h2>
    <div style="color:#d4d4d8;font-size:14px;line-height:1.5">
      ${exec.strategicPlays
        .map(
          (r) => `<div style="margin-bottom:14px;padding:12px;background:rgba(99,102,241,0.06);border-left:3px solid #6366f1;border-radius:4px"><div style="color:#fafafa;font-weight:600;margin-bottom:4px">${escape(r.action)}</div><div style="color:#a1a1aa;font-size:13px">${escape(r.rationale)}</div></div>`
        )
        .join('')}
    </div>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Top competitors (by SERP frequency)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr><th style="text-align:left;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Domain</th><th style="text-align:left;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Appearances</th><th style="text-align:left;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Avg rank</th></tr></thead>
      <tbody>${competitorRows}</tbody>
    </table>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">AI engine mentions</h2>
    ${aiList}
${renderCitationsHtml(report)}
    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Keywords audited</h2>
    <div style="color:#a1a1aa;font-size:13px;line-height:1.8">${report.keywords.map((k) => `<span style="display:inline-block;background:#1a1a1a;padding:3px 10px;border-radius:14px;margin:3px;color:#d4d4d8">${escape(k)}</span>`).join('')}</div>

    <div style="margin-top:36px;padding-top:20px;border-top:1px solid #27272a;color:#71717a;font-size:12px;text-align:center">
      Audit powered by Bright Data SERP, Web Unlocker, and Web Scraper APIs.
    </div>
  </div>
</body></html>`;
}

export function renderReportEmailText(report: AuditReport): string {
  const exec = report.executiveSummary;
  const lines = [
    `COMPETITIVE VISIBILITY AUDIT`,
    `${report.brand.domain}`,
    `${report.brand.brandProfile.category} - ${report.brand.brandProfile.valueProp}`,
    ``,
    `HEADLINE`,
    exec.headline,
    ``,
    `THE STORY`,
    exec.narrativeArc,
    ``,
    `KEY FINDINGS`,
    ...exec.keyFindings.map((f) => `  - ${f}`),
    ``,
    `QUICK WINS (under 30 days)`,
    ...exec.quickWins.flatMap((r) => [`  > ${r.action}`, `    why: ${r.rationale}`]),
    ``,
    `STRATEGIC PLAYS (1-3 quarters)`,
    ...exec.strategicPlays.flatMap((r) => [`  > ${r.action}`, `    why: ${r.rationale}`]),
    ``,
    `TOP COMPETITORS`,
    ...report.competitors.map(
      (c) => `  ${c.domain} - ${c.appearanceCount}/${report.keywords.length} keyword SERPs (avg rank ${avgRank(c.rankings)})`
    ),
    ``,
    `AI ENGINE MENTIONS`,
    ...report.aiMentions.map(
      (m) =>
        `  ${m.engine} (${m.status}): ${m.brandsMentioned.map((b) => b.brand).slice(0, 8).join(', ') || '(no mentions extracted)'}`
    ),
    ``,
    `KEYWORDS`,
    ...report.keywords.map((k) => `  - ${k}`),
    ``,
    `Powered by Bright Data SERP, Web Unlocker, and Web Scraper APIs.`,
  ];
  return lines.join('\n');
}

function avgRank(rankings: { rank: number }[]): string {
  if (!rankings.length) return '-';
  return (rankings.reduce((s, r) => s + r.rank, 0) / rankings.length).toFixed(1);
}

function renderCitationsHtml(report: AuditReport): string {
  const cit = report.citations;
  if (!cit || cit.sources.length === 0) return '';
  const successSources = cit.sources.filter((s) => s.status !== 'failed');
  const self = cit.profiles.find((p) => p.isSelf);
  const top = cit.profiles.filter((p) => p.citationCount > 0).slice(0, 8);

  const profileRows = top
    .map((p) => {
      const youTag = p.isSelf
        ? '<span style="display:inline-block;background:rgba(6,182,212,0.18);color:#22d3ee;border:1px solid rgba(6,182,212,0.4);padding:1px 6px;border-radius:3px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;margin-right:6px">You</span>'
        : '';
      const avg = p.averagePosition !== null ? `#${p.averagePosition.toFixed(1)}` : '—';
      const tops = p.topPickCount > 0
        ? `<span style="color:#34d399;font-weight:600">${p.topPickCount}</span>`
        : '<span style="color:#52525b">—</span>';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#e4e4e7">${youTag}<strong>${escape(p.brand)}</strong>${p.domain ? ` <span style="color:#71717a;font-size:12px">(${escape(p.domain)})</span>` : ''}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#a1a1aa;text-align:right;font-family:monospace">${p.citationCount}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2a2a;text-align:right;font-family:monospace">${tops}</td>
        <td style="padding:8px;border-bottom:1px solid #2a2a2a;color:#a1a1aa;text-align:right;font-family:monospace">${avg}</td>
      </tr>`;
    })
    .join('');

  const sourceList = cit.sources
    .filter((s) => s.status !== 'failed' && s.citations.length > 0)
    .slice(0, 10)
    .map((s) => {
      const tags = s.citations
        .slice(0, 8)
        .map(
          (c) =>
            `<span style="display:inline-block;background:#1a1a1a;color:#d4d4d8;padding:3px 8px;border-radius:4px;margin:2px 4px 2px 0;font-size:12px">${
              c.position !== null ? `#${c.position} ` : ''
            }${escape(c.brand)}</span>`
        )
        .join('');
      return `<div style="margin-bottom:14px;padding:12px;background:#0f0f10;border:1px solid #27272a;border-radius:6px">
        <div style="font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${escape(s.type)} · ${escape(s.domain)}</div>
        <a href="${escape(s.url)}" style="color:#22d3ee;text-decoration:none;font-size:14px;font-weight:600">${escape(s.title)}</a>
        <div style="margin-top:8px">${tags || '<span style="color:#52525b;font-size:12px;font-style:italic">no brand citations extracted</span>'}</div>
      </div>`;
    })
    .join('');

  const selfLine = self
    ? `Cited in <strong>${self.citationCount}</strong> of ${successSources.length} sources` +
      (self.topPickCount > 0 ? ` · ${self.topPickCount} top-pick mention${self.topPickCount === 1 ? '' : 's'}` : '') +
      (self.averagePosition !== null ? ` · avg position #${self.averagePosition.toFixed(1)}` : '')
    : `Cited in 0 of ${successSources.length} third-party sources`;

  return `
    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Third-party visibility</h2>
    <div style="background:linear-gradient(135deg,rgba(6,182,212,0.06),rgba(139,92,246,0.06));border:1px solid #27272a;border-radius:8px;padding:14px;margin-bottom:14px;color:#d4d4d8;font-size:14px">
      ${selfLine}
    </div>
    ${
      profileRows
        ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px">
      <thead><tr>
        <th style="text-align:left;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Brand</th>
        <th style="text-align:right;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Cited in</th>
        <th style="text-align:right;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Top pick</th>
        <th style="text-align:right;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Avg pos</th>
      </tr></thead>
      <tbody>${profileRows}</tbody>
    </table>`
        : ''
    }
    ${sourceList ? `<div>${sourceList}</div>` : ''}
  `;
}
