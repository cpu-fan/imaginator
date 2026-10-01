const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
let html = readFileSync(path.join(root, 'index.template.html'), 'utf8');

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
for (const file of ['file-parts.js', 'vault-core.js', 'image-codec.js', 'directory-zip.js', 'app.js']) {
  inline(`<script src="${file}"></script>`, file, 'script');
}

writeFileSync(path.join(root, 'index.html'), html);
