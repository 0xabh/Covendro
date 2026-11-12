import type { InvoiceAIProvider } from "@covendro/shared";
import { MockInvoiceAIProvider } from "./mock-invoice-ai-provider.js";
import { NearAICloudProvider } from "./near-ai-cloud-provider.js";

export function getInvoiceAIProvider(): InvoiceAIProvider {
  if (process.env.COVENDRO_FORCE_MOCKS === "true") return new MockInvoiceAIProvider();
  if (process.env.NEAR_AI_CLOUD_API_KEY) return new NearAICloudProvider();
  return new MockInvoiceAIProvider();
}
