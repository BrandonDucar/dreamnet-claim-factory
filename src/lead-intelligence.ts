import { isSha256Digest, sha256 } from './canonical.js';
import { validateRoster } from './credentials.js';
import type {
  EvidenceReference,
  FactoryCharter,
  WorkerSeat,
} from './types.js';

export type LeadVerificationControl =
  | 'identity'
  | 'contact'
  | 'dedupe'
  | 'freshness'
  | 'suppression'
  | 'campaign_fit';

export type LeadVerificationOutcome = 'pass' | 'fail' | 'unknown';

export type LeadVerificationDisposition =
  | 'eligible_for_human_review'
  | 'quarantined'
  | 'expired'
  | 'inconclusive';

export interface LeadVerificationSubject {
  schemaVersion: 'dreamnet.lead-verification-subject.v1';
  leadRef: string;
  campaignRef: string;
  purpose: 'HUMAN_REVIEW' | 'OUTREACH_ELIGIBILITY';
  producerFactoryId: string;
  producerReceiptDigest: string;
  discoveredAt: string;
}

export interface IndependentLeadObservation {
  observationId: string;
  control: LeadVerificationControl;
  outcome: LeadVerificationOutcome;
  observedBy: string;
  observedAt: string;
  evidence: EvidenceReference[];
  reasonCodes: string[];
}

export interface LeadVerificationPolicy {
  policyVersion: string;
  maxEvidenceAgeHours: number;
  minimumIdentityEvidenceSources: number;
  minimumContactEvidenceSources: number;
  requireSuppressionForOutreach: boolean;
}

export interface LeadVerificationDecision {
  schemaVersion: 'dreamnet.lead-verification-decision.v1';
  leadRef: string;
  verifierFactoryId: string;
  policyVersion: string;
  disposition: LeadVerificationDisposition;
  eligibleForHumanReview: boolean;
  checkedControls: LeadVerificationControl[];
  acceptedEvidenceIds: string[];
  reasons: string[];
  createdAt: string;
  decisionDigest: string;
}

const REQUIRED_CONTROLS: LeadVerificationControl[] = [
  'identity',
  'contact',
  'dedupe',
  'freshness',
  'campaign_fit',
];

const FORBIDDEN_PII_KEYS = new Set([
  'address',
  'email',
  'fullName',
  'mailingAddress',
  'name',
  'phone',
  'phoneNumber',
  'postalAddress',
  'primaryEmail',
  'primaryPhone',
  'streetAddress',
]);

function assertIso(value: string, code: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error(code);
  }
}

function assertNoRawPii(value: unknown, path = 'subject'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawPii(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PII_KEYS.has(key)) {
      throw new Error(`raw_pii_prohibited:${path}.${key}`);
    }
    assertNoRawPii(entry, `${path}.${key}`);
  }
}

function assertEvidence(evidence: EvidenceReference): void {
  if (
    !isSha256Digest(evidence.artifactDigest) ||
    !isSha256Digest(evidence.sourceSpan.quoteDigest) ||
    !isSha256Digest(evidence.provenanceReceiptDigest)
  ) {
    throw new Error(`lead_evidence_digest_invalid:${evidence.evidenceId}`);
  }
  if (evidence.sourceSpan.start < 0 || evidence.sourceSpan.end <= evidence.sourceSpan.start) {
    throw new Error(`lead_evidence_span_invalid:${evidence.evidenceId}`);
  }
  assertIso(evidence.observedAt, `lead_evidence_time_invalid:${evidence.evidenceId}`);
}

function uniqueEvidenceSources(observations: IndependentLeadObservation[]): number {
  return new Set(
    observations.flatMap((observation) =>
      observation.evidence.map((evidence) => [
        evidence.sourceUri,
        evidence.provenanceReceiptDigest,
      ].join('|'))
    )
  ).size;
}

