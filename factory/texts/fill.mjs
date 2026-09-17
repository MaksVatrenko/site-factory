import { askJson } from './openai.mjs';
import { faqSchema, sectionSchema } from './schema.mjs';

// Stage two: the words. One request per section, each small enough that running into the output
// limit is a surprise rather than a routine hazard — which is the whole reason the page is not
// written in one go.

const DEFAULT_ATTEMPTS = 3;

// Two failures are the model's, not the request's: refusing, and running out of room. Both are
// worth asking again, because the same request can succeed the second time. Everything else —
// a rejected request, a bad key, an empty balance — will fail the same way forever, so retrying it
// would only spend time and money.
const WORTH_ASKING_AGAIN = new Set(['refused', 'truncated']);

async function askWithRetries(request, options, attempts) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await askJson(request, options);
    } catch (error) {
      if (!WORTH_ASKING_AGAIN.has(error?.kind)) throw error;
      last = error;
    }
  }
  throw last;
}

export async function fillSection(
  { section, siblings, brand, locale, instructions, attempts = DEFAULT_ATTEMPTS },
  options,
) {
  // The section's own heading is written by the factory, from the plan, so that the table of
  // contents and the heading itself can never disagree. The plan still lists a "title" element,
  // because the rendered section really does have one — so exactly one is taken off here, leaving
  // any second one as the subheading the model is meant to write.
  let headingTaken = false;
  const wanted = section.elements.filter((element) => {
    if (element === 'title' && !headingTaken) {
      headingTaken = true;
      return false;
    }
    return true;
  });

  const brief = [
    `Brand: ${brand}`,
    `Language: ${locale}`,
    `Section heading: ${section.heading}`,
    `What this section covers: ${section.brief}`,
    `Write these elements, in this order: ${wanted.join(', ')}`,
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
