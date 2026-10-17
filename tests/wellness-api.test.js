import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const apiUrl = new URL('../lib/app-api.js', import.meta.url);
const htmlUrl = new URL('../app/index.html', import.meta.url);
const jsUrl = new URL('../app/app.js', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20261017_app_wellness.sql', import.meta.url);

describe('Nuvem Life: fitness and nutrition', () => {
  it('protects wellness record endpoints with authentication and rate limiting', async () => {
    const source = await fs.readFile(apiUrl, 'utf8');
    for (const route of ["app.get('/api/app/wellness'", "app.post('/api/app/wellness'", "app.delete('/api/app/wellness/:id'", "app.post('/api/app/nutrition/analyze-photo'"]) {
      const start = source.indexOf(route);
      assert.notEqual(start, -1, 'route missing: ' + route);
      const snippet = source.slice(start, start + 220);
      assert.ok(snippet.includes('requireUser'), 'route missing authentication: ' + route);
      if (route.includes('post(') || route.includes('delete(')) assert.ok(snippet.includes('limitWellness'), 'route missing rate limit: ' + route);
    }
  });

  it('limits and normalizes uploaded meal photos before sending them to vision AI', async () => {
    const source = await fs.readFile(apiUrl, 'utf8');
    assert.ok(source.includes("express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' })"));
    assert.ok(source.includes('resize({ width: 1280, height: 1280'));
    assert.ok(source.includes("modalidade: 'visao'"));
    assert.ok(source.includes('estimativa visual'));
  });

  it('creates user-owned records with row-level security', async () => {
    const migration = await fs.readFile(migrationUrl, 'utf8');
    assert.ok(migration.includes('create table if not exists public.app_wellness_records'));
    assert.ok(migration.includes('alter table public.app_wellness_records enable row level security'));
    assert.ok(migration.includes('auth.uid() = user_id'));
    assert.ok(migration.includes("record_type in ('workout', 'meal')"));
  });

  it('connects the Fit and nutrition interfaces to saved records and AI actions', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    const js = await fs.readFile(jsUrl, 'utf8');
    for (const id of ['view-fit', 'view-dieta', 'fit-form', 'fit-ai-form', 'meal-form', 'meal-ai-form', 'meal-photo-form']) {
      assert.ok(html.includes('id="' + id + '"'), 'UI missing: ' + id);
    }
    for (const feature of ['/api/app/wellness', '/api/app/nutrition/analyze-photo', 'loadWellnessRecords', 'fit-ai-form', 'meal-ai-form']) {
      assert.ok(js.includes(feature), 'UI not wired: ' + feature);
    }
    assert.ok(html.includes('A imagem não é salva automaticamente'));
  });
});
