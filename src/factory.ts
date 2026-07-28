import { isSha256Digest, sha256 } from './canonical.js';
import { validateRoster } from './credentials.js';
import type {
  ClaimDraftInput,
  ClaimRecord,
  FactoryCharter,
  IndependencePolicy,
  PromotionDecision,
  PromotionPolicy,
  VerificationReport,
  VerificationReportInput,
  WorkerSeat,
} from './types.js';

function assertFactoryKind(
  factory: FactoryCharter,
  expected: FactoryCharter['kind']
): void {
  if (factory.kind !== expected) {
    throw new Error(`factory_kind_must_be_${expected}`);
  }
}

function assertRoster(
  factory: FactoryCharter,
  roster: WorkerSeat[],
  now: string
): void {
  const problems = validateRoster(factory, roster, now);
  if (problems.length > 0) {
    throw new Error(`worker_roster_rejected:${problems.join(',')}`);
  }
}

function assertEvidence(input: ClaimDraftInput): void {
  if (input.statement.trim().length === 0) {
    throw new Error('claim_statement_missing');
  }
  if (input.evidence.length === 0) {
    throw new Error('claim_evidence_missing');
  }
  if (!input.evidence.some((item) => item.relationship === 'supports')) {
    throw new Error('supporting_evidence_missing');
  }
  if (!isSha256Digest(input.producerReceiptDigest)) {
    throw new Error('producer_receipt_invalid');
  }

  const ids = new Set<string>();
  for (const item of input.evidence) {
    if (ids.has(item.evidenceId)) {
      throw new Error(`duplicate_evidence:${item.evidenceId}`);
    }
    ids.add(item.evidenceId);
    if (
      !isSha256Digest(item.artifactDigest) ||
      !isSha256Digest(item.sourceSpan.quoteDigest) ||
      !isSha256Digest(item.provenanceReceiptDigest)
    ) {
      throw new Error(`evidence_digest_invalid:${item.evidenceId}`);
    }
    if (item.sourceSpan.start < 0 || item.sourceSpan.end <= item.sourceSpan.start) {
      throw new Error(`evidence_span_invalid:${item.evidenceId}`);
    }
  }
}

export function produceClaim(
  factory: FactoryCharter,
  roster: WorkerSeat[],
  input: ClaimDraftInput,
  now: string
): ClaimRecord {
  assertFactoryKind(factory, 'producer');
  assertRoster(factory, roster, now);
  assertEvidence(input);

  const identityMaterial = {
    statement: input.statement.trim(),
    scope: input.scope,
  };
  const claimId = `claim_${sha256(identityMaterial).slice(7, 39)}`;
  const recordWithoutDigest = {
    ...input,
    statement: input.statement.trim(),
    claimId,
    status: 'proposed' as const,
    producerFactoryId: factory.factoryId,
    producedBy: roster.map(({ agentId, role }) => ({ agentId, role })),
    createdAt: now,
  };

  return {
    ...recordWithoutDigest,
    claimDigest: sha256(recordWithoutDigest),
  };
}

export function verifyClaim(
  factory: FactoryCharter,
  roster: WorkerSeat[],
  input: VerificationReportInput,
  now: string
): VerificationReport {
  assertFactoryKind(factory, 'verifier');
  assertRoster(factory, roster, now);

  if (!isSha256Digest(input.claimDigest)) {
    throw new Error('claim_digest_invalid');
  }
  if (!isSha256Digest(input.verificationReceiptDigest)) {
    throw new Error('verification_receipt_invalid');
  }

  const reportMaterial = {
    ...input,
    verifierFactoryId: factory.factoryId,
    verifiedBy: roster.map(({ agentId, role }) => ({ agentId, role })),
    createdAt: now,
  };

  return {
    ...reportMaterial,
    reportId: `verification_${sha256(reportMaterial).slice(7, 39)}`,
  };
}

function intersects(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

export function evaluateFactoryIndependence(
  producer: FactoryCharter,
  producerRoster: WorkerSeat[],
  verifier: FactoryCharter,
  verifierRoster: WorkerSeat[],
  policy: IndependencePolicy
): string[] {
  const reasons: string[] = [];

  if (verifier.kind !== 'verifier') reasons.push('verifier_kind_invalid');
  if (policy.requireDistinctFactories && producer.factoryId === verifier.factoryId) {
    reasons.push('self_verification_prohibited');
  }
  if (
    policy.prohibitWorkerOverlap &&
    intersects(
      producerRoster.map((seat) => seat.agentId),
      verifierRoster.map((seat) => seat.agentId)
    )
  ) {
    reasons.push('worker_lineage_overlap');
  }
  if (
    policy.requireDistinctModelLineage &&
    intersects(producer.modelLineages, verifier.modelLineages)
  ) {
    reasons.push('model_lineage_overlap');
  }
  if (
    policy.requireDistinctRetrievalLineage &&
    intersects(producer.retrievalLineages, verifier.retrievalLineages)
  ) {
    reasons.push('retrieval_lineage_overlap');
  }

  return reasons;
}

export interface PromotionInput {
  claim: ClaimRecord;
  producer: FactoryCharter;
  producerRoster: WorkerSeat[];
  verificationRuns: Array<{
    factory: FactoryCharter;
    roster: WorkerSeat[];
    report: VerificationReport;
  }>;
  policy: PromotionPolicy;
  humanApproved: boolean;
}

export function decidePromotion(input: PromotionInput): PromotionDecision {
  const reasons: string[] = [];
  const acceptedReports: VerificationReport[] = [];

  for (const run of input.verificationRuns) {
    if (run.report.claimDigest !== input.claim.claimDigest) {
      reasons.push(`report_claim_mismatch:${run.report.reportId}`);
      continue;
    }
    if (run.report.verifierFactoryId !== run.factory.factoryId) {
      reasons.push(`report_factory_mismatch:${run.report.reportId}`);
      continue;
    }

    const independenceProblems = evaluateFactoryIndependence(
      input.producer,
      input.producerRoster,
      run.factory,
      run.roster,
      input.policy.independence
    );
    if (independenceProblems.length > 0) {
      reasons.push(
        ...independenceProblems.map(
          (problem) => `${run.report.reportId}:${problem}`
        )
      );
      continue;
    }
    acceptedReports.push(run.report);
  }

  const supporting = acceptedReports.filter(
    (report) => report.verdict === 'supports'
  );
  const challenging = acceptedReports.filter(
    (report) => report.verdict === 'challenges'
  );
  const humanApprovalRequired = input.policy.requireHumanApprovalFor.includes(
    input.claim.risk
  );

  let status: PromotionDecision['status'] = 'proposed';
  let promotable = false;

  if (challenging.length > 0) {
    status = 'disputed';
    reasons.push('independent_challenge_present');
  } else if (acceptedReports.length < input.policy.minimumIndependentReports) {
    reasons.push('independent_report_threshold_not_met');
  } else if (supporting.length < input.policy.minimumSupportingReports) {
    reasons.push('supporting_report_threshold_not_met');
  } else if (humanApprovalRequired && !input.humanApproved) {
    status = 'supported';
    reasons.push('human_approval_pending');
  } else {
    status = 'verified';
    promotable = true;
  }

  const decisionWithoutDigest = {
    claimId: input.claim.claimId,
    policyVersion: input.policy.policyVersion,
    status,
    promotable,
    humanApprovalRequired,
    reasons,
    acceptedReportIds: acceptedReports.map((report) => report.reportId).sort(),
  };

  return {
    ...decisionWithoutDigest,
    decisionDigest: sha256(decisionWithoutDigest),
  };
}

