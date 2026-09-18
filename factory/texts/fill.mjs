import { askJson } from './openai.mjs';
import { faqSchema, sectionSchema } from './schema.mjs';

// Stage two: the words. One request per section, each small enough that running into the output
// limit is a surprise rather than a routine hazard — which is the whole reason the page is not
// written in one go.

const DEFAULT_ATTEMPTS = 3;

// Only a refusal is worth asking again: the model can genuinely answer differently the second time.
// A truncated answer cannot — it means the answer hit the model's own output cap, no production
// caller ever passes maxOutputTokens, and an unchanged request against an unchanged cap will run
// into exactly the same wall. Retrying it would not buy a better answer, only bill for the same
// full-length generation two or three times over.
const WORTH_ASKING_AGAIN = new Set(['refused']);

async function askWithRetries(request, options, attempts) {
  let last;
  // Every retried refusal is its own billed request — OpenAI ran the model and charged for it each
  // time, not only on the attempt that finally gave up. Spent is carried across the loop so the
  // error thrown at the end, once every attempt is spent, reports what all of them cost together
  // rather than only the last one's share.
  let spent = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await askJson(request, options);
    } catch (error) {
      if (!WORTH_ASKING_AGAIN.has(error?.kind)) throw error;
      spent += error.cost ?? 0;
      last = error;
    }
  }
  last.cost = spent;
  throw last;
}

export async function fillSection(
  { section, siblings, brand, locale, instructions, attempts = DEFAULT_ATTEMPTS },
  options,
) {
  // Every element the plan chose, with nothing taken off. A block's own heading used to have to be
  // subtracted here, because content.json's "title" meant the heading and the subheading at once
  // and the plan could not tell them apart. blocks.json separates them: the heading is a nature of
  // the block, written by the factory from the plan so the contents and the heading can never
  // disagree, and `title` in a block's content is the optional h3 inside it. Subtracting one now
  // would eat that h3 — asked for by the plan, never written, never seen.
  const wanted = section.elements;

  const brief = [
    `Brand: ${brand}`,
    `Language: ${locale}`,
    `Section heading: ${section.heading}`,
    `What this section covers: ${section.brief}`,
    `Write these elements, in this order: ${wanted.join(', ')}`,
    // Nothing is said about pictures, on purpose. A picture belongs to a block by its nature and is
    // placed by the factory, so there is no `image` element for the model to write and no name for
    // it to get wrong. Mentioning one at all would only invite it to write something that is then
    // thrown away — which is how a picture nobody declared used to end up in the middle of a page.
    section.links.length > 0 ? `Link to these pages from inside the text, using [words](/path): ${section.links.join(', ')}` : '',
    // The neighbours are named but not quoted: enough for the model to stay off their topics,
    // cheap enough to send with every section.
    `Other sections of this page, which you must not duplicate: ${siblings.join('; ')}`,
  ]
    .filter(Boolean)
    .join('\n');

  const { data, cost, usage } = await askWithRetries(
    {
      instructions,
      input: brief,
      schemaName: 'section_content',
      schema: sectionSchema(wanted),
      cacheKey: 'site-factory-fill',
    },
    options,
    attempts,
  );
  return { items: data.items, cost, usage };
}

export async function fillFaq(
  { questions, brand, locale, instructions, attempts = DEFAULT_ATTEMPTS },
  options,
) {
  const brief = [
    `Brand: ${brand}`,
    `Language: ${locale}`,
    'Answer each question in two or three sentences, in the same order:',
    ...questions.map((question, index) => `${index + 1}. ${question}`),
  ].join('\n');

  const { data, cost, usage } = await askWithRetries(
    { instructions, input: brief, schemaName: 'faq_answers', schema: faqSchema(questions.length), cacheKey: 'site-factory-faq' },
    options,
    attempts,
  );
  return { answers: data.answers, cost, usage };
}
