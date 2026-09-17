import { askJson } from './openai.mjs';
import { object, string } from './schema.mjs';

// Everything a reader sees that is not a page: the menu, the footer, the age warning, the tagline,
// and the headings of the blocks the factory builds itself. Without this, a Spanish site would
// arrive with an English menu — the pages translated and the frame left behind.
//
// Addresses are the factory's and labels are the model's, so a page added to the list turns up in
// the menu and the footer on its own.

function siteSchema(menuSize) {
  return object({
    tagline: string,
    navLabels: { type: 'array', minItems: menuSize, maxItems: menuSize, items: string },
    footer: object({
      ageWarning: string,
      ageText: string,
      quickLinksTitle: string,
      paymentsTitle: string,
      copyright: string,
    }),
    // The factory writes these blocks itself, so their headings are the only part of them the model
    // is asked for — in the site's language, like everything else here.
    blockLabels: object({ toc: string, links: string, faq: string }),
  });
}

export async function generateSiteJson({ brand, geo, locale, domain, pages, instructions }, options) {
  const menu = pages.filter((page) => page !== 'home');
  const brief = [
    `Brand: ${brand}`,
    `Geo: ${geo}`,
    `Language: ${locale}`,
    `Menu pages, in this order: ${menu.join(', ')}`,
    'Write the site frame: a short tagline, one menu label per page above, the footer texts and the',
    'headings of the contents, other-pages and FAQ blocks. Everything in the language above.',
  ].join('\n');

  const { data, cost, usage } = await askJson(
    { instructions, input: brief, schemaName: 'site_frame', schema: siteSchema(menu.length), cacheKey: 'site-factory-site' },
    options,
  );

  return {
    site: {
      domain,
      locale,
      brand: { name: brand, tagline: data.tagline },
      nav: menu.map((page, index) => ({ label: data.navLabels[index], href: `/${page}` })),
      footer: {
        ...data.footer,
        // Payment methods are a fact about the client's business, not something to write. The rules
        // forbid inventing them, so the list is left for the owner to fill in.
        payments: [],
      },
    },
    labels: data.blockLabels,
    cost,
    usage,
  };
}
