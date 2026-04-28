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
      <div style="font-size:18px;color:#fafafa;font-weight:600;line-height:1.4">${escape(exec.headline)}</div>
    </div>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Key findings</h2>
    <ul style="margin:0;padding-left:20px;color:#d4d4d8;font-size:14px;line-height:1.6">
      ${exec.keyFindings.map((f) => `<li style="margin-bottom:6px">${escape(f)}</li>`).join('')}
    </ul>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Competitive gaps</h2>
    <ul style="margin:0;padding-left:20px;color:#d4d4d8;font-size:14px;line-height:1.6">
      ${exec.competitiveGaps.map((g) => `<li style="margin-bottom:6px">${escape(g)}</li>`).join('')}
    </ul>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Recommendations</h2>
    <ul style="margin:0;padding-left:20px;color:#d4d4d8;font-size:14px;line-height:1.6">
      ${exec.recommendations.map((r) => `<li style="margin-bottom:6px">${escape(r)}</li>`).join('')}
    </ul>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">Top competitors (by SERP frequency)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr><th style="text-align:left;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Domain</th><th style="text-align:left;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Appearances</th><th style="text-align:left;padding:8px;color:#71717a;font-weight:500;border-bottom:1px solid #2a2a2a">Avg rank</th></tr></thead>
      <tbody>${competitorRows}</tbody>
    </table>

    <h2 style="font-size:18px;color:#fafafa;font-weight:600;margin:28px 0 12px">AI engine mentions</h2>
    ${aiList}

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
    `KEY FINDINGS`,
    ...exec.keyFindings.map((f) => `  - ${f}`),
    ``,
    `COMPETITIVE GAPS`,
    ...exec.competitiveGaps.map((g) => `  - ${g}`),
    ``,
    `RECOMMENDATIONS`,
    ...exec.recommendations.map((r) => `  - ${r}`),
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
