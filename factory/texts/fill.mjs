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
  { section, siblings, brand, locale, page, lengths = {}, instructions, attempts = DEFAULT_ATTEMPTS },
  options,
) {
  // The elements of this block, in the example's own order, with nothing taken off. The block's own
  // heading is not among them: the factory writes it from the plan, so the table of contents and
  // the heading can never disagree, and asking for it here would print it on the page twice.
  const wanted = section.elements;

  // Asked one per line, each with its own size, because a size belongs to a place and not to a
  // kind. The schema cannot carry any of this: strict mode pins how many elements there are, not
  // how many rows are inside the third of them, and it cannot pin a string's length at all. So it
  // is asked for in words here, and the counts are cut back to size on arrival (assemble.mjs).
  //
  // One number for the whole page is what this replaced, and it was wrong in a way that showed:
  // a page whose paragraphs ran 51 to 375 characters came back with every one of them at the
  // median, 131. The first screen, reliably the longest paragraph of the page, lost two thirds.
  const line = (element, at) => {
    const parts = [];
    if (element.count > 0) parts.push(`${element.count} items`);
    if (element.length > 0) parts.push(`about ${element.length} characters${element.count > 0 ? ' each' : ''}`);
    return `${at + 1}. ${element.kind}${parts.length > 0 ? ` — ${parts.join(', ')}` : ''}`;
  };

  const brief = [
    `Brand: ${brand}`,
    `Language: ${locale}`,
    `Section heading: ${section.heading}`,
    `What this section covers: ${section.brief}`,
    'Write exactly these elements, in this order, each to the size given (give or take a fifth):',
    ...wanted.map(line),
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
      schema: sectionSchema(wanted.map((element) => element.kind)),
      // Named by page, like every other call of this run: the instructions hold this page's own
      // examples, and a key shared across pages would have them evicting one another.
      cacheKey: `site-factory-fill:${page}`,
    },
    options,
    attempts,
  );
  return { items: data.items, cost, usage };
}

export async function fillFaq(
  { questions, brand, locale, page, lengths = {}, instructions, attempts = DEFAULT_ATTEMPTS },
  options,
) {
  // The example's own answers set the length; "two or three sentences" is the fallback for an
  // example whose FAQ had none to measure.
  const long = lengths.answer > 0
    ? `Answer each question in about ${lengths.answer} characters, in the same order:`
    : 'Answer each question in two or three sentences, in the same order:';
  const brief = [
    `Brand: ${brand}`,
    `Language: ${locale}`,
    long,
    ...questions.map((question, index) => `${index + 1}. ${question}`),
  ].join('\n');

  const { data, cost, usage } = await askWithRetries(
    { instructions, input: brief, schemaName: 'faq_answers', schema: faqSchema(questions.length), cacheKey: `site-factory-faq:${page}` },
    options,
    attempts,
  );
  return { answers: data.answers, cost, usage };
}
