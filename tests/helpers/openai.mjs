// The shapes the Responses API answers with, for tests. Shared because six test files need them,
// and a copy per file is six places for the shape to drift from the one the client really parses.
export function answer(data, usage = {}) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 }, ...usage },
    }),
    { status: 200 },
  );
}

// A run that hit the output limit. The API reports this itself rather than leaving broken JSON.
// The model still ran before hitting the cap, so — like `answer` — this carries token counters too;
// a caller that prices the failure needs real numbers to do it with.
export function truncated(reason = 'max_output_tokens', usage = {}) {
  return new Response(
    JSON.stringify({
      status: 'incomplete',
      incomplete_details: { reason },
      output: [],
      usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 }, ...usage },
    }),
    { status: 200 },
  );
}

export function refused(text = 'I cannot help with that', usage = {}) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: text }] }],
      usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 }, ...usage },
    }),
    { status: 200 },
  );
}

export function failed(status, error = { message: 'nope' }) {
  return new Response(JSON.stringify({ error }), { status });
}
