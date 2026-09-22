const form = document.querySelector('#generate-form');
const submitButton = document.querySelector('#submit');
const statusLine = document.querySelector('#status');
const logBox = document.querySelector('#log');
const result = document.querySelector('#result');
const resultOpen = document.querySelector('#result-open');
const resultZip = document.querySelector('#result-zip');
const templateNote = document.querySelector('#template-note');

function setStatus(text, kind = '') {
  statusLine.textContent = text;
  statusLine.className = kind ? `status is-${kind}` : 'status';
}

function appendLog(line) {
  logBox.textContent += `${line}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

// The site folder is typed, not picked: it may be one that exists or one this run is about to
// make, and a select can only offer the first kind.
function fillDatalist(list, values) {
  list.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement('option');
      option.value = value.id ?? value;
      if (value.name) option.label = value.name;
      return option;
    }),
  );
}

function fillSelect(select, values) {
  select.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement('option');
      option.value = value.id ?? value;
      option.textContent = value.name ?? value;
      return option;
    }),
  );
}

document.querySelector('#tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  for (const button of document.querySelectorAll('.tab')) {
    button.classList.toggle('is-active', button === tab);
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab);
  }
});

// Every geo/language select keeps this as its first option. Both fields are meaningfully empty: a
// blank geo means "take it from site.json" when nothing is being written, and a blank language
// means "work it out from the geo" (see generateSite). fillSelect reads value.id/value.name, and
// `??` only falls back on null/undefined, so an id/name of '' survives as a real, selectable empty
// option instead of being replaced by anything.
const BLANK_OPTION = { id: '', name: '' };

// Wires the geo select to the language select: picking a geo preselects the language the table has
// for it. The person stays free to change the language afterwards; this only runs again on the next
// geo change, never on its own.
function syncLocaleWithGeo(geoField, localeField, countries) {
  geoField.addEventListener('change', () => {
    const country = countries.find((c) => c.name === geoField.value);
    if (country && [...localeField.options].some((o) => o.value === country.locale)) {
      localeField.value = country.locale;
    }
  });
}

async function loadLists() {
  try {
    const [templates, schemes, sites, geos] = await Promise.all([
      fetch('/api/templates').then((r) => r.json()),
      fetch('/api/schemes').then((r) => r.json()),
      fetch('/api/sites').then((r) => r.json()),
      fetch('/api/geos').then((r) => r.json()),
    ]);

    fillSelect(document.querySelector('#field-template'), templates.templates);
    fillSelect(document.querySelector('#field-scheme'), schemes.schemes);
    // /api/sites reports each folder's id, page count and (when site.json declares one) brand
    // name; the option text is built here so the picker shows something meaningful — which
    // folder, how big it is, whose content it is — instead of a bare folder name.
    fillDatalist(
      document.querySelector('#site-options'),
      sites.sites.map((site) => {
        const label = `${site.id} — ${site.pages} стр.`;
        return { id: site.id, name: site.brand ? `${label} · ${site.brand}` : label };
      }),
    );

    // /api/geos reports each country in factory/geos.json's own order, with its locale, plus the
    // distinct locales in the order they first appear — the owner's own order, unchanged, so the
    // countries they use most stay at the top of the dropdown.
    const geoOptions = [BLANK_OPTION, ...geos.countries.map((c) => ({ id: c.name, name: c.name }))];
    const localeOptions = [BLANK_OPTION, ...geos.locales.map((locale) => ({ id: locale, name: locale }))];
    fillSelect(document.querySelector('#field-geo'), geoOptions);
    fillSelect(document.querySelector('#field-locale'), localeOptions);
    syncLocaleWithGeo(document.querySelector('#field-geo'), document.querySelector('#field-locale'), geos.countries);

    // Examples belong to a theme, so this list is refilled whenever the theme changes — a name from
    // one theme means nothing to another, and offering it would offer a choice that fails.
    //
    // Not BLANK_OPTION, though the empty id is the same one: in the geo and language fields a blank
    // name reads as "this field is not filled in", and that is exactly what it means there. An empty
    // example is not an unfilled field — it is a choice of its own, "an example per page", and the
    // person making it has to see what they chose instead of an empty line. /api/examples answers
    // with an empty list when the theme cannot be read, so «Случайно» stays selectable regardless.
    // Both lists belong to a theme, so both are refilled whenever the theme changes — an example
    // name from one theme means nothing to another, and neither does a page it has no example for.
    const templateField = document.querySelector('#field-template');
    const fillForTemplate = async () => {
      const answer = await fetch(`/api/examples?template=${encodeURIComponent(templateField.value)}`)
        .then((r) => r.json())
        .catch(() => ({ examples: [], pages: [] }));
      fillSelect(document.querySelector('#field-example'), [{ id: '', name: 'Случайно' }, ...answer.examples]);
      // Ticked boxes, not a typed list: which pages to make is a real choice — a site of four out
      // of the theme's eight — but inventing one is not, since a page with no example cannot be
      // written. Everything the theme has is ticked to begin with, because that is the ordinary case.
      fillPages(answer.pages ?? []);
    };
    templateField.addEventListener('change', fillForTemplate);
    await fillForTemplate();

    const describe = () => {
      const chosen = templates.templates.find(
        (item) => item.id === document.querySelector('#field-template').value,
      );
      templateNote.textContent = chosen?.description ?? '';

      // A template ships with the scheme it was designed against, so preselect it: picking a
      // template and getting somebody else's palette is a worse default than the alphabetical one.
      const schemeField = document.querySelector('#field-scheme');
      const preferred = chosen?.defaultScheme;
      if (preferred && [...schemeField.options].some((o) => o.value === preferred)) {
        schemeField.value = preferred;
      }
    };
    document.querySelector('#field-template').addEventListener('change', describe);
    describe();
  } catch (error) {
    setStatus(`Не удалось загрузить списки: ${error.message}`, 'bad');
  }
}

function followBuild(buildId, domain) {
  const stream = new EventSource(`/api/builds/${buildId}/log`);

  stream.addEventListener('message', (event) => appendLog(JSON.parse(event.data)));

  stream.addEventListener('done', (event) => {
    const status = JSON.parse(event.data);
    stream.close();
    submitButton.disabled = false;

    if (status === 'ok') {
      setStatus(`Готово: output/${domain}`, 'ok');
      resultOpen.href = `/preview/${domain}/`;
      resultZip.href = `/api/output/${domain}/zip`;
      result.hidden = false;
    } else {
      setStatus('Сборка не удалась — смотри лог', 'bad');
    }
  });

  stream.addEventListener('error', () => {
    stream.close();
    submitButton.disabled = false;
    setStatus('Связь с сервером прервалась', 'bad');
  });
}

// «Без генерации картинок и логотипа» пропускает и логотип тоже, так что вместе с ней галочка
// перегенерации не значит ничего. Форма держит их согласованными сама: включённая галочка,
// которая заведомо ничего не сделает, читается как поломка, а не как правило.
const skipImagesField = form.elements.skipImages;
const regenerateLogoField = form.elements.regenerateLogo;
const skipTextsField = form.elements.skipTexts;
const pagesField = document.querySelector('#field-pages');

// One checkbox per page the theme has examples for. home stays ticked and cannot be unticked: a
// site without a front page is not a site, and the server refuses one anyway — better to say so
// by the box being fixed than by a refusal after the button is pressed.
function fillPages(pages) {
  pagesField.replaceChildren(
    ...pages.map((page) => {
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = page;
      box.checked = true;
      box.disabled = page === 'home';
      label.append(box, ` ${page}`);
      return label;
    }),
  );
  syncTexts();
}

const chosenPages = () => [...pagesField.querySelectorAll('input')].filter((box) => box.checked).map((box) => box.value);
const exampleField = document.querySelector('#field-example');
function syncRegenerateLogo() {
  regenerateLogoField.disabled = skipImagesField.checked;
  if (skipImagesField.checked) regenerateLogoField.checked = false;
}
skipImagesField.addEventListener('change', syncRegenerateLogo);
syncRegenerateLogo();

// «Только пересобрать» means nothing is written, so the fields that say what to write are of no
// use — shown greyed rather than hidden, so the list somebody typed is still theirs when they
// change their mind, and so the checkbox visibly explains what it turned off.
function syncTexts() {
  exampleField.disabled = skipTextsField.checked;
  for (const box of pagesField.querySelectorAll('input')) {
    box.disabled = skipTextsField.checked || box.value === 'home';
  }
  pagesField.classList.toggle('is-off', skipTextsField.checked);
}
skipTextsField.addEventListener('change', syncTexts);
syncTexts();



form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  logBox.textContent = '';
  result.hidden = true;
  // FormData reports a checkbox as "on" or leaves it out; the server wants a real boolean.
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.skipImages = skipImagesField.checked;
  payload.regenerateLogo = regenerateLogoField.checked;
  payload.skipTexts = skipTextsField.checked;
  // The boxes are not form fields with a name, so FormData knows nothing about them. Sent as a
  // list, which the server accepts alongside the old free text.
  if (!payload.skipTexts) payload.pages = chosenPages();
  const stages = [
    payload.skipTexts ? '' : 'Пишем тексты',
    payload.skipImages ? '' : payload.regenerateLogo ? 'делаем логотип заново и картинки' : 'генерируем логотип и картинки',
    'собираем',
  ].filter(Boolean);
  setStatus(`${stages.join(', ')}…`);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.error ?? 'Сервер отклонил запрос', 'bad');
      submitButton.disabled = false;
      return;
    }

    followBuild(data.buildId, data.domain);
    // A folder this run has just made only shows up among the suggestions once the lists are read
    // again, and re-reading them now costs nothing.
    if (!payload.skipTexts) loadLists();
  } catch (error) {
    setStatus(`Ошибка запроса: ${error.message}`, 'bad');
    submitButton.disabled = false;
  }
});

loadLists();
