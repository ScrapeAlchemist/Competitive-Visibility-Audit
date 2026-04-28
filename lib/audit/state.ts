// =====================================================
// Audit state container - in-memory Map, event subscription,
// log + stage progress tracking.
// =====================================================

import { v4 as uuidv4 } from 'uuid';
import {
  Audit,
  AuditInput,
  AuditStatus,
  BdProduct,
  LogEntry,
  LogType,
  StageProgress,
  StageStatus,
  STAGES,
  SubTask,
  AuditReport,
  DiscoveredBrand,
} from '../types';

interface AuditEnvelope {
  audit: Audit;
  logs: LogEntry[];
  listeners: Set<(evt: AuditEvent) => void>;
  isComplete: boolean;
}

export type AuditEvent =
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'stage'; stage: StageProgress }
  | { kind: 'audit'; audit: Audit };

// Persist across Next.js dev hot-reload by attaching to globalThis.
// Otherwise every route handler import gets a fresh Map and audits vanish.
const globalKey = '__cva_audits';
const audits: Map<string, AuditEnvelope> =
  (globalThis as Record<string, unknown>)[globalKey] as Map<string, AuditEnvelope> ||
  ((globalThis as Record<string, unknown>)[globalKey] = new Map<string, AuditEnvelope>());

export function createAudit(input: AuditInput): string {
  const id = uuidv4();
  const stages: StageProgress[] = STAGES.map((s) => ({
    id: s.id,
    name: s.name,
    status: 'pending' as StageStatus,
    subTasks: [],
  }));
  const audit: Audit = {
    id,
    status: 'discovering',
    input,
    stages,
    startedAt: Date.now(),
  };
  audits.set(id, { audit, logs: [], listeners: new Set(), isComplete: false });
  return id;
}

export function getAudit(id: string): Audit | undefined {
  return audits.get(id)?.audit;
}

export function getLogs(id: string): LogEntry[] {
  return audits.get(id)?.logs || [];
}

export function isAuditComplete(id: string): boolean {
  return audits.get(id)?.isComplete ?? false;
}

export function setAuditStatus(id: string, status: AuditStatus, error?: string): void {
  const env = audits.get(id);
  if (!env) return;
  env.audit.status = status;
  if (error) env.audit.error = error;
  if (status === 'complete' || status === 'failed' || status === 'partial') {
    env.audit.endedAt = Date.now();
  }
  emit(id, { kind: 'audit', audit: env.audit });
}

export function setBrand(id: string, brand: DiscoveredBrand): void {
  const env = audits.get(id);
  if (!env) return;
  env.audit.brand = brand;
  emit(id, { kind: 'audit', audit: env.audit });
}

export function setReport(id: string, report: AuditReport): void {
  const env = audits.get(id);
  if (!env) return;
  env.audit.report = report;
  emit(id, { kind: 'audit', audit: env.audit });
}

export function getStage(id: string, stageId: number): StageProgress | undefined {
  return audits.get(id)?.audit.stages.find((s) => s.id === stageId);
}

export function startStage(id: string, stageId: number): void {
  const env = audits.get(id);
  if (!env) return;
  const stage = env.audit.stages.find((s) => s.id === stageId);
  if (!stage) return;
  stage.status = 'running';
  stage.startedAt = Date.now();
  stage.error = undefined;
  emit(id, { kind: 'stage', stage });
  log(id, 'STAGE_START', `Starting stage ${stageId}: ${stage.name}`, { stage: stageId });
}

export function completeStage(id: string, stageId: number, partial = false): void {
  const env = audits.get(id);
  if (!env) return;
  const stage = env.audit.stages.find((s) => s.id === stageId);
  if (!stage) return;
  stage.status = partial ? 'partial' : 'complete';
  stage.endedAt = Date.now();
  emit(id, { kind: 'stage', stage });
  const dur = stage.startedAt ? stage.endedAt - stage.startedAt : 0;
  log(id, 'STAGE_DONE', `Completed stage ${stageId}: ${stage.name}${partial ? ' (partial)' : ''}`, {
    stage: stageId,
    durationMs: dur,
  });
}

export function failStage(id: string, stageId: number, error: string): void {
  const env = audits.get(id);
  if (!env) return;
  const stage = env.audit.stages.find((s) => s.id === stageId);
  if (!stage) return;
  stage.status = 'failed';
  stage.endedAt = Date.now();
  stage.error = error;
  emit(id, { kind: 'stage', stage });
  log(id, 'STAGE_FAIL', `Stage ${stageId} failed: ${error}`, { stage: stageId });
}

export function addSubTask(
  id: string,
  stageId: number,
  label: string,
  bdProduct?: BdProduct
): SubTask {
  const env = audits.get(id);
  const stage = env?.audit.stages.find((s) => s.id === stageId);
  const sub: SubTask = {
    id: uuidv4(),
    label,
    status: 'running',
    bdProduct,
    startedAt: Date.now(),
  };
  if (stage) {
    stage.subTasks.push(sub);
    if (env) emit(id, { kind: 'stage', stage });
  }
  return sub;
}

export function completeSubTask(id: string, stageId: number, subTaskId: string): void {
  const env = audits.get(id);
  const stage = env?.audit.stages.find((s) => s.id === stageId);
  const sub = stage?.subTasks.find((t) => t.id === subTaskId);
  if (sub && stage && env) {
    sub.status = 'complete';
    sub.endedAt = Date.now();
    emit(id, { kind: 'stage', stage });
  }
}

export function failSubTask(id: string, stageId: number, subTaskId: string, error: string): void {
  const env = audits.get(id);
  const stage = env?.audit.stages.find((s) => s.id === stageId);
  const sub = stage?.subTasks.find((t) => t.id === subTaskId);
  if (sub && stage && env) {
    sub.status = 'failed';
    sub.endedAt = Date.now();
    sub.error = error;
    emit(id, { kind: 'stage', stage });
  }
}

export function log(
  id: string,
  type: LogType,
  message: string,
  extra: { bdProduct?: BdProduct; stage?: number; durationMs?: number } = {}
): void {
  const env = audits.get(id);
  if (!env) return;
  const entry: LogEntry = {
    id: uuidv4(),
    timestamp: Date.now(),
    type,
    message,
    ...extra,
  };
  env.logs.push(entry);
  emit(id, { kind: 'log', entry });
}

export function subscribe(id: string, callback: (evt: AuditEvent) => void): () => void {
  const env = audits.get(id);
  if (!env) return () => {};
  env.listeners.add(callback);

  // Replay snapshot: stage state + all logs + audit state
  for (const stage of env.audit.stages) callback({ kind: 'stage', stage });
  for (const entry of env.logs) callback({ kind: 'log', entry });
  callback({ kind: 'audit', audit: env.audit });

  return () => {
    env.listeners.delete(callback);
  };
}

export function markComplete(id: string): void {
  const env = audits.get(id);
  if (env) env.isComplete = true;
}

function emit(id: string, evt: AuditEvent): void {
  const env = audits.get(id);
  if (!env) return;
  env.listeners.forEach((listener) => {
    try {
      listener(evt);
    } catch {
      // ignore listener errors
    }
  });
}
