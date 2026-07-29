import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateLeadVerification,
  sha256,
  type EvidenceReference,
  type FactoryCharter,
  type IndependentLeadObservation,
  type LeadVerificationControl,
  type LeadVerificationPolicy,
  type LeadVerificationSubject,
  type WorkerRole,
  type WorkerSeat,
} from '../src/index.js';

const NOW = '2026-07-29T12:00:00.000Z';
const POLICY_VERSION = 'lead-intelligence-policy@1';

const verifierFactory: FactoryCharter = {
  factoryId: 'lead-verification-factory',
  cityId: 'lead-intelligence-city',
  kind: 'verifier',
  domain: 'lead-intelligence',
  policyVersion: POLICY_VERSION,
  requiredRoles: [
    'factory_auditor',
    'independent_reproducer',
    'privacy_redactor',
  ],
  modelLineages: ['model:lead-verifier'],
  toolLineages: ['tool:lead-verifier'],
  retrievalLineages: ['retrieval:lead-verifier'],
};

function seat(agentId: string, role: WorkerRole): WorkerSeat {
  return {
    agentId,
    role,
    credential: {
      credentialId: `credential:${agentId}`,
      agentId,
      issuer: 'dreamnet-agent-university',
      role,
      status: 'active',
      scopes: [verifierFactory.factoryId],
      policyVersion: POLICY_VERSION,
      issuedAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2027-07-01T00:00:00.000Z',
      competencyReceiptDigests: [sha256({ agentId, role })],
    },
  };
}

const roster = verifierFactory.requiredRoles.map((role, index) =>
  seat(`lead-verifier-${index}`, role)
);

const subject: LeadVerificationSubject = {
  schemaVersion: 'dreamnet.lead-verification-subject.v1',
  leadRef: sha256('lead:opaque:42'),
  campaignRef: sha256('campaign:metalsmint'),
  purpose: 'OUTREACH_ELIGIBILITY',
  producerFactoryId: 'precious-metals-discovery-factory',
  producerReceiptDigest: sha256('producer-receipt'),
  discoveredAt: '2026-07-28T12:00:00.000Z',
};

const policy: LeadVerificationPolicy = {
  policyVersion: POLICY_VERSION,
  maxEvidenceAgeHours: 72,
  minimumIdentityEvidenceSources: 2,
  minimumContactEvidenceSources: 2,
  requireSuppressionForOutreach: true,
};

function evidence(control: string, source: string, index: number): EvidenceReference {
  return {
    evidenceId: `${control}-${index}`,
    relationship: 'supports',
    artifactDigest: sha256(`${control}:${source}:artifact`),
    sourceUri: `evidence://${source}/${control}`,
    sourceSpan: {
      start: 0,
      end: 10,
      quoteDigest: sha256(`${control}:${source}:span`),
    },
    observedAt: '2026-07-29T10:00:00.000Z',
    provenanceReceiptDigest: sha256(`${control}:${source}:provenance`),
    visibility: 'restricted',
  };
}

function observation(
  control: LeadVerificationControl,
  outcome: IndependentLeadObservation['outcome'] = 'pass',
  sourceCount = 1
): IndependentLeadObservation {
  return {
    observationId: `observation:${control}`,
    control,
    outcome,
    observedBy: roster[0]!.agentId,
    observedAt: '2026-07-29T10:00:00.000Z',
    evidence: Array.from({ length: sourceCount }, (_, index) =>
      evidence(control, `${control}-source-${index}`, index)
    ),
    reasonCodes: outcome === 'fail' ? ['independent_check_failed'] : [],
  };
}

function passingObservations(): IndependentLeadObservation[] {
  return [
    observation('identity', 'pass', 2),
    observation('contact', 'pass', 2),
    observation('dedupe'),
    observation('freshness'),
    observation('suppression'),
    observation('campaign_fit'),
  ];
}

describe('outside lead Claim Factory profile', () => {
  it('makes a fully evidenced lead eligible only for human review', () => {
    const decision = evaluateLeadVerification(
      verifierFactory,
      roster,
      subject,
      passingObservations(),
      policy,
      NOW
    );

    assert.equal(decision.disposition, 'eligible_for_human_review');
    assert.equal(decision.eligibleForHumanReview, true);
    assert.match(decision.decisionDigest, /^sha256:[a-f0-9]{64}$/);
  });

  it('rejects self-verification by the producing factory', () => {
    assert.throws(
      () => evaluateLeadVerification(
        { ...verifierFactory, factoryId: subject.producerFactoryId },
        roster,
        subject,
        passingObservations(),
        policy,
        NOW
      ),
      /lead_self_verification_prohibited/
    );
  });

  it('keeps a one-source contact match inconclusive', () => {
    const observations = passingObservations().map((item) =>
      item.control === 'contact' ? observation('contact', 'pass', 1) : item
    );
    const decision = evaluateLeadVerification(
      verifierFactory,
      roster,
      subject,
      observations,
      policy,
      NOW
    );

    assert.equal(decision.disposition, 'inconclusive');
    assert.ok(decision.reasons.includes('contact_independent_evidence_threshold_not_met'));
  });

  it('quarantines a failed duplicate check', () => {
    const observations = passingObservations().map((item) =>
      item.control === 'dedupe' ? observation('dedupe', 'fail') : item
    );
    const decision = evaluateLeadVerification(
      verifierFactory,
      roster,
      subject,
      observations,
      policy,
      NOW
    );

    assert.equal(decision.disposition, 'quarantined');
    assert.equal(decision.eligibleForHumanReview, false);
  });

  it('expires a decision when supporting evidence is stale', () => {
    const observations = passingObservations();
    observations[0]!.evidence[0]!.observedAt = '2026-07-20T10:00:00.000Z';
    const decision = evaluateLeadVerification(
      verifierFactory,
      roster,
      subject,
      observations,
      policy,
      NOW
    );

    assert.equal(decision.disposition, 'expired');
    assert.ok(decision.reasons.some((reason) => reason.startsWith('stale_or_future_evidence:')));
  });

  it('requires a suppression result before outreach eligibility', () => {
    const decision = evaluateLeadVerification(
      verifierFactory,
      roster,
      subject,
      passingObservations().filter((item) => item.control !== 'suppression'),
      policy,
      NOW
    );

    assert.equal(decision.disposition, 'inconclusive');
    assert.ok(decision.reasons.includes('control_missing:suppression'));
  });

  it('rejects raw PII fields at the verifier boundary', () => {
    const unsafeSubject = {
      ...subject,
      email: 'not-allowed@example.invalid',
    };
    assert.throws(
      () => evaluateLeadVerification(
        verifierFactory,
        roster,
        unsafeSubject,
        passingObservations(),
        policy,
        NOW
      ),
      /raw_pii_prohibited/
    );
  });
});
