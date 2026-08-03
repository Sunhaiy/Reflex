import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIgnoreFilter, planUpload } from '../transfer';

describe('buildIgnoreFilter', () => {
  const isIgnored = buildIgnoreFilter();

  it('drops what is useless on the other machine', () => {
    expect(isIgnored('.git', true)).toBe(true);
    expect(isIgnored('node_modules', true)).toBe(true);
    expect(isIgnored('src/__pycache__', true)).toBe(true);
    expect(isIgnored('.venv', true)).toBe(true);
    expect(isIgnored('debug.log', false)).toBe(true);
  });

  it('drops files inside an excluded directory too', () => {
    expect(isIgnored('node_modules/express/index.js', false)).toBe(true);
    expect(isIgnored('.git/config', false)).toBe(true);
  });

  it('never uploads anything credential-shaped', () => {
    // The failure this prevents is silent: a .env pushed to a server nobody audits.
    expect(isIgnored('.env', false)).toBe(true);
    expect(isIgnored('.env.production', false)).toBe(true);
    expect(isIgnored('certs/server.pem', false)).toBe(true);
    expect(isIgnored('certs/server.key', false)).toBe(true);
    expect(isIgnored('id_rsa', false)).toBe(true);
  });

  it('keeps the example env file, which carries no secret', () => {
    expect(isIgnored('.env.example', false)).toBe(false);
    expect(isIgnored('.env.sample', false)).toBe(false);
  });

  it('leaves build output to the project to decide', () => {
    // Deliberate: whether dist belongs on the server is the project's call, and it
    // already says so in its own .gitignore.
    expect(isIgnored('dist', true)).toBe(false);
    expect(isIgnored('build', true)).toBe(false);
    expect(isIgnored('target', true)).toBe(false);
  });

  it('keeps ordinary source', () => {
    expect(isIgnored('src/index.ts', false)).toBe(false);
    expect(isIgnored('package.json', false)).toBe(false);
    expect(isIgnored('Dockerfile', false)).toBe(false);
  });

  it('applies the project’s own rules on top', () => {
    const withProject = buildIgnoreFilter('dist/\n*.tmp\n');
    expect(withProject('dist', true)).toBe(true);
    expect(withProject('scratch.tmp', false)).toBe(true);
    expect(withProject('src/index.ts', false)).toBe(false);
  });

  it('honours a negation in the project’s rules', () => {
    const withProject = buildIgnoreFilter('*.log\n!important.log\n');
    expect(withProject('debug.log', false)).toBe(true);
    expect(withProject('important.log', false)).toBe(false);
  });

  it('normalises native separators', () => {
    expect(isIgnored(path.join('node_modules', 'left-pad'), true)).toBe(true);
    expect(isIgnored(path.join('src', 'app.ts'), false)).toBe(false);
  });
});

describe('planUpload', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'reflex-transfer-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
    await mkdir(path.join(root, 'coverage'), { recursive: true });

    await writeFile(path.join(root, 'package.json'), '{"name":"demo"}');
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const a = 1;\n');
    await writeFile(path.join(root, '.env'), 'SECRET=hunter2\n');
    await writeFile(path.join(root, '.env.example'), 'SECRET=\n');
    await writeFile(path.join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;');
    await writeFile(path.join(root, 'coverage', 'report.html'), '<html></html>');
    await writeFile(path.join(root, '.gitignore'), 'coverage/\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('collects the source and nothing else', async () => {
    const plan = await planUpload(root);
    const paths = plan.files.map((file) => file.relativePath).sort();

    expect(paths).toEqual(['.env.example', '.gitignore', 'package.json', 'src/index.ts']);
    expect(plan.totalBytes).toBeGreaterThan(0);
  });

  it('never descends into an excluded directory', async () => {
    const plan = await planUpload(root);
    expect(plan.files.some((file) => file.relativePath.startsWith('node_modules/'))).toBe(false);
    expect(plan.files.some((file) => file.relativePath.startsWith('coverage/'))).toBe(false);
  });

  it('reports the credential files it skipped so the agent can say so', async () => {
    // A deploy that silently loses .env fails much later and for no obvious reason.
    const plan = await planUpload(root);
    expect(plan.notableSkips).toContain('.env');
    expect(plan.notableSkips).not.toContain('.env.example');
  });
});
