import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const htmlUrl = new URL('../app/index.html', import.meta.url);
const jsUrl = new URL('../app/app.js', import.meta.url);
const swUrl = new URL('../app/sw.js', import.meta.url);

describe('Nuvem Fit organization and navigation', () => {
  it('separates the Fit area into focused pages instead of showing every tool at once', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    for (const id of ['fit-subview-folders', 'fit-subview-folder-detail', 'fit-subview-builder', 'fit-subview-history', 'fit-subview-coach']) {
      assert.ok(html.includes('id="' + id + '"'), 'missing focused Fit page: ' + id);
    }
    assert.ok(html.includes('data-fit-tab="folders"'));
    assert.ok(html.includes('data-fit-tab="builder"'));
    assert.ok(html.includes('data-fit-tab="history"'));
    assert.ok(html.includes('data-fit-tab="coach"'));
  });

  it('supports creating folders, opening them, saving exercises and adding saved exercises to a workout', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    const js = await fs.readFile(jsUrl, 'utf8');
    for (const id of ['exercise-folder-form', 'exercise-folder-name', 'exercise-folder-list', 'exercise-folder-saved-list', 'exercise-folder-back']) {
      assert.ok(html.includes('id="' + id + '"'), 'missing folder workflow control: ' + id);
    }
    for (const feature of ['nuvem.fit.exercise-folders.v1', 'loadExerciseFolders', 'saveExerciseFolders', 'openExerciseFolder', 'addExerciseToCurrentFolder', 'renderSavedExercises', 'switchFitSubpage("builder")']) {
      assert.ok(js.includes(feature), 'missing folder workflow behavior: ' + feature);
    }
  });

  it('refreshes cached assets after the navigation redesign', async () => {
    const sw = await fs.readFile(swUrl, 'utf8');
    assert.ok(sw.includes('nuvem-shell-v14'));
    assert.ok(sw.includes('styles.css?v=14'));
    assert.ok(sw.includes('app.js?v=14'));
  });
});
