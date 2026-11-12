export const verificationStates = ["MOCKED", "UNVERIFIED", "VERIFIED", "VERIFICATION_FAILED"] as const;
export type VerificationState = (typeof verificationStates)[number];

export const anomalySeverities = ["INFO", "WARNING", "BLOCKING"] as const;
export type AnomalySeverity = (typeof anomalySeverities)[number];

export type InvoiceAIInput = {
  invoiceId: string;
  vendorName: string;
  vendorAddress: string;
  vendorChain?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string | null;
  currency: string;
  amountMinor: number;
  paymentDestination: string;
  paymentChain?: string | null;
  memo?: string | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmountMinor: number;
    totalAmountMinor: number;
  }>;
  context?: {
    duplicateInvoiceNumber?: boolean;
    duplicateFileHash?: boolean;
    vendorAllowlisted?: boolean;
    previousPaymentCount?: number;
    maxPaymentPerTransactionMinor?: number;
  };
};

export type ExtractedInvoiceFields = {
  vendorName: string;
  vendorAddress: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  currency: string;
  amount: string;
  paymentDestination: string;
  paymentChain?: string;
  memo?: string;
  lineItems: Array<{
    description: string;
    quantity: string;
    unitAmount: string;
  }>;
};

export type InvoiceExtractionResult = {
  fields: ExtractedInvoiceFields;
  provider: string;
  model: string;
  confidence: number;
  verificationState: VerificationState;
  verificationExplanation: string;
  requestId?: string;
};

export type Anomaly = {
  code: string;
  severity: AnomalySeverity;
  message: string;
};

export type AnomalyResult = {
  anomalies: Anomaly[];
  provider: string;
  model: string;
  requestId?: string;
};

export interface InvoiceAIProvider {
  readonly name: string;
  readonly model: string;
  extractInvoice(input: InvoiceAIInput): Promise<InvoiceExtractionResult>;
  detectAnomalies(input: InvoiceAIInput): Promise<AnomalyResult>;
}