export function evaluateLeadVerification(
  verifierFactory: FactoryCharter,
  verifierRoster: WorkerSeat[],
  subject: LeadVerificationSubject,
  observations: IndependentLeadObservation[],
  policy: LeadVerificationPolicy,
  now: string
): LeadVerificationDecision {
  if (verifierFactory.kind !== 'verifier') {
    throw new Error('lead_verifier_factory_kind_invalid');
  }
  if (verifierFactory.factoryId === subject.producerFactoryId) {
    throw new Error('lead_self_verification_prohibited');
  }

  const rosterProblems = validateRoster(verifierFactory, verifierRoster, now);
  if (rosterProblems.length > 0) {
    throw new Error(`lead_verifier_roster_rejected:${rosterProblems.join(',')}`);
  }

  assertNoRawPii(subject);
  if (!isSha256Digest(subject.leadRef)) throw new Error('lead_ref_digest_required');
  if (!isSha256Digest(subject.campaignRef)) throw new Error('campaign_ref_digest_required');
  if (!isSha256Digest(subject.producerReceiptDigest)) {
    throw new Error('lead_producer_receipt_invalid');
  }
  assertIso(subject.discoveredAt, 'lead_discovered_at_invalid');
  assertIso(now, 'lead_verification_time_invalid');

  if (!Number.isFinite(policy.maxEvidenceAgeHours) || policy.maxEvidenceAgeHours <= 0) {
    throw new Error('lead_evidence_age_policy_invalid');
  }
  if (
    !Number.isInteger(policy.minimumIdentityEvidenceSources) ||
    policy.minimumIdentityEvidenceSources < 1 ||
    !Number.isInteger(policy.minimumContactEvidenceSources) ||
    policy.minimumContactEvidenceSources < 1
  ) {
    throw new Error('lead_evidence_threshold_policy_invalid');
  }

  const rosterIds = new Set(verifierRoster.map((seat) => seat.agentId));
  const observationIds = new Set<string>();
  const evidenceIds = new Set<string>();
  const reasons: string[] = [];
  let staleEvidence = false;

  for (const observation of observations) {
    if (observationIds.has(observation.observationId)) {
      throw new Error(`duplicate_lead_observation:${observation.observationId}`);
    }
    observationIds.add(observation.observationId);
    if (!rosterIds.has(observation.observedBy)) {
      throw new Error(`lead_observer_not_in_verifier_roster:${observation.observedBy}`);
    }
    assertIso(
      observation.observedAt,
      `lead_observation_time_invalid:${observation.observationId}`
    );

    for (const evidence of observation.evidence) {
      assertEvidence(evidence);
      if (evidenceIds.has(evidence.evidenceId)) {
        throw new Error(`duplicate_lead_evidence:${evidence.evidenceId}`);
      }
      evidenceIds.add(evidence.evidenceId);
      const ageHours =
        (Date.parse(now) - Date.parse(evidence.observedAt)) / (60 * 60 * 1000);
      if (ageHours < 0 || ageHours > policy.maxEvidenceAgeHours) {
        staleEvidence = true;
        reasons.push(`stale_or_future_evidence:${evidence.evidenceId}`);
      }
    }
  }

  const requiredControls = subject.purpose === 'OUTREACH_ELIGIBILITY'
    && policy.requireSuppressionForOutreach
    ? [...REQUIRED_CONTROLS, 'suppression' as const]
    : REQUIRED_CONTROLS;

  for (const control of requiredControls) {
    const matching = observations.filter((observation) => observation.control === control);
    if (matching.length === 0) reasons.push(`control_missing:${control}`);
    else if (!matching.some((observation) => observation.outcome === 'pass')) {
      reasons.push(`control_not_passed:${control}`);
    }
  }

  const identityPasses = observations.filter(
    (observation) => observation.control === 'identity' && observation.outcome === 'pass'
  );
  if (uniqueEvidenceSources(identityPasses) < policy.minimumIdentityEvidenceSources) {
    reasons.push('identity_independent_evidence_threshold_not_met');
  }

  const contactPasses = observations.filter(
    (observation) => observation.control === 'contact' && observation.outcome === 'pass'
  );
  if (uniqueEvidenceSources(contactPasses) < policy.minimumContactEvidenceSources) {
    reasons.push('contact_independent_evidence_threshold_not_met');
  }

  const failed = observations.filter((observation) => observation.outcome === 'fail');
  for (const observation of failed) {
    reasons.push(
      `control_failed:${observation.control}:${observation.reasonCodes.join('+') || 'unspecified'}`
    );
  }

  const unknown = observations.filter((observation) => observation.outcome === 'unknown');
  for (const observation of unknown) {
    reasons.push(`control_unknown:${observation.control}`);
  }

  let disposition: LeadVerificationDisposition = 'eligible_for_human_review';
  if (failed.length > 0) disposition = 'quarantined';
  else if (staleEvidence) disposition = 'expired';
  else if (reasons.length > 0) disposition = 'inconclusive';

  const decisionWithoutDigest = {
    schemaVersion: 'dreamnet.lead-verification-decision.v1' as const,
    leadRef: subject.leadRef,
    verifierFactoryId: verifierFactory.factoryId,
    policyVersion: policy.policyVersion,
    disposition,
    eligibleForHumanReview: disposition === 'eligible_for_human_review',
    checkedControls: [...new Set(observations.map((observation) => observation.control))].sort(),
    acceptedEvidenceIds: [...evidenceIds].sort(),
    reasons: [...new Set(reasons)].sort(),
    createdAt: now,
  };

  return {
    ...decisionWithoutDigest,
    decisionDigest: sha256(decisionWithoutDigest),
  };
}
