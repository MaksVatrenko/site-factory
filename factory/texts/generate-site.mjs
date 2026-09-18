import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInstructions, planPage } from './plan.mjs';
import { fillFaq, fillSection } from './fill.mjs';
import { assemblePage, AUTO_BLOCKS } from './assemble.mjs';
import { generateSiteJson } from './site-json.mjs';
import { contentByType, loadLayouts, pickLayouts, planShape, resolveLayout, takesASection } from './layouts.mjs';
import { describeBlocks, loadTemplateBlocks, loadTemplateExamples } from './template.mjs';
import { languageFor, loadTextsPromptFile } from './texts-prompts.mjs';
import { loadGeos } from '../geos.mjs';

// The whole stage, start to finish. Like the picture and logo steps it never throws: every problem
// becomes one line in the log, because a half-written folder the owner can look at and re-run beats
// an exception in a terminal.

const formatCost = (cost) => `$${cost.toFixed(4)}`;

function writeIfNew(file, data) {
  // 'wx' makes the write itself the check: a file that appeared since the existsSync above is not
  // quietly overwritten. Nothing here ever replaces content that is already on disk.
  try {
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export async function generateSite({
  siteDir,
  templateId,
  brand,
  geo,
  locale,
  pages,
  config,
  root = process.cwd(),
  promptFile,
  geosFile,
  layoutsDir = join(root, 'layouts'),
  // Empty means «Случайно»: every page draws its own layout from the folder, by a seed on the site
  // and the page name. A named one goes to every page of the site instead — that is how a layout
  // gets looked at without re-running generation ten times, and how something already shown to a
  // client is shown again.
  layout = '',
  fetchFn,
  sleep,
  log = () => {},
}) {
  const summary = { written: [], skipped: [], cost: 0 };

  if (!config?.apiKey) {
    const reason = config?.apiKeyInvalid
      ? 'ключ OpenAI в .env записан неверно (недопустимые символы (пробелы, переносы строк, не-ASCII))'
      : 'ключ OpenAI не задан в .env';
    log(`Тексты: ${reason} — пропущены`);
    return summary;
  }

  // Everything that can be refused for free is checked before the first paid request.
  let content;
  let examples;
  let promptSet;
  let geos;
  let layouts;
  try {
    content = loadTemplateBlocks(templateId, root);
    examples = loadTemplateExamples(templateId, root);
    promptSet = loadTextsPromptFile(promptFile);
    geos = loadGeos(geosFile);
    layouts = loadLayouts(layoutsDir);
  } catch (error) {
    log(`Тексты: ${error.message} — пропущены`);
    return summary;
  }
  if (!pages.includes('home')) {
    log('Тексты: в списке страниц нет home — у сайта не будет главной, пропущено');
    return summary;
  }

  const byGeo = languageFor(geo, geos.languageByGeo);
  const language = locale.trim() || byGeo.locale;
  if (locale.trim() === '' && !byGeo.known) {
    log(`Тексты: гео «${geo}» незнакомое — язык взят английский`);
  }

  const instructions = buildInstructions({
    rules: promptSet.rules,
    templateText: describeBlocks(content),
    examples,
  });

  // Seeded by the folder name, so a re-run of a stopped generation keeps the same layouts. Every
  // page is resolved here, before the first paid request: a layout that does not fit the theme must
  // be named for free, not discovered after six pages have been paid for.
  let resolved;
  try {
    const chosen = pickLayouts({
      layouts,
      pages,
      seed: siteDir.split(/[/\\]/).filter(Boolean).at(-1),
      chosen: layout,
    });
    resolved = Object.fromEntries(
      pages.map((page) => [page, resolveLayout(chosen[page], { content, autoBlocks: AUTO_BLOCKS })]),
    );
  } catch (error) {
    log(`Тексты: ${error.message} — пропущены`);
    return summary;
  }
  const options = { config, fetchFn, sleep };

  // A dedicated catch, not left to escape: an unwritable path or a plain file already sitting where
  // the folder should go must degrade to a log line like every other free check above, not surface
  // as an unhandled rejection in the CLI that awaits this function.
  try {
    mkdirSync(siteDir, { recursive: true });
  } catch (error) {
    log(`Тексты: не удалось создать папку сайта — ${error.message} — пропущены`);
    return summary;
  }

  // Asked for every time, even on a re-run: the service-block headings live only in this answer,
  // and the pages below cannot be assembled without them. Only the file is protected, not the call.
  let labels;
  try {
    const frame = await generateSiteJson(
      { brand, geo, locale: language, domain: '', pages, instructions },
      options,
    );
    summary.cost += frame.cost;
    labels = frame.labels;
    const name = 'site.json';
    if (writeIfNew(join(siteDir, name), frame.site)) summary.written.push(name);
    else summary.skipped.push(name);
  } catch (error) {
    // Same principle as the page-level catch below: a truncated or refused attempt still ran the
    // model and still cost money, even though the frame itself came to nothing.
    summary.cost += error.cost ?? 0;
    log(`Тексты: кадр сайта не получился — ${error.message}. Пропущено, ${formatCost(summary.cost)}`);
    return summary;
  }

  for (const page of pages) {
    const name = `${page}.json`;
    if (existsSync(join(siteDir, name))) {
      summary.skipped.push(name);
      log(`Тексты: ${name} уже есть — пропущена`);
      continue;
    }

    const started = Date.now();
    let spent = 0;
    try {
      const pageLayout = resolved[page];
      const planned = await planPage(
        {
          page,
          pages,
          brand,
          geo,
          locale: language,
          shape: planShape(pageLayout.blocks),
          // The link budgets are not a property of the layout — they exist to stop spam, not to add
          // it, so every page of every site from this theme gets the same ceiling, straight from
          // blocks.json.
          links: content.links,
          // From the resolved layout, not from the theme: the theme states the ceiling and the
          // layout picks out of it, so reading the theme here would discard every exact number a
          // layout wrote. One entry per kind of block, because each kind is asked for separately.
          contentByType: contentByType(pageLayout.blocks),
          instructions,
        },
        options,
      );
      spent += planned.cost;
      for (const warning of planned.warnings) log(`Тексты: ${name}: ${warning}`);
      // The plan is the only place a section's own heading exists, so it is what the assembler is
      // given below — never a heading a filled section happened to contain.

      // Every content block of the page, back in the order it stands in — the plan holds them by
      // kind, and what has to be filled and assembled is the page, top to bottom. Each one keeps the
      // place it came from, so a block that fails leaves a hole where it was instead of pulling
      // everything after it up by one.
      const planned_ = new Map();
      const taken = new Map();
      for (const [at, block] of pageLayout.blocks.entries()) {
        if (!takesASection(block)) continue;
        const nth = taken.get(block.type) ?? 0;
        taken.set(block.type, nth + 1);
        const entry = planned.plan.blocks?.[block.type]?.[nth];
        if (entry) planned_.set(at, entry);
      }

      const headings = [...planned_.values()].map((section) => section.heading);
      const sections = new Map();
      for (const [at, section] of planned_) {
        const siblings = headings.filter((heading) => heading !== section.heading);
        try {
          const filled = await fillSection(
            { section, siblings, brand, locale: language, instructions },
            options,
          );
          spent += filled.cost;
          // sectionSchema sets no minItems on `items`, so `{"items": []}` is a valid, successful
          // answer, not a failure — but it still leaves nothing to show for this section, so it is
          // worth the same kind of log line a failed section gets below, instead of vanishing
          // silently into the filter a few lines down.
          if (filled.items.length === 0) {
            log(`Тексты: ${name}: раздел «${section.heading}» вернулся пустым — пропущен`);
          }
          sections.set(at, { heading: section.heading, items: filled.items });
        } catch (error) {
          // A bad key or an empty balance fails the same way for every section left, on this page
          // and every page after it — swallowing it here would burn through the rest of this page's
          // sections one doomed request at a time before the run-stopping check below ever saw it.
          // So it is rethrown, to be handled exactly once, by the same catch that stops the run for
          // a page-level failure. Only a genuinely local failure degrades locally.
          if (error?.kind === 'auth' || error?.kind === 'balance') throw error;
          // A truncated or refused answer still ran the model and still cost money, even though the
          // section itself came to nothing — so that money is counted here, not dropped on the floor.
          spent += error.cost ?? 0;
          // One section short is a shorter page, not a lost one.
          log(`Тексты: ${name}: раздел «${section.heading}» не вышел — ${error.message}`);
          sections.set(at, { heading: section.heading, items: [] });
        }
      }

      let faq = [];
      if (planned.plan.faq.length > 0) {
        try {
          const answered = await fillFaq(
            { questions: planned.plan.faq, brand, locale: language, instructions },
            options,
          );
          spent += answered.cost;
          faq = planned.plan.faq.map((question, index) => ({
            question,
            answer: answered.answers[index] ?? '',
          }));
        } catch (error) {
          // Same reasoning as the section loop above: auth/balance fail every request left the same
          // way, so those stop the run. Anything else means only the FAQ is missing — the sections
          // above already paid for their prose, and a page without FAQ beats no page at all.
          if (error?.kind === 'auth' || error?.kind === 'balance') throw error;
          spent += error.cost ?? 0;
          log(`Тексты: ${name}: FAQ не вышел — ${error.message}`);
        }
      }

      // An empty `items` above means one of two things, both already logged by this point: the catch
      // pushed it after fillSection failed locally, or the model legitimately answered `{"items": []}`
      // — sectionSchema sets no minItems, so that shape is valid. Either way there is nothing to show
      // for the section, so dropping it here, before assemblePage builds the table of contents and
      // the section blocks from this very array, keeps the two lists in agreement: no contents entry
      // is left pointing at a heading with nothing under it.
      const filledSections = new Map(
        [...sections].filter(([, section]) => section.items.length > 0),
      );

      const { page: built, warnings } = assemblePage({
        plan: planned.plan,
        blocks: pageLayout.blocks,
        layout: pageLayout.id,
        sections: filledSections,
        faq,
        pages,
        page,
        labels,
        lengths: content.lengths,
      });
      for (const warning of warnings) log(`Тексты: ${name}: ${warning}`);

      if (writeIfNew(join(siteDir, name), built)) summary.written.push(name);
      else summary.skipped.push(name);
      log(
        `Тексты: ${name} готова — раскладка «${pageLayout.name}», ${((Date.now() - started) / 1000).toFixed(1)} с, ${formatCost(spent)}`,
      );
    } catch (error) {
      // Whatever this page already spent before dying — planning, filled sections, a truncated or
      // refused attempt right here — is real money and belongs in the total the log line prints next.
      spent += error.cost ?? 0;
      log(`Тексты: ${name} не вышла — ${error.message}, потрачено ${formatCost(spent)}`);
      // A bad key or an empty balance answers the same way for every page left. Carrying on would
      // just repeat the same failure once per page, slowly, so the run stops here instead. `spent`
      // is added to summary.cost exactly once, down in `finally` — not here too — since `finally`
      // always runs on the way out of this catch, `break` included.
      if (error?.kind === 'auth' || error?.kind === 'balance') {
        log('Тексты: прогон остановлен — остальные страницы не пробовались');
        break;
      }
    } finally {
      summary.cost += spent;
    }
  }

  // site.json is written first, from the full requested page list, so its menu already links to
  // every page the owner asked for — including any a stopped or partly-failed run never got to.
  // The menu is deliberately never pruned back to what actually exists: the list is the owner's, and
  // re-running the same command fills the gap, which a pruned-then-restored menu would only get in
  // the way of. So the only thing left to do here is say, once, which links do not resolve yet.
  const missingPages = pages.filter((page) => !existsSync(join(siteDir, `${page}.json`)));
  if (missingPages.length > 0) {
    log(`Тексты: меню ведёт на страницы без файла (${missingPages.join(', ')}) — заработают, когда прогон будет доведён до конца`);
  }

  // site.json is written once, alongside the pages, but it is the frame, not a page itself — the
  // owner reading this line wants to know how many pages a run produced, and a site with zero pages
  // must never read back as "страниц 1".
  const pagesWritten = summary.written.filter((name) => name !== 'site.json').length;
  log(`Тексты: готово, страниц ${pagesWritten}, всего ${formatCost(summary.cost)}`);
  return summary;
}
