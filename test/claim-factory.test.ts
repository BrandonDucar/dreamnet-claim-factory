import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decidePromotion,
  produceClaim,
  selectVerificationFactories,
  sha256,
  validateCity,
  verifyClaim,
  type ClaimDraftInput,
  type ClaimRisk,
  type FactoryCharter,
  type PromotionPolicy,
  type VerificationVerdict,
  type WorkerRole,
  type WorkerSeat,
} from '../src/index.js';

const NOW = '2026-07-28T02:00:00.000Z';
const POLICY_VERSION = 'claim-city-policy@1';

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function factory(
  factoryId: string,
  kind: FactoryCharter['kind'],
  requiredRoles: WorkerRole[],
  lineage: string
): FactoryCharter {
  return {
    factoryId,
    cityId: 'market-city',
    kind,
    domain: 'market-intelligence',
    policyVersion: POLICY_VERSION,
    requiredRoles,
    modelLineages: [`model:${lineage}`],
    toolLineages: [`tool:${lineage}`],
    retrievalLineages: [`retrieval:${lineage}`],
  };
}

const producer = factory(
  'market-claim-works',
  'producer',
  ['factory_foreman', 'claim_decomposer', 'evidence_binder'],
  'producer'
);

const verifier = factory(
  'market-verification-works',
  'verifier',
  ['factory_auditor', 'independent_reproducer', 'falsification_worker'],
  'verifier'
);

function seat(
  agentId: string,
  role: WorkerRole,
  assignedFactory: FactoryCharter
): WorkerSeat {
  return {
    agentId,
    role,
    credential: {
      credentialId: `credential:${agentId}:${role}`,
      agentId,
      issuer: 'dreamnet-agent-university',
      role,
      status: 'active',
      scopes: [assignedFactory.factoryId],
      policyVersion: assignedFactory.policyVersion,
      issuedAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2027-07-01T00:00:00.000Z',
      competencyReceiptDigests: [sha256({ agentId, role })],
    },
  };
}

const producerRoster = producer.requiredRoles.map((role, index) =>
  seat(`producer-${index}`, role, producer)
);

const verifierRoster = verifier.requiredRoles.map((role, index) =>
  seat(`verifier-${index}`, role, verifier)
);

function claimInput(risk: ClaimRisk = 'medium'): ClaimDraftInput {
  return {
    statement:
      'Wallet cluster A entered three related markets before the price move.',
    scope: {
      domain: 'market-intelligence',
      validFrom: '2026-07-27T00:00:00.000Z',
      validUntil: '2026-07-29T00:00:00.000Z',
    },
    risk,
    evidence: [
      {
        evidenceId: 'trade-ledger-42',
        relationship: 'supports',
        artifactDigest: digest('a'),
        sourceUri: 'gitgrid://market-city/evidence/trade-ledger-42',
        sourceSpan: {
          start: 120,
          end: 224,
          quoteDigest: digest('b'),
        },
        observedAt: '2026-07-28T01:00:00.000Z',
        provenanceReceiptDigest: digest('c'),
        visibility: 'restricted',
      },
    ],
    dependencies: ['claim_market_identity_1'],
    contradicts: [],
    producerReceiptDigest: digest('d'),
  };
}

function verificationRun(
  verdict: VerificationVerdict,
  assignedFactory = verifier,
  assignedRoster = verifierRoster
) {
  const claim = produceClaim(producer, producerRoster, claimInput(), NOW);
  const report = verifyClaim(
    assignedFactory,
    assignedRoster,
    {
      claimDigest: claim.claimDigest,
      verdict,
      findings: [],
      independentEvidence: [],
      verificationReceiptDigest: digest('e'),
    },
    NOW
  );

  return { claim, report, factory: assignedFactory, roster: assignedRoster };
}

const promotionPolicy: PromotionPolicy = {
  policyVersion: POLICY_VERSION,
  minimumIndependentReports: 1,
  minimumSupportingReports: 1,
  requireHumanApprovalFor: ['high', 'critical'],
  independence: {
    requireDistinctFactories: true,
    prohibitWorkerOverlap: true,
    requireDistinctModelLineage: true,
    requireDistinctRetrievalLineage: true,
  },
};

