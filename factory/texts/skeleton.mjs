// How big each page of this site is: how many sections, how many FAQ questions, how many pictures.
// Rolled here, before a single request is made, so the model never chooses the shape of a page and
// therefore cannot break it. Two sites made from the same template get different shapes, which is
// what keeps a network of them from looking like one stamped-out set.
//
// The roll is seeded by the site's folder name, so it is reproducible: a run that stopped halfway
// picks up with the same skeleton instead of reshuffling the pages that already exist.

// FNV-1a: a small, well-behaved string hash. Only used to turn a folder name into a seed number.
function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

// mulberry32: a tiny seeded generator. Math.random cannot be seeded, and nothing here needs
// cryptographic quality — only repeatability.
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between([min, max], random) {
  if (max <= min) return min;
  return min + Math.floor(random() * (max - min + 1));
}

function blockOf(content, type) {
  return content.blocks.find((block) => block.type === type);
}

export function rollSkeleton({ content, pages, seed }) {
  const section = blockOf(content, 'section');
  const faq = blockOf(content, 'faq');
  const sectionRange = section?.count ?? [1, 1];
  const faqRange = faq?.content?.toggle ?? [0, 0];
  const bonus = content.home?.sectionsBonus ?? 0;

  const skeleton = {};
  // Sorted, so the answer depends on which pages were asked for and not on the order they arrived
  // in: the same site described two ways must come out the same.
  for (const page of [...pages].sort()) {
    // Each page gets its own generator, seeded by site and page together. Without this, adding one
    // page to the list would shift every later page's numbers.
    const random = mulberry32(hashSeed(`${seed}:${page}`));
    skeleton[page] = {
      sections: between(sectionRange, random) + (page === 'home' ? bonus : 0),
      faq: between(faqRange, random),
      images: between(content.images ?? [0, 0], random),
    };
  }
  return skeleton;
}
