import { isSha256Digest } from './canonical.js';
import type {
  FactoryCharter,
  WorkerCredential,
  WorkerRole,
  WorkerSeat,
} from './types.js';

export interface CredentialDecision {
  admitted: boolean;
  reasons: string[];
}

export function evaluateCredential(
  credential: WorkerCredential,
  factory: FactoryCharter,
  role: WorkerRole,
  now: string
): CredentialDecision {
  const reasons: string[] = [];
  const nowMs = Date.parse(now);

  if (credential.agentId.length === 0) reasons.push('agent_id_missing');
  if (credential.role !== role) reasons.push('role_not_credentialed');
  if (credential.status !== 'active') reasons.push('credential_not_active');
  if (credential.policyVersion !== factory.policyVersion) {
    reasons.push('credential_policy_mismatch');
  }
  if (!credential.scopes.includes(factory.factoryId) && !credential.scopes.includes(factory.cityId)) {
    reasons.push('factory_scope_missing');
  }
  if (!Number.isFinite(nowMs) || Date.parse(credential.expiresAt) <= nowMs) {
    reasons.push('credential_expired');
  }
  if (
    credential.competencyReceiptDigests.length === 0 ||
    credential.competencyReceiptDigests.some((digest) => !isSha256Digest(digest))
  ) {
    reasons.push('competency_receipt_invalid');
  }

  return { admitted: reasons.length === 0, reasons };
}

export function validateRoster(
  factory: FactoryCharter,
  roster: WorkerSeat[],
  now: string
): string[] {
  const reasons: string[] = [];
  const assignedAgents = new Set<string>();

  for (const role of factory.requiredRoles) {
    if (!roster.some((seat) => seat.role === role)) {
      reasons.push(`required_role_missing:${role}`);
    }
  }

  for (const seat of roster) {
    if (assignedAgents.has(seat.agentId)) {
      reasons.push(`duplicate_worker:${seat.agentId}`);
    }
    assignedAgents.add(seat.agentId);

    if (seat.credential.agentId !== seat.agentId) {
      reasons.push(`credential_subject_mismatch:${seat.agentId}`);
      continue;
    }

    const decision = evaluateCredential(seat.credential, factory, seat.role, now);
    reasons.push(
      ...decision.reasons.map((reason) => `${seat.agentId}:${reason}`)
    );
  }

  return reasons;
}

