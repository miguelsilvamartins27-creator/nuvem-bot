import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const apiUrl = new URL('../lib/app-api.js', import.meta.url);
const htmlUrl = new URL('../app/index.html', import.meta.url);
const jsUrl = new URL('../app/app.js', import.meta.url);
const aliasesUrl = new URL('../app/data/exercicios/aliases.json', import.meta.url);
const swUrl = new URL('../app/sw.js', import.meta.url);

describe('Nuvem Fit exercise library', () => {
  it('contains a broad Portuguese popular-name index with safe step-by-step guidance', async () => {
    const aliases = JSON.parse(await fs.readFile(aliasesUrl, 'utf8'));
    assert.ok(aliases.length >= 25);
    for (const item of aliases) {
      assert.ok(item.pt && item.en && item.group && item.equipment, 'exercise metadata is incomplete');
      assert.ok(Array.isArray(item.terms) && item.terms.length > 0, 'popular aliases are missing');
      assert.ok(Array.isArray(item.how) && item.how.length >= 3, 'step-by-step instructions are missing');
      assert.ok(Array.isArray(item.cues), 'safety cues are missing');
    }
  });

  it('protects exercise search and limits external demonstration media to the expected HTTPS host', async () => {
    const source = await fs.readFile(apiUrl, 'utf8');
    const route = source.indexOf("app.get('/api/app/exercises'");
    assert.notEqual(route, -1);
    const snippet = source.slice(route, route + 7000);
    assert.ok(snippet.includes('requireUser'));
    assert.ok(snippet.includes('limitWellness'));
    assert.ok(snippet.includes('oss.exercisedb.dev/api/v1/exercises'));
    assert.ok(snippet.includes("candidate.protocol === 'https:' && candidate.hostname === 'static.exercisedb.dev'"));
    assert.ok(snippet.includes("path.join(root, 'data', 'exercicios', 'aliases.json')"));
  });

  it('connects searching, exercise details, animated demos and folder saving', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    const js = await fs.readFile(jsUrl, 'utf8');
    for (const id of ['exercise-search-form', 'exercise-search-input', 'exercise-library-results', 'exercise-detail', 'fit-form']) {
      assert.ok(html.includes('id="' + id + '"'), 'missing UI element: ' + id);
    }
    for (const feature of ['/api/app/exercises?search=', 'showExerciseDetail', 'addExerciseToCurrentFolder', 'data-exercise-query']) {
      assert.ok(js.includes(feature), 'missing UI wiring: ' + feature);
    }
    assert.ok(html.includes('Demonstrações visuais fornecidas pela ExerciseDB'));
  });

  it('invalidates the old cached app shell', async () => {
    const sw = await fs.readFile(swUrl, 'utf8');
    assert.ok(sw.includes('nuvem-shell-v27'));
    assert.ok(sw.includes('styles.css?v=26'));
    assert.ok(sw.includes('app.js?v=29'));
  });
});
