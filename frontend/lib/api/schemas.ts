import { z } from 'zod';

const boundedString = (field: string, max = 256) =>
  z
    .string({ error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} must be ${max} characters or fewer`);

export const ratingsBodySchema = z.object({
  productId: boundedString('productId', 128),
  walletAddress: boundedString('walletAddress', 128),
  stars: z
    .number({ error: 'stars must be a number' })
    .int('stars must be an integer')
    .min(1, 'stars must be between 1 and 5')
    .max(5, 'stars must be between 1 and 5'),
  comment: z
    .string({ error: 'comment must be a string' })
    .max(500, 'comment must be 500 characters or less')
    .optional(),
  message: boundedString('message', 512),
  signature: boundedString('signature', 2048),
});

export const ratingsQuerySchema = z.object({
  productId: boundedString('productId', 128),
});

export const feeBumpBodySchema = z.object({
  innerTx: boundedString('innerTx', 32768),
});

export const uploadFieldsSchema = z.object({
  productId: boundedString('productId', 128).optional(),
});

export const productBadgeParamsSchema = z.object({
  id: boundedString('id', 128),
});

// These limits mirror the values accepted by the product and tracking-event
// contract methods. Keeping them here makes the API and frontend fail before
// an RPC submission rather than surfacing a contract error to the user.
export const CONTRACT_LIMITS = {
  productName: 256,
  origin: 256,
  location: 256,
  actor: 128,
  metadata: 4096,
  authorizedActors: 50,
} as const;

export const stellarAddressSchema = z
  .string({ error: 'address is required' })
  .regex(/^G[A-Z2-7]{55}$/, 'address must be a valid Stellar public key');

export const productCreateBodySchema = z.object({
  name: boundedString('name', CONTRACT_LIMITS.productName),
  origin: boundedString('origin', CONTRACT_LIMITS.origin),
  owner: stellarAddressSchema,
  authorizedActors: z
    .array(stellarAddressSchema, { error: 'authorizedActors must be an array' })
    .max(
      CONTRACT_LIMITS.authorizedActors,
      `authorizedActors must contain at most ${CONTRACT_LIMITS.authorizedActors} entries`,
    )
    .optional()
    .default([]),
  requiredSignatures: z
    .number({ error: 'requiredSignatures must be a number' })
    .int('requiredSignatures must be an integer')
    .nonnegative('requiredSignatures must be greater than or equal to 0')
    .optional()
    .default(1),
  imageUrl: z
    .string({ error: 'imageUrl must be a string' })
    .url('imageUrl must be a valid URL')
    .optional(),
});

export const paginationQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const productListQuerySchema = paginationQuerySchema;

export const auditorCreateBodySchema = z.object({
  address: stellarAddressSchema,
  name: boundedString('name', 128),
});

export const auditorListQuerySchema = paginationQuerySchema.extend({
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const trackingEventTypeSchema = z.enum(['HARVEST', 'PROCESSING', 'SHIPPING', 'RETAIL']);

export const trackingEventCreateBodySchema = z.object({
  eventType: trackingEventTypeSchema,
  location: boundedString('location', CONTRACT_LIMITS.location),
  actor: stellarAddressSchema,
  metadata: z
    .string({ error: 'metadata must be a string' })
    .max(
      CONTRACT_LIMITS.metadata,
      `metadata must be ${CONTRACT_LIMITS.metadata} characters or fewer`,
    )
    .optional()
    .default('{}'),
  seq: z
    .number({ error: 'seq must be a number' })
    .int('seq must be an integer')
    .nonnegative('seq must be greater than or equal to 0'),
});

export const trackingEventBatchBodySchema = trackingEventCreateBodySchema
  .omit({ seq: true })
  .array()
  .min(1, 'at least one event is required');

export const trackingEventListQuerySchema = paginationQuerySchema;

export type ProductCreateBody = z.infer<typeof productCreateBodySchema>;
export type AuditorCreateBody = z.infer<typeof auditorCreateBodySchema>;
export type TrackingEventCreateBody = z.infer<typeof trackingEventCreateBodySchema>;

export const contractPauseBodySchema = z.object({
  paused: z.boolean({ error: 'paused must be a boolean' }),
  reason: z.string({ error: 'reason must be a string' }).trim().max(256).optional(),
});

export const batchRecallBodySchema = z.object({
  reason: boundedString('reason', 4096),
});

export const delegationCreateBodySchema = z.object({
  delegatee: stellarAddressSchema,
  expiresAt: z.number({ error: 'expiresAt must be a number' }).int().positive(),
});

export const provenanceProofBodySchema = z.object({
  encodedProof: boundedString('encodedProof', 1024 * 1024),
});

export const webhookProcessPendingBodySchema = z.object({
  event: z
    .object({
      productId: boundedString('event.productId', 128),
      eventType: trackingEventTypeSchema,
      location: boundedString('event.location', CONTRACT_LIMITS.location),
      actor: z.string().min(1),
      timestamp: z.number(),
      metadata: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

export type ContractPauseBody = z.infer<typeof contractPauseBodySchema>;
export type BatchRecallBody = z.infer<typeof batchRecallBodySchema>;
export type DelegationCreateBody = z.infer<typeof delegationCreateBodySchema>;
export type ProvenanceProofBody = z.infer<typeof provenanceProofBodySchema>;
export type WebhookProcessPendingBody = z.infer<typeof webhookProcessPendingBodySchema>;

export const createAlertBodySchema = z.object({
  productId: boundedString('productId', 128),
  productName: boundedString('productName', 256),
  title: boundedString('title', 200),
  message: boundedString('message', 2000),
  severity: z.enum(['info', 'warning', 'high', 'critical']),
  distribution: z.object({
    channels: z.array(z.enum(['in-app', 'webhook', 'email'])).min(1),
    recipients: z.array(z.string()).default([]),
    requireAcknowledgement: z.boolean().default(false),
  }),
  createdBy: boundedString('createdBy', 128),
});

export const alertsListQuerySchema = z.object({
  productId: boundedString('productId', 128).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const alertPatchBodySchema = z.object({
  action: z.enum(['acknowledge', 'resolve']),
  acknowledgedBy: boundedString('acknowledgedBy', 128).optional(),
});

export const insuranceCoverageBodySchema = z.object({
  productId: boundedString('productId', 128),
  provider: boundedString('provider', 200),
  policyNumber: boundedString('policyNumber', 100),
  coverageType: boundedString('coverageType', 100),
  coverageAmount: z.number().int().positive(),
  currency: z.string().length(3),
  validFrom: z.number().int().positive(),
  validUntil: z.number().int().nonnegative().default(0),
  documentRef: z.string().max(500).optional(),
  registeredBy: boundedString('registeredBy', 128),
});

export const insuranceListQuerySchema = z.object({
  productId: boundedString('productId', 128),
});

export const insurancePremiumBodySchema = z.object({
  productId: boundedString('productId', 128),
  provider: boundedString('provider', 200),
  coverageType: boundedString('coverageType', 100),
  coverageAmount: z.number().int().positive(),
  currency: z.string().length(3),
  productValue: z.number().nonnegative().default(0),
  hasRecallHistory: z.boolean().default(false),
  transitRiskScore: z.number().min(0).max(10).default(3),
  certificationCount: z.number().int().nonnegative().default(0),
  storageRiskScore: z.number().min(0).max(10).default(3),
});

export const insuranceCertificateBodySchema = z.object({
  issuedBy: boundedString('issuedBy', 100),
});

export const insuranceClaimCreateBodySchema = z.object({
  productId: boundedString('productId', 128),
  description: boundedString('description', 500),
  proofRef: boundedString('proofRef', 500),
  documentHash: z.string().max(128).optional(),
  claimant: boundedString('claimant', 128),
});

export const insuranceClaimUpdateBodySchema = z.object({
  claimId: boundedString('claimId', 128),
  status: z.enum(['pending', 'verified', 'rejected']),
  verifierNotes: z.string().max(500).optional(),
});

export const apiKeyIssueBodySchema = z.object({
  name: boundedString('name', 128),
  tier: z.enum(['partner', 'internal', 'auditor']),
  owner: boundedString('owner', 256),
  description: z.string().max(512).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const attestationCreateBodySchema = z.object({
  productId: boundedString('productId', 128),
  issuerAddress: boundedString('issuerAddress', 256),
  issuerName: boundedString('issuerName', 256),
  trustLevel: z.enum(['verified', 'trusted', 'community']),
  attestationType: z.enum([
    'audit',
    'certification',
    'inspection',
    'compliance',
    'sustainability',
    'custom',
  ]),
  summary: boundedString('summary', 512),
  signedReference: boundedString('signedReference', 2048),
  reportUrl: z.string().url('reportUrl must be a valid URL').optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  metadata: z.string().max(4096, 'metadata must be 4096 characters or fewer').optional(),
});

export const attestationListQuerySchema = z
  .object({
    productId: boundedString('productId', 128).optional(),
    issuerAddress: boundedString('issuerAddress', 256).optional(),
  })
  .refine((value) => Boolean(value.productId || value.issuerAddress), {
    message: 'Provide either productId or issuerAddress query parameter',
    path: [],
  });

export const certificationIssuerCreateBodySchema = z.object({
  issuerAddress: boundedString('issuerAddress', 256),
  name: boundedString('name', 256),
  certTypes: z.array(boundedString('certTypes', 64)).min(1).max(50),
});

export const certificationRecordsListQuerySchema = z.object({
  productId: boundedString('productId', 128),
});

export const certificationRecordCreateBodySchema = z.object({
  productId: boundedString('productId', 128),
  issuerAddress: boundedString('issuerAddress', 256),
  recordId: boundedString('recordId', 128),
  externalCertId: boundedString('externalCertId', 256),
  certType: boundedString('certType', 64),
  documentHash: boundedString('documentHash', 128),
});

export const certificationRecordRevokeBodySchema = z.object({
  productId: boundedString('productId', 128),
  issuerAddress: boundedString('issuerAddress', 256),
});

export const productAssemblyBodySchema = z.object({
  componentIds: z
    .array(boundedString('componentIds', 128), {
      error: 'componentIds must be an array',
    })
    .min(1, 'componentIds must contain at least one item')
    .max(50, 'componentIds must contain at most 50 items'),
  description: z.string({ error: 'description must be a string' }).max(1024).optional().default(''),
  registeredBy: boundedString('registeredBy', 128).optional().default('unknown'),
});

export const warrantyBodySchema = z.object({
  durationSeconds: z.number({ error: 'durationSeconds must be a number' }).int().nonnegative(),
  terms: z.string({ error: 'terms must be a string' }).max(1024).optional().default(''),
  termsRef: z.string({ error: 'termsRef must be a string' }).max(512).optional().default(''),
  issuer: boundedString('issuer', 128).optional().default('unknown'),
});

export const warrantyClaimBodySchema = z.object({
  description: boundedString('description', 1024),
  claimant: boundedString('claimant', 128),
  proofRef: z.string({ error: 'proofRef must be a string' }).max(512).optional().default(''),
});

export const productCompareBodySchema = z.object({
  productIds: z.array(boundedString('productIds', 128)).min(2).max(50),
});

export const productExportBodySchema = z.object({
  productIds: z.array(boundedString('productIds', 128)).min(1).max(500),
  format: z.enum(['json', 'csv']).default('json'),
});

export const productSearchBodySchema = z.object({
  text: z.string().max(512).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(50),
});

export const savedQueryBodySchema = z.object({
  name: boundedString('name', 128),
  query: z.record(z.string(), z.unknown()),
});

export const recallBroadcastBodySchema = z.object({
  productId: boundedString('productId', 128),
  reason: boundedString('reason', 1024),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  stakeholders: z.array(boundedString('stakeholders', 256)).min(1).max(500),
  affectedBatches: z.array(boundedString('affectedBatches', 128)).max(500).default([]),
});

export const recallNotificationAcknowledgeBodySchema = z.object({
  broadcastId: boundedString('broadcastId', 128),
});

export const eventArchiveBodySchema = z.object({
  productId: boundedString('productId', 128),
  stableId: boundedString('stableId', 128),
  reason: z.string().max(512).default(''),
});
export const processClaimBodySchema = z.object({ claimId: boundedString('claimId', 128) });
export const revocationBodySchema = z.object({
  subjectId: boundedString('subjectId', 256),
  type: z.enum(['certification', 'attestation', 'registry_record']),
  productId: boundedString('productId', 128),
  revokedBy: boundedString('revokedBy', 256),
  reason: z.string().max(500).optional(),
});
export const transferPreflightBodySchema = z.object({
  productId: boundedString('productId', 128),
  newOwner: boundedString('newOwner', 256),
  walletAddress: z.string().trim().max(256).optional(),
  hasPendingEscrow: z.boolean().optional(),
});
export const regulatorCertificationBodySchema = z.object({
  productId: boundedString('productId', 128),
  productName: boundedString('productName', 256),
  issuerAddress: boundedString('issuerAddress', 256),
  issuerAuthority: boundedString('issuerAuthority', 256),
  certType: boundedString('certType', 128),
  scope: boundedString('scope', 1024),
  validityDays: z.number().int().nonnegative().default(0),
});
export const regulatorCertificationRevokeBodySchema = z.object({
  actor: boundedString('actor', 256),
  note: z.string().max(1024).optional(),
});
export const webhookSubscriptionCreateBodySchema = z.object({
  name: boundedString('name', 128),
  eventTypes: z.array(z.enum(['TRACKING_EVENT_CREATED', 'PRODUCT_EVENT_CHANGED'])).min(1),
  description: z.string().max(1024).optional(),
  productEventFilter: z
    .object({
      types: z
        .array(
          z.enum([
            'product_registered',
            'product_updated',
            'event_added',
            'actor_authorized',
            'actor_removed',
            'compliance_policy_updated',
          ]),
        )
        .optional(),
      productIds: z.array(boundedString('productIds', 128)).optional(),
    })
    .optional(),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(10).optional(),
      backoffMs: z.number().min(100).max(60000).optional(),
      maxBackoffMs: z.number().min(0).max(86400000).optional(),
    })
    .optional(),
});
export const webhookSubscriptionPatchBodySchema = z.object({
  active: z.boolean().optional(),
  name: boundedString('name', 128).optional(),
  description: z.string().max(1024).optional(),
});
export const gasEstimateQuerySchema = z.object({
  operation: z.enum([
    'register_product',
    'add_tracking_event',
    'batch_register',
    'batch_add_events',
    'get_events_page',
    'transfer_ownership',
  ]),
  batchSize: z.coerce.number().int().min(1).max(50).optional().default(1),
});
export const attestationRevokeBodySchema = z.object({
  reason: z.string().trim().max(1024).optional(),
});

export type CreateAlertBody = z.infer<typeof createAlertBodySchema>;
export type AlertPatchBody = z.infer<typeof alertPatchBodySchema>;
export type InsuranceCoverageBody = z.infer<typeof insuranceCoverageBodySchema>;
export type InsurancePremiumBody = z.infer<typeof insurancePremiumBodySchema>;
export type InsuranceCertificateBody = z.infer<typeof insuranceCertificateBodySchema>;
export type InsuranceClaimCreateBody = z.infer<typeof insuranceClaimCreateBodySchema>;
export type InsuranceClaimUpdateBody = z.infer<typeof insuranceClaimUpdateBodySchema>;
export type ApiKeyIssueBody = z.infer<typeof apiKeyIssueBodySchema>;
export type AttestationCreateBody = z.infer<typeof attestationCreateBodySchema>;
export type CertificationIssuerCreateBody = z.infer<typeof certificationIssuerCreateBodySchema>;
export type CertificationRecordCreateBody = z.infer<typeof certificationRecordCreateBodySchema>;
export type CertificationRecordRevokeBody = z.infer<typeof certificationRecordRevokeBodySchema>;
export type ProductAssemblyBody = z.infer<typeof productAssemblyBodySchema>;
export type WarrantyBody = z.infer<typeof warrantyBodySchema>;
export type WarrantyClaimBody = z.infer<typeof warrantyClaimBodySchema>;
export type ProductCompareBody = z.infer<typeof productCompareBodySchema>;
export type ProductExportBody = z.infer<typeof productExportBodySchema>;
export type ProductSearchBody = z.infer<typeof productSearchBodySchema>;
export type SavedQueryBody = z.infer<typeof savedQueryBodySchema>;
export type RecallBroadcastBody = z.infer<typeof recallBroadcastBodySchema>;
export type RecallNotificationAcknowledgeBody = z.infer<
  typeof recallNotificationAcknowledgeBodySchema
>;
export type EventArchiveBody = z.infer<typeof eventArchiveBodySchema>;
export type ProcessClaimBody = z.infer<typeof processClaimBodySchema>;
export type RevocationBody = z.infer<typeof revocationBodySchema>;
export type TransferPreflightBody = z.infer<typeof transferPreflightBodySchema>;
export type RegulatorCertificationBody = z.infer<typeof regulatorCertificationBodySchema>;
export type RegulatorCertificationRevokeBody = z.infer<
  typeof regulatorCertificationRevokeBodySchema
>;
export type WebhookSubscriptionCreateBody = z.infer<typeof webhookSubscriptionCreateBodySchema>;
export type WebhookSubscriptionPatchBody = z.infer<typeof webhookSubscriptionPatchBodySchema>;
export type GasEstimateQuery = z.infer<typeof gasEstimateQuerySchema>;
export type AttestationRevokeBody = z.infer<typeof attestationRevokeBodySchema>;
