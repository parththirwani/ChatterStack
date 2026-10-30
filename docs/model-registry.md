# Model registry

[`apps/web/src/config/models.ts`](../apps/web/src/config/models.ts) is the single source of truth
for the models ChatterStack offers. The composer, `GET /api/models`, cost
calculation and council pickers all read from it.

## What is included

The registry mirrors the text-chat models on [t3.chat](https://t3.chat) that
OpenRouter also serves. It was last synced on **2026-10-27** against
`https://openrouter.ai/api/v1/models`.

Rules used to build the list:

- Include t3.chat models that are current: `retiredOn` is `null` and they are
  not disabled.
- Include a model only when its OpenRouter slug resolves in the live catalog.
- Keep one entry per OpenRouter slug, even when t3.chat exposes several names
  for the same model.
- Include a model only when a live one-prompt check routes to it. OpenRouter
  lists `openai/o3-mini` and `openai/o4-mini`, but its OpenAI provider returns
  `model_not_found` for both (checked 2026-10-27), so they are omitted.
- Exclude image-generation models (Nano Banana, GPT Image, Imagen). ChatterStack
  streams text responses and accepts images as input, but does not generate
  images.
- Keep the four original ChatterStack defaults in AI Council.

| Company | Models |
| --- | ---: |
| OpenAI | 22 |
| Anthropic | 15 |
| DeepSeek | 11 |
| Z.ai | 11 |
| Google | 7 |
| Meta | 6 |
| Moonshot AI | 6 |
| MiniMax | 5 |
| Qwen | 5 |
| xAI | 5 |
| Xiaomi | 2 |
| **Total** | **95** |

## Updating

1. Fetch the live OpenRouter catalog and compare it with t3.chat's model
   picker. Model IDs, context length, maximum output, pricing and
   `reasoning.supported_efforts` all come from OpenRouter.
2. Add, remove or edit entries in `apps/web/src/config/models.ts`. Keep the default
   model first; the rest are grouped by `company` in the composer.
3. Run `npm run test:unit` for the offline registry checks (unique ids, full
   metadata, existing logo files, valid reasoning levels).
4. With an OpenRouter key, run the live routing check. It sends one short
   prompt to every registered model and fails if OpenRouter reports a
   different model or no choice:

   ```bash
   OPENROUTER_API_KEY=sk-or-... npm run test:models
   ```

Pricing is informational and may change upstream. Unknown or retired models
that still appear in old conversations are rendered from the fallback metadata
in [`apps/web/src/lib/models.ts`](../apps/web/src/lib/models.ts).
