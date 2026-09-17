// Turns a plan and a pile of filled sections into one page of our own content format.
//
// Everything structural happens here rather than in the model: the table of contents is built from
// the section headings, each section's own heading is written from the plan, and the service blocks
// are labelled in the site's language. The couplings that a model breaks most often — a contents
// list that does not match the sections, a second h1, a link to a page that was never made — are
// not checked here so much as made impossible by construction.

// [words](/target). Deliberately narrow: no nesting, no whitespace tricks, the same shape the
// engine's own link parser accepts (see docs/content-format.md).
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function hrefsOf(pages) {
  return new Set(pages.map((page) => (page === 'home' ? '/' : `/${page}`)));
}

// A link is kept only when it points at a page this site actually has, or at an anchor on this one.
// Anything else — an invented external address, a page from the example site — loses its brackets
// and stays as plain words, which reads fine and links nowhere.
function keepLinks(text, allowed, warnings) {
  return String(text).replace(LINK, (whole, label, href) => {
    if (href.startsWith('#') || allowed.has(href)) return whole;
    warnings.push(`ссылка ${href} ведёт в никуда — осталась текстом`);
    return label;
  });
}

function toElement(item, { images, allowed, warnings }) {
  const link = (text) => keepLinks(text, allowed, warnings);
  const picture = (name) => {
    if (name && images.has(name)) return name;
    if (name) warnings.push(`картинка «${name}» не объявлена планом — убрана`);
    return '';
  };

  switch (item.kind) {
    case 'title':
      return { type: 'title', [item.level]: item.text };
    case 'text':
      return { type: 'text', text: link(item.text) };
    case 'list':
      return { type: 'list', items: item.items.map(link) };
    case 'table':
      return { type: 'table', columns: item.columns, rows: item.rows.map((row) => row.map(link)) };
    case 'cards':
      return {
        type: 'cards',
        items: item.cards.map((card) => {
          const image = picture(card.image);
          return { title: card.title, text: link(card.text), ...(image ? { image } : {}) };
        }),
      };
    case 'toggle':
      return { type: 'toggle', title: item.title, text: link(item.text) };
    case 'image': {
      const image = picture(item.name);
      return image ? { image } : null;
    }
    default:
      // Strict mode should make this unreachable; dropping beats writing something the renderer
      // would silently skip anyway.
      warnings.push(`элемент неизвестного вида «${item.kind}» — пропущен`);
      return null;
  }
}

// Lengths from content.json are reported, never enforced. Trimming a paragraph to fit would cut it
// mid-sentence, which is worse than a long paragraph, and the engine imposes no limit of its own —
// these numbers exist so the layout stays pleasant, not so the build can fail.
function noteLength(what, value, range, warnings) {
  if (!range) return;
  const [min, max] = Array.isArray(range) ? range : [0, range];
  const length = String(value).length;
  if (length > max) warnings.push(`${what}: ${length} знаков вместо ${max} — оставлено как есть`);
  else if (min > 0 && length < min) warnings.push(`${what}: ${length} знаков вместо ${min} — оставлено как есть`);
}

export function assemblePage({ plan, sections, faq, pages, labels, lengths = {} }) {
  const warnings = [];
  const allowed = hrefsOf(pages);
  const images = new Set(
    [plan.heroImage, ...plan.sections.map((section) => section.image)].filter(Boolean),
  );
  const context = { images, allowed, warnings };

  const hero = {
    type: 'hero',
    content: [
      { type: 'title', h1: plan.h1 },
      ...(plan.heroImage ? [{ image: plan.heroImage }] : []),
      ...plan.heroText.map((text) => ({ type: 'text', text: keepLinks(text, allowed, warnings) })),
    ],
  };

  // Built from the headings, not from anything the model wrote: one entry per section, same order.
  const toc = {
    type: 'toc',
    content: [
      { type: 'title', h2: labels.toc },
      { type: 'list', items: sections.map((section) => section.heading) },
    ],
  };

  const body = sections.map((section) => ({
    type: 'section',
    content: [
      { type: 'title', h2: section.heading },
      ...section.items
        .map((item) => {
          if (item.kind === 'text') noteLength('text абзаца', item.text, lengths.text, warnings);
          return toElement(item, context);
        })
        .filter(Boolean),
    ],
  }));

  // The "other pages" grid is drawn from site.json's own menu, so this block only needs its title.
  const links = { type: 'links', content: [{ type: 'title', h2: labels.links }] };

  const questions = {
    type: 'faq',
    content: [
      { type: 'title', h2: labels.faq },
      ...faq.map((entry) => ({
        type: 'toggle',
        title: entry.question,
        text: keepLinks(entry.answer, allowed, warnings),
      })),
    ],
  };

  noteLength('title страницы', plan.title, lengths.title, warnings);
  noteLength('description страницы', plan.description, lengths.description, warnings);

  return {
    page: {
      title: plan.title,
      description: plan.description,
      blocks: [hero, toc, ...body, links, questions],
    },
    warnings,
  };
}
