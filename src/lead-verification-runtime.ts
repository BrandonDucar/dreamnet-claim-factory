import { sha256 } from './canonical.js';
import {
  evaluateLeadVerification,
  type IndependentLeadObservation,
  type LeadVerificationDecision,
  type LeadVerificationPolicy,
  type LeadVerificationSubject,
} from './lead-intelligence.js';
import type {
  EvidenceReference,
  FactoryCharter,
  WorkerRole,
  WorkerSeat,
} from './types.js';

export interface LeadVerificationRuntimeFacts {
  category: string;
  supportedCategory: boolean;
  identityEvidenceIds: string[];
  contactEvidenceIds: string[];
  observedPublicContactCount: number;
  independentlyVerifiedContactCount: number;
  dedupeStatus: 'PASS' | 'FAIL' | 'UNKNOWN';
  dedupeReceiptDigest: string;
}

export interface LeadVerificationRuntimeRequest {
  subject: LeadVerificationSubject;
  evidence: EvidenceReference[];
  facts: LeadVerificationRuntimeFacts;
  policy: LeadVerificationPolicy;
}

const FACTORY_ID = 'dreamnet.outside-lead-verifier.v1';
const CITY_ID = 'dreamnet.claim-city.commercial-intelligence.v1';
const POLICY_VERSION = 'dreamnet.outside-lead-verifier.policy.v1';
const REQUIRED_ROLES: WorkerRole[] = [
  'source_span_verifier',
  'privacy_redactor',
  'factory_auditor',
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

function assertNoRawPii(value: unknown, path = 'request'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawPii(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PII_KEYS.has(key)) {
      throw new Error(`raw_pii_prohibited:${path}.${key}`);
    }
    assertNoRawPii(child, `${path}.${key}`);
  }
}

function charter(): FactoryCharter {
  return {
    factoryId: FACTORY_ID,
    cityId: CITY_ID,
    kind: 'verifier',
    domain: 'lead-intelligence',
    policyVersion: POLICY_VERSION,
    requiredRoles: REQUIRED_ROLES,
    modelLineages: ['deterministic-policy-engine'],
    toolLineages: ['dreamnet-claim-factory'],
    retrievalLineages: ['producer-supplied-content-addressed-evidence'],
  };
}

function roster(): WorkerSeat[] {
  return REQUIRED_ROLES.map((role) => {
    const agentId = `outside-lead-${role}`;
    return {
      agentId,
      role,
      credential: {
        credentialId: `credential:${agentId}`,
        agentId,
        issuer: 'dreamnet-agent-university',
        role,
        status: 'active',
        scopes: [FACTORY_ID],
        policyVersion: POLICY_VERSION,
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
        competencyReceiptDigests: [sha256({ agentId, role, exam: 'lead-verification-v1' })],
      },
    };
  });
}

function evidenceById(request: LeadVerificationRuntimeRequest): Map<string, EvidenceReference> {
  return new Map(request.evidence.map((evidence) => [evidence.evidenceId, evidence]));
}

function derivedEvidence(
  evidence: EvidenceReference,
  control: IndependentLeadObservation['control']
): EvidenceReference {
  return {
    ...evidence,
    evidenceId: `${evidence.evidenceId}:${control}`,
  };
}

function selectedEvidence(
  request: LeadVerificationRuntimeRequest,
  ids: string[],
  control: IndependentLeadObservation['control']
): EvidenceReference[] {
  const index = evidenceById(request);
  return ids
    .map((id) => index.get(id))
    .filter((evidence): evidence is EvidenceReference => Boolean(evidence))
    .map((evidence) => derivedEvidence(evidence, control));
}

