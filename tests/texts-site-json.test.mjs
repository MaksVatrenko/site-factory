import { describe, it, expect } from 'vitest';
import { generateSiteJson } from '../factory/texts/site-json.mjs';
import { answer } from './helpers/openai.mjs';

const CONFIG = {
  apiKey: 'sentinel-openai-key-site-1a55',
  apiUrl: 'https://openai.test/v1/responses',
  model: 'gpt-5.6-luna',
  priceInput: 0.2,
  priceCachedInput: 0.02,
  priceOutput: 1.2,
};

const ANSWER = {
  tagline: 'Juegos en vivo cada dia.',
  navLabels: ['Casino', 'Bonos'],
  footer: {
    ageWarning: '18+',
    ageText: 'Debes tener 18 anos.',
    quickLinksTitle: 'ENLACES',
    paymentsTitle: 'PAGOS',
    copyright: '© Acme 2026.',
  },
  blockLabels: { toc: 'Contenido', links: 'Otras paginas', faq: 'Preguntas' },
};

const run = (fetchFn) =>
  generateSiteJson(
    {
      brand: 'Acme',
      geo: 'Mexico',
      locale: 'es-MX',
      domain: 'acme.mx',
      pages: ['home', 'casino', 'bonus'],
      instructions: 'RULES',
    },
    { config: CONFIG, fetchFn, sleep: async () => {} },
  );

describe('generateSiteJson', () => {
  it('builds site.json with the menu in the language of the site', async () => {
    const { site } = await run(async () => answer(ANSWER));
    expect(site.domain).toBe('acme.mx');
    expect(site.locale).toBe('es-MX');
    expect(site.brand).toEqual({ name: 'Acme', tagline: 'Juegos en vivo cada dia.' });
    // Addresses are the factory's, labels are the model's: a page added to the list turns up in the
    // menu on its own.
    expect(site.nav).toEqual([
      { label: 'Casino', href: '/casino' },
      { label: 'Bonos', href: '/bonus' },
    ]);
  });

  it('leaves the home page out of the menu', async () => {
    let body;
    const { site } = await run(async (_url, init) => {
      body = JSON.parse(init.body);
      return answer(ANSWER);
    });
    expect(site.nav.map((item) => item.href)).not.toContain('/');
    // Two menu items for three pages: the schema asks for exactly as many labels as there are
    // pages besides home.
    expect(body.text.format.schema.properties.navLabels.minItems).toBe(2);
  });

  it('never invents payment methods', async () => {
    const { site } = await run(async () => answer(ANSWER));
    expect(site.footer.payments).toEqual([]);
    expect(site.footer.paymentsTitle).toBe('PAGOS');
  });

  it('hands the service-block labels to the page assembler', async () => {
    const { labels } = await run(async () => answer(ANSWER));
    expect(labels).toEqual({ toc: 'Contenido', links: 'Otras paginas', faq: 'Preguntas' });
  });

  it('reports what it cost', async () => {
    const { cost } = await run(async () => answer(ANSWER));
    expect(cost).toBeGreaterThan(0);
  });
});
