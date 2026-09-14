// Brings one page's blocks into the single shape the templates render.
//
// On disk every block is { type, content: [ … ] }, and a heading carries its tag as the key:
// { "type": "title", "h2": "…" }. A template should not have to know that spelling, nor look a
// picture's name up in images.json, nor count h1s across a page it only ever sees one block of —
// so all three happen here, once, with the whole page in view:
//
//   - a title becomes { type: 'title', tag, text };
//   - a picture — { "image": "main" }, or an `image` field on any other element — becomes the
//     picture's data, or disappears with a warning when it cannot be found;
//   - the first h1 on the page stays h1, every later one becomes h2.
//
// Nothing here knows any other element. text, list, table, cards, toggle and whatever comes next
// pass through untouched, to be drawn — or dropped with a warning — by the template.

const TITLE_KEYS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(entry) {
  return typeof entry.type === 'string' ? entry.type.trim() : '';
}

// A standalone picture is an entry that names a picture and is not some other element. It is
// written { "image": "main" }, or { "type": "image", "image": "main" } by anyone writing it by
// analogy with every other element — both mean the same thing, and neither is worth a warning.
function isPictureEntry(entry) {
  const type = typeOf(entry);
  return (type === '' || type === 'image') && Object.hasOwn(entry, 'image');
}

// The first h1–h6 key in the order it was written wins. A title with none — which is exactly what
// a title still written the old way, { tag, text }, looks like — has nothing to show.
function normalizeTitle(entry, report) {
  const keys = Object.keys(entry).filter((key) => TITLE_KEYS.includes(key));
  if (keys.length === 0) {
    report('у заголовка нет ключа h1–h6 — пропущен');
    return null;
  }
  const [tag] = keys;
  if (keys.length > 1) report(`у заголовка несколько ключей (${keys.join(', ')}) — взят ${tag}`);
  const text = typeof entry[tag] === 'string' ? entry[tag].trim() : '';
  if (text === '') {
    report(`заголовок ${tag} пустой — пропущен`);
    return null;
  }
  return { type: 'title', tag, text };
}

function resolvePicture(name, resolveImage, report) {
  if (typeof name !== 'string') {
    report('поле image должно быть именем картинки из images.json — не выводится');
    return null;
  }
  const { image, problem, missingAlt } = resolveImage(name);
  if (!image) {
    report(`${problem} — не выводится`);
    return null;
  }
  if (missingAlt) report(`у картинки «${name}» нет alt — выводится без описания`);
  return image;
}

// Replaces every `image` key anywhere inside a value — on the element, on a card in its `items`,
// on anything nested deeper — with the picture it names, or removes the key when the name does not
// resolve. Walking every key instead of known element shapes is what lets a new element carry a
// picture without this file learning about it.
function resolveNested(value, resolveImage, report) {
  if (Array.isArray(value)) return value.map((item) => resolveNested(item, resolveImage, report));
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'image') {
      const picture = resolvePicture(inner, resolveImage, report);
      if (picture) result.image = picture;
    } else {
      result[key] = resolveNested(inner, resolveImage, report);
    }
  }
  return result;
}

const NO_REGISTRY = (name) => ({
  image: null,
  problem: `картинки «${name}» нет в images.json`,
  missingAlt: false,
});

export function normalizePageContent(blocks, { slug = '', resolveImage } = {}) {
  const warnings = [];
  const prefix = slug === '' ? '' : `${slug}: `;
  const report = (message) => warnings.push(`${prefix}${message}`);
  const resolve = typeof resolveImage === 'function' ? resolveImage : NO_REGISTRY;

  let seenH1 = false;
  let hasContent = false;

  const normalized = (Array.isArray(blocks) ? blocks : []).filter(isPlainObject).map((block) => {
    const props = isPlainObject(block.props) ? block.props : {};

    // Anything next to `content` is what a block written in the old format leaves behind (heading,
    // paragraphs, items). Rendering nothing for it silently would make that block just vanish.
    const extra = Object.keys(props).filter((key) => key !== 'content');
    if (extra.length > 0) {
      report(
        `у блока «${block.type}» поля ${extra.join(', ')} не используются — содержимое блока пишется в content`,
      );
    }

    let entries = props.content === undefined ? [] : props.content;
    if (!Array.isArray(entries)) {
      report(`у блока «${block.type}» content не список — блок пуст`);
      entries = [];
    }

    const content = [];
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue;

      if (typeOf(entry) === 'title') {
        const title = normalizeTitle(entry, report);
        if (!title) continue;
        if (title.tag === 'h1') {
          if (seenH1) {
            report(`второй h1 на странице стал h2: «${title.text}»`);
            title.tag = 'h2';
          }
          seenH1 = true;
        }
        content.push(title);
      } else if (isPictureEntry(entry)) {
        const picture = resolvePicture(entry.image, resolve, report);
        if (picture) {
          const rest = Object.fromEntries(
            Object.entries(entry).filter(([key]) => key !== 'image' && key !== 'type'),
          );
          content.push({ ...resolveNested(rest, resolve, report), type: 'image', image: picture });
        }
      } else {
        content.push(resolveNested(entry, resolve, report));
      }
    }

    if (content.length > 0) hasContent = true;
    return { type: block.type, props: { content } };
  });

  // A page with nothing on it has nothing to title; a page with content and no h1 is the one that
  // loses in search.
  if (hasContent && !seenH1) report('на странице нет h1');

  return { blocks: normalized, warnings };
}
