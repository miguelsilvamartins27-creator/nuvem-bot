import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const htmlUrl = new URL('../app/index.html', import.meta.url);
const cssUrl = new URL('../app/polish.css', import.meta.url);
const iconUrl = new URL('../app/icon.svg', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20261017_app_chat_conversations.sql', import.meta.url);
const manifestUrl = new URL('../app/manifest.webmanifest', import.meta.url);
const swUrl = new URL('../app/sw.js', import.meta.url);

describe('Nuvem remaster visual and database migration', () => {
  it('uses a calm, consistent color system rather than pure black/white surfaces', async () => {
    const css = await fs.readFile(cssUrl, 'utf8');
    assert.ok(css.includes('--n-bg:#e8e6de'));
    assert.ok(css.includes('--n-panel:#efede6'));
    assert.ok(css.includes('--n-text:#4a554b'));
    assert.ok(css.includes('--n-accent:#6d8f7e'));
    assert.ok(css.includes('html[data-theme="dark"]'));
    assert.ok(css.includes('--n-bg:#171916'));
    assert.ok(css.includes('Dark mode: no white card/panel surfaces anywhere'));
    assert.ok(css.includes('.mobile-more-menu:not([hidden])'));
    assert.ok(css.includes('Nubank-inspired hierarchy'));
    assert.ok(css.includes('#view-ia .chat-form:focus-within'));
    assert.ok(css.includes('@keyframes nuvemRobotFloat'));
    assert.ok(css.includes('.typing-label'));
    assert.ok(css.includes('@media(max-width:760px)'));
    assert.ok(css.includes('.mobile-nav{display:none!important}'));
    assert.ok(css.includes('display:flex!important'));
  });

  it('preserves all chat controls while giving the assistant its own responsive layout', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    for (const id of ['view-ia', 'chat-list', 'chat-new', 'chat-delete', 'chat-messages', 'chat-form', 'chat-input', 'chat-send', 'chat-audio-button', 'chat-audio-file', 'chat-status']) {
      assert.ok(html.includes('id="' + id + '"'), 'missing chat control: ' + id);
    }
    assert.ok(html.includes('polish.css?v=6'));
    assert.ok(html.includes('app.js?v=35'));
    assert.ok(html.includes('ai-hero-robot'));
    assert.ok(html.includes('nuvem-robot-svg'));
    assert.ok(!html.includes('🤖'));
    assert.ok(!html.includes('📁'));
    assert.ok(html.includes('HISTÓRICO DE CONVERSAS'));
    assert.ok(html.includes('Pergunte qualquer coisa à Nuvem'));
  });

  it('provides a vector logo, valid PWA metadata and refreshed offline cache', async () => {
    const icon = await fs.readFile(iconUrl, 'utf8');
    const manifest = JSON.parse(await fs.readFile(manifestUrl, 'utf8'));
    const sw = await fs.readFile(swUrl, 'utf8');
    assert.ok(icon.includes('<linearGradient'));
    assert.ok(icon.includes('Nuvem'));
    assert.equal(manifest.theme_color, '#e8e6de');
    assert.ok(sw.includes('nuvem-shell-v36'));
    assert.ok(sw.includes('/app/polish.css?v=6'));
    assert.ok(sw.includes('/app/app.js?v=35'));
  });

  it('shows the assistant robot and animated thinking label', async () => {
    const js = await fs.readFile(new URL('../app/app.js', import.meta.url), 'utf8');
    assert.ok(js.includes('assistant-message-head'));
    assert.ok(js.includes('A Nuvem está pensando'));
    assert.ok(js.includes('typing-robot'));
    assert.ok(js.includes('createRobotIcon'));
    assert.ok(!js.includes('🤖'));
  });

  it('keeps the multiple-conversation migration rerunnable and preserves old message history', async () => {
    const migration = await fs.readFile(migrationUrl, 'utf8');
    assert.ok(migration.includes('begin;'));
    assert.ok(migration.includes('commit;'));
    assert.ok(migration.includes('create table if not exists public.app_chat_conversations'));
    assert.ok(migration.includes('add column if not exists conversation_id'));
    assert.ok(migration.includes('where m.conversation_id is null'));
    assert.ok(migration.includes('enable row level security'));
    assert.ok(migration.includes('auth.uid() = user_id'));
    assert.ok(!migration.toLowerCase().includes('drop table'));
    assert.ok(!migration.toLowerCase().includes('truncate'));
  });
});
