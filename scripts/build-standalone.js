const { readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scripts = ['file-parts.js', 'vault-core.js', 'image-codec.js', 'directory-zip.js', 'app.js'];
const buildInputs = ['index.template.html', 'styles.css', ...scripts, 'scripts/build-standalone.js'];
let html = readFileSync(path.join(root, 'index.template.html'), 'utf8');

function buildDate() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  const date = new Date(epoch === undefined ? Date.now() : Number(epoch) * 1000);
  if ((epoch !== undefined && !/^[0-9]+$/.test(epoch)) || !Number.isFinite(date.getTime())) {
    throw new Error('SOURCE_DATE_EPOCH must be a valid Unix timestamp in seconds');
  }
  return date;
}

function gitOutput(args) {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() : null;
}

function buildCommit() {
  const hash = gitOutput(['rev-parse', '--short=7', 'HEAD']);
  if (!hash || !/^[0-9a-f]{7,40}$/.test(hash)) {
    return {text: 'недоступен', title: 'Сборка без доступных сведений о коммите Git'};
  }
  const changes = gitOutput(['diff', '--name-only', 'HEAD', '--', ...buildInputs]);
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard', '--', ...buildInputs]);
  const dev = changes !== '' || untracked !== '';
  return {
    text: hash + (dev ? '-dev' : ''),
    title: dev ? 'Исходники сборки изменены относительно этого коммита' : 'Коммит исходников на момент сборки'
  };
}

const date = buildDate(), commit = buildCommit();
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric'
});
const dateParts = Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
const dateIso = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
for (const [token, value] of Object.entries({
  __BUILD_DATE_ISO__: dateIso, __BUILD_DATE_TEXT__: dateFormatter.format(date),
  __BUILD_COMMIT__: commit.text, __BUILD_COMMIT_TITLE__: commit.title
})) {
  if (!html.includes(token)) throw new Error(`Missing ${token} in index.template.html`);
  html = html.replaceAll(token, value);
}

function inline(tag, file, replacementTag) {
  const content = readFileSync(path.join(root, file), 'utf8');
  if (!html.includes(tag)) throw new Error(`Missing ${tag} in index.template.html`);
  if (/<\/script/i.test(content) && replacementTag === 'script') {
    throw new Error(`${file} contains a closing script tag`);
  }
  if (/<\/style/i.test(content) && replacementTag === 'style') {
    throw new Error(`${file} contains a closing style tag`);
  }
  html = html.replace(tag, `<${replacementTag}>\n${content}\n</${replacementTag}>`);
}

inline('<link rel="stylesheet" href="styles.css">', 'styles.css', 'style');
for (const file of scripts) {
  inline(`<script src="${file}"></script>`, file, 'script');
}

writeFileSync(path.join(root, 'index.html'), html);
