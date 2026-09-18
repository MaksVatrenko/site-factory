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

// Every geo/language select keeps this as its first option. Both fields are meaningfully empty:
// on «Генерация» that means "take it from site.json", on «Тексты» a blank language means "work it
// out from the geo" (see generateSite). fillSelect reads value.id/value.name, and `??` only falls
// back on null/undefined, so an id/name of '' survives as a real, selectable empty option instead
// of being replaced by anything.
const BLANK_OPTION = { id: '', name: '' };

// Wires one tab's own geo select to its own language select: picking a geo preselects the
// language the table has for it, without touching the other tab's fields — each call closes over
// its own pair, so the two tabs never share one. The person stays free to change the language
// afterwards; this only runs again on the next geo change, never on its own.
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
    fillSelect(document.querySelector('#texts-template'), templates.templates);
    fillSelect(document.querySelector('#field-scheme'), schemes.schemes);
    // /api/sites reports each folder's id, page count and (when site.json declares one) brand
    // name; the option text is built here so the picker shows something meaningful — which
    // folder, how big it is, whose content it is — instead of a bare folder name.
    fillSelect(
      document.querySelector('#field-site'),
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
    for (const id of ['field-geo', 'texts-geo']) fillSelect(document.querySelector(`#${id}`), geoOptions);
    for (const id of ['field-locale', 'texts-locale']) fillSelect(document.querySelector(`#${id}`), localeOptions);
    syncLocaleWithGeo(document.querySelector('#field-geo'), document.querySelector('#field-locale'), geos.countries);
    syncLocaleWithGeo(document.querySelector('#texts-geo'), document.querySelector('#texts-locale'), geos.countries);

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
function syncRegenerateLogo() {
  regenerateLogoField.disabled = skipImagesField.checked;
  if (skipImagesField.checked) regenerateLogoField.checked = false;
}
skipImagesField.addEventListener('change', syncRegenerateLogo);
syncRegenerateLogo();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  logBox.textContent = '';
  result.hidden = true;
  // FormData reports a checkbox as "on" or leaves it out; the server wants a real boolean.
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.skipImages = form.elements.skipImages.checked;
  payload.regenerateLogo = form.elements.regenerateLogo.checked;
  setStatus(
    payload.skipImages
      ? 'Собираем…'
      : payload.regenerateLogo
        ? 'Делаем логотип заново, генерируем картинки, собираем…'
        : 'Генерируем логотип и картинки, собираем…',
  );

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
  } catch (error) {
    setStatus(`Ошибка запроса: ${error.message}`, 'bad');
    submitButton.disabled = false;
  }
});

loadLists();

// The texts tab. It watches its job through the very same log stream a build uses, so there is
// nothing new to learn here: post, then follow /api/builds/<id>/log until it says done.
const textsForm = document.querySelector('#texts-form');
const textsSubmit = document.querySelector('#texts-submit');
const textsStatus = document.querySelector('#texts-status');
const textsLog = document.querySelector('#texts-log');
const textsPages = document.querySelector('#texts-pages');

const DEFAULT_PAGES = ['home', 'casino', 'slots', 'games', 'betting', 'bonus', 'app', 'login'];
textsPages.value = DEFAULT_PAGES.join('\n');

function followTextsJob(jobId) {
  const stream = new EventSource(`/api/builds/${jobId}/log`);
  stream.addEventListener('message', (event) => {
    textsLog.textContent += `${JSON.parse(event.data)}\n`;
    textsLog.scrollTop = textsLog.scrollHeight;
  });
  stream.addEventListener('done', (event) => {
    stream.close();
    textsSubmit.disabled = false;
    const ok = JSON.parse(event.data) === 'ok';
    textsStatus.textContent = ok ? 'Готово — папка появилась на вкладке «Генерация»' : 'Не получилось — смотри лог';
    textsStatus.className = ok ? 'status is-ok' : 'status is-bad';
    // The new folder only shows up in the site picker once the lists are read again.
    if (ok) loadLists();
  });
  stream.addEventListener('error', () => {
    stream.close();
    textsSubmit.disabled = false;
    textsStatus.textContent = 'Связь с сервером прервалась';
    textsStatus.className = 'status is-bad';
  });
}

textsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  textsSubmit.disabled = true;
  textsLog.textContent = '';
  textsStatus.textContent = 'Пишем тексты…';
  textsStatus.className = 'status';

  const payload = Object.fromEntries(new FormData(textsForm).entries());
  try {
    const response = await fetch('/api/texts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      textsStatus.textContent = data.error ?? 'Сервер отклонил запрос';
      textsStatus.className = 'status is-bad';
      textsSubmit.disabled = false;
      return;
    }
    followTextsJob(data.jobId);
  } catch (error) {
    textsStatus.textContent = `Ошибка запроса: ${error.message}`;
    textsStatus.className = 'status is-bad';
    textsSubmit.disabled = false;
  }
});
