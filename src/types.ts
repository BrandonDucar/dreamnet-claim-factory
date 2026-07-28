export type ClaimStatus =
  | 'proposed'
  | 'supported'
  | 'verified'
  | 'disputed'
  | 'rejected'
  | 'superseded'
  | 'expired'
  | 'retracted';

export type ClaimRisk = 'low' | 'medium' | 'high' | 'critical';

export type FactoryKind = 'producer' | 'verifier';

export type WorkerRole =
  | 'factory_foreman'
  | 'intake_steward'
  | 'claim_decomposer'
  | 'evidence_binder'
  | 'source_span_verifier'
  | 'contradiction_hunter'
  | 'confidence_calibrator'
  | 'lineage_keeper'
  | 'privacy_redactor'
  | 'independent_reproducer'
  | 'falsification_worker'
  | 'factory_auditor'
  | 'retraction_steward'
  | 'proof_promoter';

export interface WorkerCredential {
  credentialId: string;
  agentId: string;
  issuer: string;
  role: WorkerRole;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  scopes: string[];
  policyVersion: string;
  issuedAt: string;
  expiresAt: string;
  competencyReceiptDigests: string[];
}

export interface WorkerSeat {
  agentId: string;
  role: WorkerRole;
  credential: WorkerCredential;
}

export interface FactoryCharter {
  factoryId: string;
  cityId: string;
  kind: FactoryKind;
  domain: string;
  policyVersion: string;
  requiredRoles: WorkerRole[];
  modelLineages: string[];
  toolLineages: string[];
  retrievalLineages: string[];
}

export interface EvidenceReference {
  evidenceId: string;
  relationship: 'supports' | 'challenges';
  artifactDigest: string;
  sourceUri: string;
  sourceSpan: {
    start: number;
    end: number;
    quoteDigest: string;
  };
  observedAt: string;
  provenanceReceiptDigest: string;
  visibility: 'public' | 'restricted' | 'private';
}

export interface ClaimScope {
  domain: string;
  jurisdiction?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface ClaimDraftInput {
  statement: string;
  scope: ClaimScope;
  risk: ClaimRisk;
  evidence: EvidenceReference[];
  dependencies?: string[];
  contradicts?: string[];
  supersedes?: string[];
  producerReceiptDigest: string;
}

export interface ClaimRecord extends ClaimDraftInput {
  claimId: string;
  claimDigest: string;
  status: ClaimStatus;
  producerFactoryId: string;
  producedBy: Array<Pick<WorkerSeat, 'agentId' | 'role'>>;
  createdAt: string;
}

export type VerificationVerdict = 'supports' | 'challenges' | 'inconclusive';

export interface VerificationFinding {
  code: string;
  message: string;
  evidenceIds: string[];
}

export interface VerificationReportInput {
  claimDigest: string;
  verdict: VerificationVerdict;
  findings: VerificationFinding[];
  independentEvidence: EvidenceReference[];
  verificationReceiptDigest: string;
}

export interface VerificationReport extends VerificationReportInput {
  reportId: string;
  verifierFactoryId: string;
  verifiedBy: Array<Pick<WorkerSeat, 'agentId' | 'role'>>;
  createdAt: string;
}

export interface IndependencePolicy {
  requireDistinctFactories: boolean;
  prohibitWorkerOverlap: boolean;
  requireDistinctModelLineage: boolean;
  requireDistinctRetrievalLineage: boolean;
}

export interface PromotionPolicy {
  policyVersion: string;
  minimumIndependentReports: number;
  minimumSupportingReports: number;
  requireHumanApprovalFor: ClaimRisk[];
  independence: IndependencePolicy;
}

export interface PromotionDecision {
  claimId: string;
  policyVersion: string;
  status: ClaimStatus;
  promotable: boolean;
  humanApprovalRequired: boolean;
  reasons: string[];
  acceptedReportIds: string[];
  decisionDigest: string;
}

export interface ClaimCity {
  cityId: string;
  domain: string;
  policyVersion: string;
  universityIssuer: string;
  factoryIds: string[];
}

