process.env.COVENDRO_FORCE_MOCKS = "true";
process.env.DEMO_MODE = "true";

delete process.env.DATABASE_URL;
delete process.env.NEAR_AI_CLOUD_API_KEY;
delete process.env.NEAR_INTENTS_JWT;
delete process.env.NEAR_INTENTS_ORIGIN_ASSET_ID;
delete process.env.NEAR_INTENTS_DESTINATION_ASSET_ID;
