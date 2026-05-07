// =====================================================
// Per-run disk persistence.
// One folder per audit at <ROOT>/<auditId>/ containing:
//   - audit.json       full audit state (input, brand, stages, report)
//   - logs.jsonl       chronological log entries, one JSON per line
//   - report.json      just the final report (when present)
//   - report.html      rendered email-style HTML report (when present)
//
// Calls are fire-and-forget; disk failures are logged but never block
// the live audit pipeline.
// =====================================================

import { promises as fs } from 'fs';
import * as path from 'path';
import { Audit, LogEntry } from '../types';
import { renderReportEmailHtml } from '../report-html';

const ROOT = process.env.AUDIT_LOG_DIR || path.join(process.cwd(), 'audit');

async function ensureDir(auditId: string): Promise<string> {
  const dir = path.join(ROOT, auditId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Append a single log entry to <root>/<auditId>/logs.jsonl.
 * Fire-and-forget - errors logged to console only.
 */
export function appendLogToDisk(auditId: string, entry: LogEntry): void {
  void (async () => {
    try {
      const dir = await ensureDir(auditId);
      const file = path.join(dir, 'logs.jsonl');
      await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error(`[persistence] appendLog failed for ${auditId}:`, err);
    }
  })();
}

/**
 * Write the full audit state + report files to disk.
 * Fire-and-forget - errors logged to console only.
 */
export function saveAuditSnapshot(auditId: string, audit: Audit): void {
  void (async () => {
    try {
      const dir = await ensureDir(auditId);
      await fs.writeFile(path.join(dir, 'audit.json'), JSON.stringify(audit, null, 2), 'utf8');
      if (audit.report) {
        await fs.writeFile(
          path.join(dir, 'report.json'),
          JSON.stringify(audit.report, null, 2),
          'utf8'
        );
        try {
          await fs.writeFile(path.join(dir, 'report.html'), renderReportEmailHtml(audit.report), 'utf8');
        } catch (err) {
          console.error(`[persistence] HTML render failed for ${auditId}:`, err);
        }
      }
    } catch (err) {
      console.error(`[persistence] saveSnapshot failed for ${auditId}:`, err);
    }
  })();
}
