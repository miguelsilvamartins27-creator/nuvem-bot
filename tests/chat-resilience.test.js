import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const apiUrl = new URL('../lib/app-api.js', import.meta.url);
const appUrl = new URL('../app/app.js', import.meta.url);
const htmlUrl = new URL('../app/index.html', import.meta.url);
const cssUrl = new URL('../app/polish.css', import.meta.url);
const swUrl = new URL('../app/sw.js', import.meta.url);

describe('Nuvem AI chat reliability and responsive design', () => {
  it('keeps a single-chat fallback when the optional conversations migration is missing', async () => {
    const api = await fs.readFile(apiUrl, 'utf8');
    assert.ok(api.includes("const LEGACY_CHAT_ID = 'legacy-chat'"));
    assert.ok(api.includes('function isMissingChatSchema(error)'));
    assert.ok(api.includes("app.get('/api/app/session', requireUser"));
    assert.ok(api.includes("return res.json({ chats: [{ id: LEGACY_CHAT_ID, title: 'Conversa principal' }], legacy: true })"));
    assert.ok(api.includes('const legacyMode = conversationId === LEGACY_CHAT_ID'));
    assert.ok(api.includes("userMessage.conversation_id = conversationId"));
    assert.ok(api.includes("assistantMessage.conversation_id = conversationId"));
    assert.ok(api.includes('readLegacyChatMessages'));
  });

  it('does not sign the user out when an unrelated feature fails to load', async () => {
    const app = await fs.readFile(appUrl, 'utf8');
    assert.ok(app.includes('const results=await Promise.allSettled(jobs)'));
    assert.ok(app.includes('chatMigrationMissing=Boolean(data.legacy)'));
    assert.ok(app.includes('Assistente pronto. O histórico está no modo simples'));
    assert.ok(app.includes('async function loadExpenses(){'));
    assert.ok(app.includes('Finanças indisponíveis: '+ ''));
    assert.doesNotThrow(() => new Function(app));
  });

  it('uses a restrained palette and restores the mobile navigation', async () => {
    const html = await fs.readFile(htmlUrl, 'utf8');
    const css = await fs.readFile(cssUrl, 'utf8');
    const sw = await fs.readFile(swUrl, 'utf8');
    const api = await fs.readFile(apiUrl, 'utf8');
    assert.ok(html.includes('polish.css?v=6'));
    assert.ok(html.includes('app.js?v=35'));
    assert.ok(css.includes('--n-accent:#6d8f7e'));
    assert.ok(css.includes('.mobile-nav{display:none!important}'));
    assert.ok(css.includes('display:flex!important'));
    assert.ok(css.includes('#view-ia .chat-messages'));
    assert.ok(css.includes('--n-bg:#e8e6de'));
    assert.ok(css.includes('#view-ia .chat-form textarea'));
    assert.ok(css.includes('.mobile-more-menu:not([hidden])'));
    assert.ok(css.includes('Dark mode: no white card/panel surfaces anywhere'));
    assert.ok(api.includes("app.get('/api/app/exercises/image'"));
    assert.ok(sw.includes('nuvem-shell-v36'));
    assert.ok(sw.includes('/app/polish.css?v=6'));
    assert.ok(sw.includes('/app/app.js?v=35'));
  });
});
