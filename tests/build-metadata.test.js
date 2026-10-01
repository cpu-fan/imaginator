const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {mkdtempSync, mkdirSync, copyFileSync, readFileSync, appendFileSync, writeFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');

const sourceRoot = path.join(__dirname, '..');
const inputs = ['index.template.html','styles.css','file-parts.js','vault-core.js','image-codec.js','directory-zip.js','app.js','scripts/build-standalone.js'];
const epoch = String(Date.parse('2026-09-30T22:30:00Z') / 1000);

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'sendler-build-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,'scripts'));
  for (const input of inputs) copyFileSync(path.join(sourceRoot,input),path.join(root,input));
  return root;
}

function git(root, args) {
  const result = spawnSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  assert.equal(result.status,0,result.stderr || String(result.error));
  return result.stdout.trim();
}

function build(root, seconds = epoch) {
  const result = spawnSync(process.execPath,['scripts/build-standalone.js'],{cwd:root,encoding:'utf8',env:{...process.env,SOURCE_DATE_EPOCH:seconds}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');
  return readFileSync(path.join(root,'index.html'),'utf8');
}

test('build freezes the Moscow calendar date and Telegram link into standalone HTML without Git',t=>{
  const root = fixture(t), html = build(root);
  const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0] || '';
  assert.match(footer,/<time\b[^>]*datetime="2026-10-01"[^>]*>01\.10\.2026<\/time>/);
  assert.match(footer,/<code[^>]*>недоступен<\/code>/);
  assert.match(footer,/<a[^>]*href="https:\/\/t\.me\/azazaaat"[^>]*>@azazaaat<\/a>/);
  assert.doesNotMatch(html,/__BUILD_[A-Z_]+__/);
  assert.equal(build(root),html,'A fixed build timestamp should reproduce the same HTML');
});

test('build identifies committed sources and marks tracked/staged edits as dev',t=>{
  const root = fixture(t);
  git(root,['init','--quiet']);
  git(root,['add','--',...inputs]);
  git(root,['-c','user.name=Build Test','-c','user.email=build@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Fixture']);
  const sha = git(root,['rev-parse','--short=7','HEAD']);
  const clean = build(root);
  assert.match(clean,new RegExp(`<code[^>]*>${sha}</code>`));
  // Generated HTML and unrelated documentation must not make sources dev.
  git(root,['add','index.html']);
  git(root,['-c','user.name=Build Test','-c','user.email=build@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Built artifact']);
  const nextSha = git(root,['rev-parse','--short=7','HEAD']);
  writeFileSync(path.join(root,'README.md'),'Unrelated documentation');
  assert.match(build(root,String(Number(epoch)+60)),new RegExp(`<code[^>]*>${nextSha}</code>`));
  appendFileSync(path.join(root,'app.js'),'\n// changed source\n');
  assert.match(build(root),new RegExp(`<code[^>]*>${nextSha}-dev</code>`));
  git(root,['add','app.js']);
  assert.match(build(root),new RegExp(`<code[^>]*>${nextSha}-dev</code>`));
});

test('untracked build inputs also mark the archive as dev',t=>{
  const root = fixture(t);
  git(root,['init','--quiet']);
  git(root,['add','--',...inputs.filter(input=>input!=='directory-zip.js')]);
  git(root,['-c','user.name=Build Test','-c','user.email=build@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Fixture']);
  const sha=git(root,['rev-parse','--short=7','HEAD']);
  assert.match(build(root),new RegExp(`<code[^>]*>${sha}-dev</code>`));
});

test('invalid build timestamp fails without overwriting the previous HTML',t=>{
  const root=fixture(t);
  writeFileSync(path.join(root,'index.html'),'Previous build');
  for (const seconds of ['not-a-date','999999999999999999999']) {
    const result=spawnSync(process.execPath,['scripts/build-standalone.js'],{cwd:root,encoding:'utf8',env:{...process.env,SOURCE_DATE_EPOCH:seconds}});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/SOURCE_DATE_EPOCH/);
    assert.equal(readFileSync(path.join(root,'index.html'),'utf8'),'Previous build');
  }
});
