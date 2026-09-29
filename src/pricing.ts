// USD per million tokens [input, output]. Unknown models fall back to Sonnet 4.6 pricing.
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-6': [3, 15],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
  'claude-opus-5-5': [4, 20],
};

export function tokenCost(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const [input, output] = PRICES[model] ?? PRICES['claude-sonnet-4-6'];
  return (usage.input_tokens * input + usage.output_tokens * output) / 1_000_000;
}
