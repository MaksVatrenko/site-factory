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

async function loadLists() {
  try {
    const [templates, schemes, sites] = await Promise.all([
      fetch('/api/templates').then((r) => r.json()),
      fetch('/api/schemes').then((r) => r.json()),
      fetch('/api/sites').then((r) => r.json()),
    ]);

    fillSelect(document.querySelector('#field-template'), templates.templates);
    fillSelect(document.querySelector('#field-scheme'), schemes.schemes);
    fillSelect(document.querySelector('#field-site'), sites.sites);

    const describe = () => {
      const chosen = templates.templates.find(
        (item) => item.id === document.querySelector('#field-template').value,
      );
      templateNote.textContent = chosen?.description ?? '';
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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  logBox.textContent = '';
  result.hidden = true;
  setStatus('Собираем…');

  try {
    const payload = Object.fromEntries(new FormData(form).entries());
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