function observations(
  request: LeadVerificationRuntimeRequest,
  now: string
): IndependentLeadObservation[] {
  const identityEvidence = selectedEvidence(
    request,
    request.facts.identityEvidenceIds,
    'identity'
  );
  const contactEvidence = selectedEvidence(
    request,
    request.facts.contactEvidenceIds,
    'contact'
  );
  const allEvidenceIds = request.evidence.map((evidence) => evidence.evidenceId);
  const freshnessEvidence = selectedEvidence(request, allEvidenceIds, 'freshness');
  const campaignEvidence = selectedEvidence(request, allEvidenceIds, 'campaign_fit');
  const dedupeEvidence: EvidenceReference[] = [{
    evidenceId: `dedupe:${request.subject.leadRef.slice(0, 16)}`,
    relationship: 'supports',
    artifactDigest: request.facts.dedupeReceiptDigest,
    sourceUri: `urn:dreamnet:dedupe:${request.subject.leadRef}`,
    sourceSpan: {
      start: 0,
      end: 1,
      quoteDigest: request.facts.dedupeReceiptDigest,
    },
    observedAt: now,
    provenanceReceiptDigest: request.subject.producerReceiptDigest,
    visibility: 'restricted',
  }];

  return [
    {
      observationId: `observation:identity:${request.subject.leadRef.slice(0, 16)}`,
      control: 'identity',
      outcome: identityEvidence.length >= request.policy.minimumIdentityEvidenceSources
        ? 'pass'
        : 'unknown',
      observedBy: 'outside-lead-source_span_verifier',
      observedAt: now,
      evidence: identityEvidence,
      reasonCodes: identityEvidence.length >= request.policy.minimumIdentityEvidenceSources
        ? ['independent_identity_source_threshold_met']
        : ['independent_identity_source_threshold_not_met'],
    },
    {
      observationId: `observation:contact:${request.subject.leadRef.slice(0, 16)}`,
      control: 'contact',
      outcome: contactEvidence.length >= request.policy.minimumContactEvidenceSources
        ? 'pass'
        : 'unknown',
      observedBy: 'outside-lead-source_span_verifier',
      observedAt: now,
      evidence: contactEvidence,
      reasonCodes: contactEvidence.length >= request.policy.minimumContactEvidenceSources
        ? ['independently_verified_public_contact_threshold_met']
        : ['observed_contact_is_not_independent_confirmation'],
    },
    {
      observationId: `observation:dedupe:${request.subject.leadRef.slice(0, 16)}`,
      control: 'dedupe',
      outcome: request.facts.dedupeStatus === 'PASS'
        ? 'pass'
        : request.facts.dedupeStatus === 'FAIL'
          ? 'fail'
          : 'unknown',
      observedBy: 'outside-lead-factory_auditor',
      observedAt: now,
      evidence: dedupeEvidence,
      reasonCodes: [`dedupe_${request.facts.dedupeStatus.toLowerCase()}`],
    },
    {
      observationId: `observation:freshness:${request.subject.leadRef.slice(0, 16)}`,
      control: 'freshness',
      outcome: freshnessEvidence.length > 0 ? 'pass' : 'unknown',
      observedBy: 'outside-lead-factory_auditor',
      observedAt: now,
      evidence: freshnessEvidence,
      reasonCodes: freshnessEvidence.length > 0
        ? ['freshness_evaluated_by_policy_engine']
        : ['freshness_evidence_missing'],
    },
    {
      observationId: `observation:campaign-fit:${request.subject.leadRef.slice(0, 16)}`,
      control: 'campaign_fit',
      outcome: request.facts.supportedCategory ? 'pass' : 'fail',
      observedBy: 'outside-lead-privacy_redactor',
      observedAt: now,
      evidence: campaignEvidence,
      reasonCodes: request.facts.supportedCategory
        ? [`supported_category:${request.facts.category}`]
        : [`unsupported_category:${request.facts.category}`],
    },
  ];
}

export function evaluateLeadVerificationRequest(
  request: LeadVerificationRuntimeRequest,
  now = new Date().toISOString()
): LeadVerificationDecision {
  assertNoRawPii(request);
  if (request.subject.producerFactoryId === FACTORY_ID) {
    throw new Error('lead_self_verification_prohibited');
  }
  if (request.evidence.length === 0) throw new Error('lead_evidence_required');
  return evaluateLeadVerification(
    charter(),
    roster(),
    request.subject,
    observations(request, now),
    request.policy,
    now
  );
}

export const outsideLeadVerifierIdentity = Object.freeze({
  factoryId: FACTORY_ID,
  cityId: CITY_ID,
  policyVersion: POLICY_VERSION,
  requiredRoles: REQUIRED_ROLES,
});
