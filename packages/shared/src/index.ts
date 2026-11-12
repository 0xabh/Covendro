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