describe('Claim Factory', () => {
  it('produces deterministic, content-addressed claims with credentialed workers', () => {
    const first = produceClaim(producer, producerRoster, claimInput(), NOW);
    const second = produceClaim(producer, producerRoster, claimInput(), NOW);

    assert.equal(first.claimId, second.claimId);
    assert.equal(first.claimDigest, second.claimDigest);
    assert.equal(first.status, 'proposed');
    assert.equal(first.producedBy.length, producer.requiredRoles.length);
  });

  it('rejects workers without a current University credential', () => {
    const expiredRoster = structuredClone(producerRoster);
    const firstSeat = expiredRoster[0];
    assert.ok(firstSeat);
    firstSeat.credential.expiresAt = '2026-01-01T00:00:00.000Z';

    assert.throws(
      () => produceClaim(producer, expiredRoster, claimInput(), NOW),
      /credential_expired/
    );
  });

  it('promotes a claim only after an independent factory supports it', () => {
    const run = verificationRun('supports');
    const decision = decidePromotion({
      claim: run.claim,
      producer,
      producerRoster,
      verificationRuns: [run],
      policy: promotionPolicy,
      humanApproved: false,
    });

    assert.equal(decision.status, 'verified');
    assert.equal(decision.promotable, true);
    assert.equal(decision.acceptedReportIds.length, 1);
  });

  it('rejects a verifier factory that shares the producer identity', () => {
    const selfVerifier = {
      ...verifier,
      factoryId: producer.factoryId,
    };
    const selfRoster = selfVerifier.requiredRoles.map((role, index) =>
      seat(`self-verifier-${index}`, role, selfVerifier)
    );
    const run = verificationRun('supports', selfVerifier, selfRoster);
    const decision = decidePromotion({
      claim: run.claim,
      producer,
      producerRoster,
      verificationRuns: [run],
      policy: promotionPolicy,
      humanApproved: false,
    });

    assert.equal(decision.promotable, false);
    assert.ok(
      decision.reasons.some((reason) =>
        reason.endsWith('self_verification_prohibited')
      )
    );
  });

  it('rejects producer workers reappearing inside the verifier roster', () => {
    const overlappingRoster = structuredClone(verifierRoster);
    const firstSeat = overlappingRoster[0];
    const producerSeat = producerRoster[0];
    assert.ok(firstSeat);
    assert.ok(producerSeat);
    firstSeat.agentId = producerSeat.agentId;
    firstSeat.credential.agentId = producerSeat.agentId;

    const run = verificationRun('supports', verifier, overlappingRoster);
    const decision = decidePromotion({
      claim: run.claim,
      producer,
      producerRoster,
      verificationRuns: [run],
      policy: promotionPolicy,
      humanApproved: false,
    });

    assert.equal(decision.promotable, false);
    assert.ok(
      decision.reasons.some((reason) =>
        reason.endsWith('worker_lineage_overlap')
      )
    );
  });

  it('preserves an independent challenge as a disputed claim', () => {
    const run = verificationRun('challenges');
    const decision = decidePromotion({
      claim: run.claim,
      producer,
      producerRoster,
      verificationRuns: [run],
      policy: promotionPolicy,
      humanApproved: false,
    });

    assert.equal(decision.status, 'disputed');
    assert.equal(decision.promotable, false);
    assert.ok(decision.reasons.includes('independent_challenge_present'));
  });

  it('holds high-risk claims for a human even after independent support', () => {
    const claim = produceClaim(producer, producerRoster, claimInput('high'), NOW);
    const report = verifyClaim(
      verifier,
      verifierRoster,
      {
        claimDigest: claim.claimDigest,
        verdict: 'supports',
        findings: [],
        independentEvidence: [],
        verificationReceiptDigest: digest('f'),
      },
      NOW
    );
    const verificationRuns = [
      { claim, report, factory: verifier, roster: verifierRoster },
    ];

    const pending = decidePromotion({
      claim,
      producer,
      producerRoster,
      verificationRuns,
      policy: promotionPolicy,
      humanApproved: false,
    });
    const approved = decidePromotion({
      claim,
      producer,
      producerRoster,
      verificationRuns,
      policy: promotionPolicy,
      humanApproved: true,
    });

    assert.equal(pending.status, 'supported');
    assert.equal(pending.promotable, false);
    assert.equal(approved.status, 'verified');
    assert.equal(approved.promotable, true);
  });
});

describe('Claim City', () => {
  it('requires both producer and verifier institutions', () => {
    const city = {
      cityId: 'market-city',
      domain: 'market-intelligence',
      policyVersion: POLICY_VERSION,
      universityIssuer: 'dreamnet-agent-university',
      factoryIds: [producer.factoryId],
    };

    assert.deepEqual(validateCity(city, [producer]), [
      'verifier_factory_missing',
    ]);
  });

  it('routes verification deterministically without promoting the claim', () => {
    const secondVerifier = {
      ...verifier,
      factoryId: 'market-verification-works-b',
      modelLineages: ['model:verifier-b'],
      retrievalLineages: ['retrieval:verifier-b'],
    };
    const city = {
      cityId: 'market-city',
      domain: 'market-intelligence',
      policyVersion: POLICY_VERSION,
      universityIssuer: 'dreamnet-agent-university',
      factoryIds: [
        producer.factoryId,
        secondVerifier.factoryId,
        verifier.factoryId,
      ],
    };

    assert.deepEqual(validateCity(city, [producer, secondVerifier, verifier]), []);
    assert.deepEqual(
      selectVerificationFactories(city, producer, [
        secondVerifier,
        producer,
        verifier,
      ]).map((entry) => entry.factoryId),
      ['market-verification-works', 'market-verification-works-b']
    );
  });
});

