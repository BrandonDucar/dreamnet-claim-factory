import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/canonical.js';
import {
  evaluateLeadVerificationRequest,
  type LeadVerificationRuntimeRequest,
} from '../src/lead-verification-runtime.js';

function request(): LeadVerificationRuntimeRequest {
  const observedAt = '2026-07-29T12:00:00.000Z';
  const producerReceiptDigest = sha256('producer-receipt');
  return {
    subject: {
      schemaVersion: 'dreamnet.lead-verification-subject.v1',
      leadRef: sha256('lead'),
      campaignRef: sha256('campaign'),
      purpose: 'HUMAN_REVIEW',
      producerFactoryId: 'dreamnet.lead-foundry.precious-metals.v1',
      producerReceiptDigest,
      discoveredAt: observedAt,
    },
    evidence: [
      {
        evidenceId: 'EVD-OSM',
        relationship: 'supports',
        artifactDigest: sha256('osm'),
        sourceUri: 'https://www.openstreetmap.org/node/1',
        sourceSpan: { start: 0, end: 1, quoteDigest: sha256('osm') },
        observedAt,
        provenanceReceiptDigest: producerReceiptDigest,
        visibility: 'public',
      },
      {
        evidenceId: 'EVD-FIRST-PARTY',
        relationship: 'supports',
        artifactDigest: sha256('website'),
        sourceUri: 'https://example.com/contact',
        sourceSpan: { start: 0, end: 1, quoteDigest: sha256('website') },
        observedAt,
        provenanceReceiptDigest: producerReceiptDigest,
        visibility: 'public',
      },
    ],
    facts: {
      category: 'COIN_DEALER',
      supportedCategory: true,
      identityEvidenceIds: ['EVD-OSM', 'EVD-FIRST-PARTY'],
      contactEvidenceIds: ['EVD-FIRST-PARTY'],
      observedPublicContactCount: 1,
      independentlyVerifiedContactCount: 1,
      dedupeStatus: 'PASS',
      dedupeReceiptDigest: sha256('dedupe'),
    },
    policy: {
      policyVersion: 'dreamnet.precious-metals-human-review.v1',
      maxEvidenceAgeHours: 720,
      minimumIdentityEvidenceSources: 2,
      minimumContactEvidenceSources: 1,
      requireSuppressionForOutreach: true,
    },
  };
}

test('independently clears evidence-complete lead for human review', () => {
  const decision = evaluateLeadVerificationRequest(
    request(),
    '2026-07-29T13:00:00.000Z'
  );
  assert.equal(decision.disposition, 'eligible_for_human_review');
  assert.equal(decision.eligibleForHumanReview, true);
  assert.match(decision.decisionDigest, /^[a-f0-9]{64}$/);
});

test('keeps observed-only contact evidence inconclusive', () => {
  const input = request();
  input.facts.contactEvidenceIds = [];
  input.facts.independentlyVerifiedContactCount = 0;
  const decision = evaluateLeadVerificationRequest(
    input,
    '2026-07-29T13:00:00.000Z'
  );
  assert.equal(decision.disposition, 'inconclusive');
  assert.equal(decision.eligibleForHumanReview, false);
  assert.ok(decision.reasons.includes('control_unknown:contact'));
});

test('rejects raw PII at the outside boundary', () => {
  const input = request() as LeadVerificationRuntimeRequest & { phone?: string };
  input.phone = '+1-555-0100';
  assert.throws(
    () => evaluateLeadVerificationRequest(input, '2026-07-29T13:00:00.000Z'),
    /raw_pii_prohibited/,
  );
});
