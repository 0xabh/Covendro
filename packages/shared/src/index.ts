export type DemoMode = "mock" | "configured";

export type HealthResponse = {
  status: "ok";
  service: "covendro-api";
  demoMode: boolean;
  database: "configured" | "default-local";
  requestId: string;
};

export {
  invoiceInputSchema,
  invoiceLineItemInputSchema,
  lineItemToMinorUnits,
  sourceDocumentSchema,
  supportedChains,
  supportedCurrencies,
  toMinorUnits,
} from "./invoice-schemas.js";
export type { InvoiceInput, InvoiceValidationError } from "./invoice-schemas.js";
export {
  csvToList,
  policyToSnapshot,
  treasuryPolicyUpdateSchema,
  treasuryDecisions,
} from "./treasury.js";
export type {
  DecisionResult,
  PolicyEvaluationInput,
  TreasuryDecision,
  TreasuryPolicySnapshot,
  TreasuryPolicyUpdate,
  VendorRiskInput,
  VendorRiskResult,
} from "./treasury.js";
export { canTransitionInvoice, invoiceStatuses } from "./workflow.js";
export type { InvoiceStatus } from "./workflow.js";
export type {
  PaymentOutcome,
  PaymentQuote,
  PaymentQuoteInput,
  PaymentQuoteMode,
  PaymentRail,
  PaymentStatus,
  PaymentStatusResult,
  SupportedAsset,
} from "./payment.js";
export type {
  Anomaly,
  AnomalyResult,
  AnomalySeverity,
  ExtractedInvoiceFields,
  InvoiceAIInput,
  InvoiceAIProvider,
  InvoiceExtractionResult,
  VerificationState,
} from "./ai.js";
