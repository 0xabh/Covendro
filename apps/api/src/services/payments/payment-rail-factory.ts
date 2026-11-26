import { ApiError } from "../../errors.js";
import type { PaymentRail } from "@covendro/shared";
import { MockPaymentRail } from "./mock-payment-rail.js";
import { NearIntentsPaymentRail } from "./near-intents-payment-rail.js";

export function getPaymentRail(): PaymentRail {
  if (process.env.COVENDRO_FORCE_MOCKS === "true" && process.env.DEMO_MODE !== "false") return new MockPaymentRail();
  const jwt = process.env.NEAR_INTENTS_JWT;
  const originAssetId = process.env.NEAR_INTENTS_ORIGIN_ASSET_ID;
  const destinationAssetId = process.env.NEAR_INTENTS_DESTINATION_ASSET_ID;
  if (jwt && originAssetId && destinationAssetId) {
    return new NearIntentsPaymentRail({ jwt, originAssetId, destinationAssetId, pilotPreview: process.env.DEMO_MODE === "false" });
  }
  if (process.env.DEMO_MODE === "false") throw new ApiError(503, "PAYMENT_RAIL_UNAVAILABLE", "Configure the preview payment rail for this workspace");
  return new MockPaymentRail();
}
