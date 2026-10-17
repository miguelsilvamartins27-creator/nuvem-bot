import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import { fileTypeFromBuffer } from 'file-type';
import express from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import youtubedl from 'youtube-dl-exec';
import { montarMensagensVisao } from './visao.js';
import { pesquisarInternetArchive, pesquisarWikimediaCommons } from './viral/fontes.js';

const execFileAsync = promisify(execFile);
const MAX_MEDIA_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_MEDIA_OUTPUT_BYTES = 24 * 1024 * 1024;

const MAX_CHAT_CHARS = 4000;
const MAX_EXPENSE_DESCRIPTION = 160;

const rateBuckets = new Map();
function rateLimit({ windowMs, max, keyPrefix }) {
  return (req, res, next) => {
    const key = keyPrefix + ":" + (req.appUser?.id || req.ip || "unknown");
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) bucket = { startedAt: now, count: 0 };
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    if (rateBuckets.size > 5000) {
      for (const [storedKey, stored] of rateBuckets) {
        if (now - stored.startedAt >= windowMs) rateBuckets.delete(storedKey);
      }
    }
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000))));
      return sendError(res, 429, "Muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.");
    }
    return next();
  };
}
const limitChat = rateLimit({ windowMs: 60_000, max: 12, keyPrefix: "chat" });
const limitExpenses = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "expenses" });
const limitWellness = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "wellness" });
const limitProductivity = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "productivity" });

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

export function montarAppPessoal(app, { getSupabase, getAiRouter, sendWhatsAppSticker, sendWhatsAppAudio, env = process.env }) {
  const root = path.resolve('app');
  app.use('/app-assets', express.static(root, { index: false, dotfiles: 'deny', fallthrough: false, maxAge: '1h' }));
  app.get('/app', (_req, res) => res.sendFile(path.join(root, 'index.html')));
  app.get('/app/audio-editor', (_req, res) => res.sendFile(path.join(root, 'audio-editor.html')));
  app.get('/api/app/config', (_req, res) => {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.APP_ALLOWED_EMAIL) {
      return sendError(res, 503, 'O app ainda não foi configurado no servidor.');
    }
    return res.json({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY, vapidPublicKey: env.VAPID_PUBLIC_KEY || '' });
  });

  app.post('/api/app/push-subscriptions', requireUser, async (req, res) => {
    const subscription = req.body?.subscription;
    if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.endpoint.startsWith('https://') ||
        typeof subscription.keys?.p256dh !== 'string' || typeof subscription.keys?.auth !== 'string') {
      return sendError(res, 400, 'Inscrição de notificações inválida.');
    }
    const supabase = getSupabase();
    const { data: existing, error: lookupError } = await supabase.from('app_push_subscriptions')
      .select('user_id').eq('endpoint', subscription.endpoint).maybeSingle();
    if (lookupError) return sendError(res, 503, 'Não foi possível verificar este dispositivo.');
    if (existing && existing.user_id !== req.appUser.id) return sendError(res, 409, 'Este dispositivo já está vinculado a outra conta.');
    const { error } = await supabase.from('app_push_subscriptions').upsert({
      user_id: req.appUser.id, endpoint: subscription.endpoint, subscription,
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if (error) return sendError(res, 503, 'Não foi possível salvar este dispositivo. Verifique se a migração de notificações foi aplicada.');
    return res.status(201).json({ ok: true });
  });

  app.delete('/api/app/push-subscriptions', requireUser, async (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint.startsWith('https://')) return sendError(res, 400, 'Dispositivo inválido.');
    const { error } = await getSupabase().from('app_push_subscriptions').delete()
      .eq('user_id', req.appUser.id).eq('endpoint', endpoint);
    if (error) return sendError(res, 503, 'Não foi possível remover este dispositivo.');
    return res.json({ ok: true });
  });

  async function requireUser(req, res, next) {
    try {
      const header = req.get('authorization') || '';
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (!match) return sendError(res, 401, 'Entre na sua conta para continuar.');
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.getUser(match[1]);
      if (error || !data?.user) return sendError(res, 401, 'Sessão inválida. Entre novamente.');
      const allowed = String(env.APP_ALLOWED_EMAIL || '').trim().toLowerCase();
      if (!allowed || String(data.user.email || '').toLowerCase() !== allowed) {
        return sendError(res, 403, 'Esta conta não tem autorização para acessar o app.');
      }
      req.appUser = { id: data.user.id, email: data.user.email };
      req.appAccessToken = match[1];
      return next();
    } catch {
      return sendError(res, 503, 'Não foi possível validar sua sessão.');
    }
  }

  app.get('/api/app/session', requireUser, (req, res) => res.json({ ok: true, email: req.appUser.email }));

  app.get('/api/app/me', requireUser, async (req, res) => {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('app_profiles').select('display_name,assistant_name,language,response_style').eq('user_id', req.appUser.id).maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível carregar seu perfil. Verifique se a migração do banco foi aplicada.');
    return res.json({ email: req.appUser.email, profile: data || { display_name: '', assistant_name: 'Nuvem', language: 'pt-BR', response_style: 'balanced' } });
  });

  app.put('/api/app/me', requireUser, async (req, res) => {
    const body = req.body || {};
    const display_name = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 80) : '';
    const assistant_name = typeof body.assistant_name === 'string' ? body.assistant_name.trim().slice(0, 50) : 'Nuvem';
    const language = ['pt-BR', 'en', 'es'].includes(body.language) ? body.language : 'pt-BR';
    const response_style = ['direct', 'balanced', 'detailed'].includes(body.response_style) ? body.response_style : 'balanced';
    const supabase = getSupabase();
    const { error } = await supabase.from('app_profiles').upsert({ user_id: req.appUser.id, display_name, assistant_name, language, response_style, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) return sendError(res, 503, 'Não foi possível salvar seu perfil. Verifique se a migração do banco foi aplicada.');
    return res.json({ ok: true });
  });

  const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  const LEGACY_CHAT_ID = 'legacy-chat';
  function isMissingChatSchema(error) {
    const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
    const chatSchemaMentioned = message.includes('app_chat_conversations') || message.includes('conversation_id');
    return chatSchemaMentioned && (
      ['42p01', '42703', 'pgrst204', 'pgrst205'].includes(String(error?.code || '').toLowerCase()) ||
      /does not exist|could not find|schema cache|unknown column|column .* missing/.test(message)
    );
  }
  async function readLegacyChatMessages(supabase, userId, limit) {
    const { data, error } = await supabase.from('app_chat_messages')
      .select('id,role,content,created_at').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) return { data: null, error };
    return { data: (data || []).reverse(), error: null };
  }

  app.get('/api/app/chats', requireUser, async (req, res) => {
    const { data, error } = await getSupabase().from('app_chat_conversations')
      .select('id,title,created_at,updated_at').eq('user_id', req.appUser.id)
      .order('updated_at', { ascending: false }).limit(60);
    if (error) {
      if (!isMissingChatSchema(error)) return sendError(res, 503, 'Não foi possível carregar suas conversas.');
      const legacy = await getSupabase().from('app_chat_messages').select('id')
        .eq('user_id', req.appUser.id).limit(1);
      if (legacy.error) return sendError(res, 503, 'O histórico da IA ainda não está disponível. Verifique a migração básica do app no Supabase.');
      return res.json({ chats: [{ id: LEGACY_CHAT_ID, title: 'Conversa principal' }], legacy: true });
    }
    return res.json({ chats: data || [], legacy: false });
  });

  app.post('/api/app/chats', requireUser, async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : 'Nova conversa';
    const { data, error } = await getSupabase().from('app_chat_conversations')
      .insert({ user_id: req.appUser.id, title: title || 'Nova conversa' })
      .select('id,title,created_at,updated_at').single();
    if (error) {
      if (isMissingChatSchema(error)) return sendError(res, 409, 'O modo de várias conversas ainda não está ativado. A conversa principal continua disponível.');
      return sendError(res, 503, 'Não foi possível criar uma conversa.');
    }
    return res.status(201).json({ chat: data });
  });

  app.delete('/api/app/chats/:id', requireUser, async (req, res) => {
    if (!validUuid(req.params.id)) return sendError(res, 400, 'Conversa inválida.');
    const { data, error } = await getSupabase().from('app_chat_conversations').delete()
      .eq('id', req.params.id).eq('user_id', req.appUser.id).select('id').maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível excluir a conversa.');
    if (!data) return sendError(res, 404, 'Essa conversa não foi encontrada.');
    return res.json({ ok: true });
  });

  app.get('/api/app/chat', requireUser, async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 40));
    const supabase = getSupabase();
    let conversationId = String(req.query.conversation_id || '');
    if (conversationId === LEGACY_CHAT_ID) {
      const legacy = await readLegacyChatMessages(supabase, req.appUser.id, limit);
      if (legacy.error) return sendError(res, 503, 'Não foi possível carregar as mensagens. Verifique a migração básica do app.');
      return res.json({ messages: legacy.data || [], conversation_id: LEGACY_CHAT_ID, legacy: true });
    }
    if (!conversationId) {
      const { data: latest, error: latestError } = await supabase.from('app_chat_conversations')
        .select('id').eq('user_id', req.appUser.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (latestError) {
        if (!isMissingChatSchema(latestError)) return sendError(res, 503, 'Não foi possível carregar o chat.');
        const legacy = await readLegacyChatMessages(supabase, req.appUser.id, limit);
        if (legacy.error) return sendError(res, 503, 'Não foi possível carregar o histórico da IA.');
        return res.json({ messages: legacy.data || [], conversation_id: LEGACY_CHAT_ID, legacy: true });
      }
      conversationId = latest?.id || '';
    }
    if (!conversationId) return res.json({ messages: [] });
    if (!validUuid(conversationId)) return sendError(res, 400, 'Conversa inválida.');
    const { data: conversation, error: conversationError } = await supabase.from('app_chat_conversations')
      .select('id').eq('id', conversationId).eq('user_id', req.appUser.id).maybeSingle();
    if (conversationError) {
      if (isMissingChatSchema(conversationError)) {
        const legacy = await readLegacyChatMessages(supabase, req.appUser.id, limit);
        if (legacy.error) return sendError(res, 503, 'Não foi possível carregar o histórico da IA.');
        return res.json({ messages: legacy.data || [], conversation_id: LEGACY_CHAT_ID, legacy: true });
      }
      return sendError(res, 503, 'Não foi possível verificar esta conversa.');
    }
    if (!conversation) return sendError(res, 404, 'Conversa não encontrada.');
    const { data, error } = await supabase.from('app_chat_messages')
      .select('id,role,content,created_at').eq('user_id', req.appUser.id).eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }).limit(limit);
    if (error) return sendError(res, 503, 'Não foi possível carregar as mensagens desta conversa.');
    return res.json({ messages: data || [], conversation_id: conversationId, legacy: false });
  });

  app.post('/api/app/chat', requireUser, limitChat, async (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const conversationId = String(req.body?.conversation_id || '');
    if (!content || content.length > MAX_CHAT_CHARS) return sendError(res, 400, 'A mensagem deve ter entre 1 e 4000 caracteres.');
    const legacyMode = conversationId === LEGACY_CHAT_ID;
    if (!legacyMode && !validUuid(conversationId)) return sendError(res, 400, 'Crie ou selecione uma conversa antes de enviar mensagens.');
    const supabase = getSupabase();
    let conversation = null;
    if (!legacyMode) {
      const result = await supabase.from('app_chat_conversations')
        .select('id,title').eq('id', conversationId).eq('user_id', req.appUser.id).maybeSingle();
      if (result.error) {
        if (isMissingChatSchema(result.error)) return sendError(res, 409, 'O histórico de várias conversas precisa ser ativado no Supabase. Atualize a lista de conversas e tente novamente.');
        return sendError(res, 503, 'Não foi possível verificar a conversa.');
      }
      conversation = result.data;
      if (!conversation) return sendError(res, 404, 'Conversa não encontrada. Crie uma nova conversa e tente novamente.');
    }
    const { data: profile } = await supabase.from('app_profiles')
      .select('display_name,assistant_name,language,response_style').eq('user_id', req.appUser.id).maybeSingle();
    let recentQuery = supabase.from('app_chat_messages').select('role,content')
      .eq('user_id', req.appUser.id).order('created_at', { ascending: false }).limit(12);
    if (!legacyMode) recentQuery = recentQuery.eq('conversation_id', conversationId);
    const { data: recent, error: recentError } = await recentQuery;
    if (recentError) return sendError(res, 503, 'Não foi possível ler o histórico da conversa. Verifique a migração básica do app.');
    const lang = profile?.language || 'pt-BR';
    const style = profile?.response_style || 'balanced';
    const system = 'Você é ' + (profile?.assistant_name || 'Nuvem') + ', assistente pessoal. Responda no idioma ' + lang + '. Estilo: ' + style + '. Nome do usuário: ' + (profile?.display_name || 'não informado') + '. Não afirme ter executado ações que não executou.';
    try {
      const messages = [{ role: 'system', content: system }, ...(recent || []).reverse().map(m => ({ role: m.role, content: m.content })), { role: 'user', content }];
      const result = await getAiRouter().executar({ modalidade: 'texto', mensagens: messages, temperatura: 0.7, maxTokens: 1200 });
      const answer = String(result?.texto || '').trim().slice(0, 12000);
      if (!answer) return sendError(res, 502, 'A IA não retornou uma resposta.');
      const userMessage = { user_id: req.appUser.id, role: 'user', content };
      const assistantMessage = { user_id: req.appUser.id, role: 'assistant', content: answer };
      if (!legacyMode) {
        userMessage.conversation_id = conversationId;
        assistantMessage.conversation_id = conversationId;
      }
      const { error: saveUserError } = await supabase.from('app_chat_messages').insert(userMessage);
      if (saveUserError) return sendError(res, 503, 'A resposta foi gerada, mas não foi possível salvar a mensagem.');
      const { data: savedAssistant, error: saveAssistantError } = await supabase.from('app_chat_messages')
        .insert(assistantMessage).select('id,role,content,created_at').single();
      if (saveAssistantError) return sendError(res, 503, 'A resposta foi gerada, mas não foi possível salvar o histórico.');
      if (!legacyMode && conversation.title === 'Nova conversa') {
        const title = content.replace(/\s+/g, ' ').slice(0, 48) || 'Nova conversa';
        await supabase.from('app_chat_conversations').update({ title, updated_at: new Date().toISOString() })
          .eq('id', conversationId).eq('user_id', req.appUser.id);
      } else if (!legacyMode) {
        await supabase.from('app_chat_conversations').update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId).eq('user_id', req.appUser.id);
      }
      return res.json({ message: savedAssistant, legacy: legacyMode });
    } catch {
      return sendError(res, 502, 'A IA está indisponível no momento. Tente novamente mais tarde.');
    }
  });

  app.post('/api/app/chat/transcribe', requireUser, limitChat,
    express.raw({ type: req => String(req.headers['content-type'] || '').toLowerCase().startsWith('audio/'), limit: '12mb' }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length < 128) return sendError(res, 400, 'Envie um arquivo de áudio válido (até 12 MB).');
      if (!env.GROQ_API_KEY) return sendError(res, 503, 'A transcrição de áudio não está configurada no servidor (GROQ_API_KEY).');
      const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0].toLowerCase();
      const extensions = { 'audio/webm':'webm', 'audio/ogg':'ogg', 'audio/mp4':'m4a', 'audio/mpeg':'mp3', 'audio/mp3':'mp3', 'audio/wav':'wav', 'audio/x-wav':'wav', 'audio/aac':'aac', 'audio/flac':'flac', 'audio/m4a':'m4a' };
      const ext = extensions[mime];
      if (!ext) return sendError(res, 415, 'Formato não compatível. Envie MP3, M4A, WAV, OGG ou WEBM.');
      try {
        const form = new FormData();
        form.append('file', new Blob([req.body], { type: mime }), 'nuvem-audio.' + ext);
        form.append('model', 'whisper-large-v3-turbo');
        form.append('language', 'pt');
        form.append('response_format', 'json');
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY }, body: form, signal: AbortSignal.timeout(45000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return sendError(res, 502, result.error?.message || 'Não consegui transcrever esse áudio. Tente outro arquivo.');
        const text = String(result.text || '').trim().slice(0, MAX_CHAT_CHARS);
        if (!text) return sendError(res, 422, 'Não encontrei fala clara nesse áudio. Tente uma gravação mais nítida.');
        return res.json({ text });
      } catch {
        return sendError(res, 502, 'A transcrição está indisponível. Tente novamente em instantes.');
      }
    });

  // Proxy público e restrito às imagens da biblioteca de exercícios. Evita bloqueios de CDN no navegador.
  app.get('/api/app/exercises/image', async (req, res) => {
    const raw = typeof req.query.url === 'string' ? req.query.url.slice(0, 2048) : '';
    const allowed = value => value instanceof URL
      && value.protocol === 'https:'
      && value.hostname === 'static.exercisedb.dev'
      && !value.username && !value.password && !value.port;
    let target;
    try { target = new URL(raw); } catch { return sendError(res, 400, 'URL de imagem inválida.'); }
    if (!allowed(target)) return sendError(res, 400, 'Apenas imagens públicas da biblioteca de exercícios são aceitas.');
    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(target.href, {
          headers: { Accept: 'image/avif,image/webp,image/gif,image/png,image/jpeg' },
          signal: AbortSignal.timeout(8000),
          redirect: 'manual'
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || attempt > 0) return sendError(res, 502, 'A imagem do exercício redirecionou para uma fonte indisponível.');
          target = new URL(location, target);
          if (!allowed(target)) return sendError(res, 502, 'A fonte da imagem não é permitida.');
          continue;
        }
        break;
      }
      if (!response || !response.ok) return sendError(res, 502, 'A demonstração está temporariamente indisponível.');
      const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/gif', 'image/webp', 'image/png', 'image/jpeg', 'image/avif'].includes(contentType)) {
        return sendError(res, 415, 'A fonte não retornou uma imagem compatível.');
      }
      const declaredSize = Number(response.headers.get('content-length') || 0);
      if (declaredSize > 6 * 1024 * 1024) return sendError(res, 413, 'A imagem do exercício é grande demais.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 6 * 1024 * 1024) return sendError(res, 413, 'A imagem do exercício é inválida ou grande demais.');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(bytes);
    } catch {
      return sendError(res, 502, 'Não foi possível carregar a demonstração agora.');
    }
  });

  const exerciseSearchCache = new Map();
    const normalizeExerciseTerm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  app.get('/api/app/exercises', requireUser, limitWellness, async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    if (!search) return sendError(res, 400, 'Digite o nome de um exercício para pesquisar.');
    try {
      const aliasesPath = path.join(root, 'data', 'exercicios', 'aliases.json');
      const aliases = JSON.parse(await fs.readFile(aliasesPath, 'utf8'));
      const normalized = normalizeExerciseTerm(search);
      const alias = aliases.find(item => (item.terms || []).some(term => normalizeExerciseTerm(term) === normalized))
        || aliases.find(item => (item.terms || []).some(term => normalizeExerciseTerm(term).startsWith(normalized)))
        || aliases.find(item => (item.terms || []).some(term => normalizeExerciseTerm(term).includes(normalized)));
      const target = alias?.en || search;
      const cacheKey = normalizeExerciseTerm(target);
      let sourceItems = exerciseSearchCache.get(cacheKey);
      if (!sourceItems || sourceItems.expiresAt < Date.now()) {
        const url = new URL('https://oss.exercisedb.dev/api/v1/exercises');
        url.searchParams.set('search', target);
        url.searchParams.set('limit', '30');
        url.searchParams.set('offset', '0');
        const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
        if (!response.ok) return sendError(res, 502, 'A biblioteca de exercícios está temporariamente indisponível. Tente novamente em instantes.');
        const payload = await response.json();
        const candidates = Array.isArray(payload) ? payload
          : Array.isArray(payload?.data) ? payload.data
          : Array.isArray(payload?.exercises) ? payload.exercises
          : Array.isArray(payload?.results) ? payload.results
          : Array.isArray(payload?.items) ? payload.items
          : Array.isArray(payload?.data?.exercises) ? payload.data.exercises : [];
        sourceItems = { items: candidates, expiresAt: Date.now() + 10 * 60 * 1000 };
        exerciseSearchCache.set(cacheKey, sourceItems);
        if (exerciseSearchCache.size > 80) {
          for (const [key, value] of exerciseSearchCache) if (value.expiresAt < Date.now()) exerciseSearchCache.delete(key);
        }
      }
      const items = sourceItems.items.slice(0, 30).map(item => {
        let gifUrl = '';
        try {
          const candidate = new URL(item.gifUrl || item.gifURL || item.imageUrl || '');
          if (candidate.protocol === 'https:' && candidate.hostname === 'static.exercisedb.dev' && !candidate.username && !candidate.password && !candidate.port) {
            gifUrl = '/api/app/exercises/image?url=' + encodeURIComponent(candidate.href);
          }
        } catch {}
        const exerciseName = String(item.name || item.exerciseName || target).slice(0, 120);
        const itemAlias = aliases.find(entry => normalizeExerciseTerm(entry.en) === normalizeExerciseTerm(exerciseName))
          || aliases.find(entry => normalizeExerciseTerm(exerciseName).includes(normalizeExerciseTerm(entry.en)));
        const instructions = Array.isArray(item.instructions) ? item.instructions.map(step => String(step).replace(/^Step:\\s*\\d+\\s*:?\\s*/i, '').slice(0, 500)).filter(Boolean).slice(0, 10) : [];
        return {
          id: String(item.exerciseId || item.id || exerciseName).slice(0, 120),
          name: exerciseName,
          displayName: itemAlias?.pt || alias?.pt || exerciseName,
          group: itemAlias?.group || alias?.group || (Array.isArray(item.bodyParts) ? item.bodyParts[0] : ''),
          equipment: itemAlias?.equipment || (Array.isArray(item.equipments) ? item.equipments.join(', ') : ''),
          gifUrl,
          targetMuscles: Array.isArray(item.targetMuscles) ? item.targetMuscles.slice(0, 6) : [],
          secondaryMuscles: Array.isArray(item.secondaryMuscles) ? item.secondaryMuscles.slice(0, 6) : [],
          howTo: itemAlias?.how || instructions,
          cues: itemAlias?.cues || [],
          source: 'ExerciseDB · AscendAPI'
        };
      }).filter(item => item.gifUrl || item.howTo.length);
      return res.json({
        exercises: items,
        query: search,
        notice: items.length ? 'Demonstrações e instruções para consulta. Ajuste a execução ao seu corpo e peça orientação presencial se estiver aprendendo.' : 'Nenhum exercício apareceu para essa busca. Tente um nome popular como supino reto, puxada alta, leg press ou rosca direta.'
      });
    } catch {
      return sendError(res, 502, 'Não consegui carregar a biblioteca agora. Confira sua conexão e tente novamente.');
    }
  });

  app.get('/api/app/wellness', requireUser, async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    if (type && !['workout', 'meal'].includes(type)) return sendError(res, 400, 'Tipo de registro inválido.');
    let query = getSupabase().from('app_wellness_records').select('id,record_type,title,entry_date,payload,created_at').eq('user_id', req.appUser.id).order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(200);
    if (type) query = query.eq('record_type', type);
    const { data, error } = await query;
    if (error) return sendError(res, 503, 'Não foi possível carregar seus registros. Verifique se a migração app_wellness_records foi aplicada.');
    return res.json({ records: data || [] });
  });

  app.post('/api/app/wellness', requireUser, limitWellness, async (req, res) => {
    const record_type = typeof req.body?.record_type === 'string' ? req.body.record_type : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const entry_date = typeof req.body?.entry_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.entry_date) ? req.body.entry_date : new Date().toISOString().slice(0, 10);
    const payload = req.body?.payload;
    if (!['workout', 'meal'].includes(record_type) || !title || !payload || typeof payload !== 'object' || Array.isArray(payload)) return sendError(res, 400, 'Registro inválido. Informe o tipo, título e os dados.');
    if (JSON.stringify(payload).length > 12000) return sendError(res, 400, 'Este registro está muito grande. Reduza o texto e tente novamente.');
    const { data, error } = await getSupabase().from('app_wellness_records').insert({ user_id: req.appUser.id, record_type, title, entry_date, payload }).select('id,record_type,title,entry_date,payload,created_at').single();
    if (error) return sendError(res, 503, 'Não foi possível salvar. Verifique se a migração app_wellness_records foi aplicada no Supabase.');
    return res.status(201).json({ record: data });
  });

  app.delete('/api/app/wellness/:id', requireUser, limitWellness, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Identificador inválido.');
    const { data, error } = await getSupabase().from('app_wellness_records').delete().eq('user_id', req.appUser.id).eq('id', Number(req.params.id)).select('id').maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível excluir este registro.');
    if (!data) return sendError(res, 404, 'Registro não encontrado.');
    return res.json({ ok: true });
  });

  app.post('/api/app/nutrition/analyze-photo', requireUser, limitWellness, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return sendError(res, 400, 'Escolha uma foto JPG, PNG ou WebP.');
    const mime = (req.get('content-type') || '').toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return sendError(res, 415, 'Formato não suportado. Use JPG, PNG ou WebP.');
    try {
      const processed = await sharp(req.body).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const instruction = `Você é o assistente de alimentação da Nuvem. Analise apenas o que for visualmente plausível. Não é possível saber com certeza peso, ingredientes escondidos, óleo, molhos ou tamanho real da porção pela imagem. Responda em português claro com: alimentos que parecem presentes; porções apenas se for possível estimar; faixa ampla e aproximada de energia e nutrientes apenas se houver base razoável; nível de confiança e incertezas; uma pergunta curta para melhorar a estimativa. Se não houver base razoável, diga isso. Nunca trate o resultado como medição exata, diagnóstico ou prescrição. Não recomende restrição, jejum ou compensação por exercício. Mantenha uma abordagem equilibrada e sem julgamento.`;
      const messages = montarMensagensVisao({ base64: processed.toString('base64'), mimetype: 'image/jpeg', legenda: 'Analise esta refeição para me ajudar a identificar os alimentos. Seja prudente e explique as incertezas.', instrucao: instruction });
      const result = await getAiRouter().executar({ modalidade: 'visao', mensagens: messages, temperatura: 0.2, maxTokens: 900 });
      const analysis = String(result?.texto || '').trim().slice(0, 6000);
      if (!analysis) return sendError(res, 502, 'A IA não retornou uma análise. Tente uma foto nítida.');
      return res.json({ analysis, disclaimer: 'Estimativa visual, não medição exata. A foto não é salva automaticamente.' });
    } catch {
      return sendError(res, 502, 'Não consegui analisar esta foto agora. Tente uma imagem mais nítida ou registre a refeição manualmente.');
    }
  });

  app.get('/api/app/expenses', requireUser, async (req, res) => {
    const { data, error } = await getSupabase().from('app_expenses').select('id,description,amount,category,spent_at,created_at').eq('user_id', req.appUser.id).order('spent_at', { ascending: false }).limit(500);
    if (error) return sendError(res, 503, 'Não foi possível carregar as despesas. Verifique se a migração do banco foi aplicada.');
    return res.json({ expenses: data || [] });
  });

  app.post('/api/app/expenses', requireUser, limitExpenses, async (req, res) => {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const amount = Number(req.body?.amount);
    const category = typeof req.body?.category === 'string' ? req.body.category.trim().slice(0, 60) || 'Outros' : 'Outros';
    const spent_at = typeof req.body?.spent_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.spent_at) ? req.body.spent_at : new Date().toISOString().slice(0, 10);
    if (!description || description.length > MAX_EXPENSE_DESCRIPTION || !Number.isFinite(amount) || amount <= 0 || amount > 100000000) return sendError(res, 400, 'Informe uma descrição válida e um valor maior que zero.');
    const { data, error } = await getSupabase().from('app_expenses').insert({ user_id: req.appUser.id, description, amount, category, spent_at }).select('id,description,amount,category,spent_at,created_at').single();
    if (error) return sendError(res, 503, 'Não foi possível salvar a despesa. Verifique se a migração do banco foi aplicada.');
    return res.status(201).json({ expense: data });
  });

  app.delete('/api/app/expenses/:id', requireUser, limitExpenses, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Identificador inválido.');
    const { error, count } = await getSupabase().from('app_expenses').delete({ count: 'exact' }).eq('user_id', req.appUser.id).eq('id', Number(req.params.id));
    if (error) return sendError(res, 503, 'Não foi possível excluir a despesa.');
    if (!count) return sendError(res, 404, 'Despesa não encontrada.');
    return res.json({ ok: true });
  });

  app.get('/api/app/reminders', requireUser, async (req, res) => {
    const { data, error } = await getSupabase().from('app_reminders').select('id,title,note,remind_at,repeat_daily,remind_date,active,last_notified_at,last_notified_key,created_at').eq('user_id', req.appUser.id).order('created_at', { ascending: false }).limit(200);
    if (error) return sendError(res, 503, 'Não foi possível carregar os lembretes. A tabela app_reminders precisa ser criada no Supabase.');
    return res.json({ reminders: data || [] });
  });

  app.post('/api/app/reminders', requireUser, limitExpenses, async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 240) : '';
    const remind_at = typeof req.body?.remind_at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.remind_at) ? req.body.remind_at + ':00' : '';
    const repeat_daily = req.body?.repeat_daily === true;
    const remind_date = typeof req.body?.remind_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.remind_date) ? req.body.remind_date : null;
    let timezone = typeof req.body?.timezone === 'string' ? req.body.timezone : 'America/Sao_Paulo';
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { timezone = 'America/Sao_Paulo'; }
    if (!title || !remind_at || (!repeat_daily && !remind_date)) return sendError(res, 400, 'Informe o título, horário e data quando o lembrete não for diário.');
    const { data, error } = await getSupabase().from('app_reminders').insert({ user_id: req.appUser.id, title, note, remind_at, repeat_daily, remind_date, timezone, active: true }).select('id,title,note,remind_at,repeat_daily,remind_date,active,last_notified_at,last_notified_key,created_at').single();
    if (error) return sendError(res, 503, 'Não foi possível salvar. Verifique se a tabela app_reminders foi criada no Supabase.');
    return res.status(201).json({ reminder: data });
  });

  app.patch('/api/app/reminders/:id', requireUser, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Identificador inválido.');
    const update = {};
    if (typeof req.body?.active === 'boolean') update.active = req.body.active;
    if (!Object.keys(update).length) return sendError(res, 400, 'Nenhuma alteração válida foi informada.');
    const { data, error } = await getSupabase().from('app_reminders').update(update).eq('id', Number(req.params.id)).eq('user_id', req.appUser.id).select('id').maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível atualizar o lembrete.');
    if (!data) return sendError(res, 404, 'Lembrete não encontrado.');
    return res.json({ ok: true });
  });

  app.delete('/api/app/reminders/:id', requireUser, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Identificador inválido.');
    const { data, error } = await getSupabase().from('app_reminders').delete().eq('id', Number(req.params.id)).eq('user_id', req.appUser.id).select('id').maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível excluir o lembrete.');
    if (!data) return sendError(res, 404, 'Lembrete não encontrado.');
    return res.json({ ok: true });
  });

  app.get('/api/app/reminders/due', requireUser, async (req, res) => {
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : '';
    const time = typeof req.query.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.query.time) ? req.query.time + ':00' : '';
    if (!date || !time) return sendError(res, 400, 'Data e horário locais inválidos.');
    const { data, error } = await getSupabase().from('app_reminders').select('id,title,note,remind_at,repeat_daily,remind_date,last_notified_key').eq('user_id', req.appUser.id).eq('active', true).eq('remind_at', time).or('repeat_daily.eq.true,remind_date.eq.' + date).limit(50);
    if (error) return sendError(res, 503, 'Não foi possível verificar os lembretes.');
    return res.json({ reminders: (data || []).filter(item => item.last_notified_key !== date + 'T' + req.query.time) });
  });

  app.post('/api/app/reminders/:id/delivered', requireUser, async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return sendError(res, 400, 'Identificador inválido.');
    const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : '';
    const time = typeof req.body?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.time) ? req.body.time : '';
    if (!date || !time) return sendError(res, 400, 'Data e horário locais inválidos.');
    const { data, error } = await getSupabase().from('app_reminders').update({ last_notified_at: new Date().toISOString(), last_notified_key: date + 'T' + time }).eq('id', Number(req.params.id)).eq('user_id', req.appUser.id).eq('active', true).select('id').maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível registrar a notificação.');
    if (!data) return sendError(res, 404, 'Lembrete não encontrado.');
    return res.json({ ok: true });
  });


  // Media processing is private and in-memory/temp-file only. It never writes to
  // the WhatsApp auth table or stores user uploads permanently.
  const limitMedia = rateLimit({ windowMs: 60_000, max: 8, keyPrefix: "media" });
  app.post('/api/app/media/sticker', requireUser, limitMedia, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return sendError(res, 400, 'Escolha uma imagem antes de gerar a figurinha.');
    if (buffer.length > MAX_MEDIA_UPLOAD_BYTES) return sendError(res, 413, 'A imagem ultrapassa o limite de 12 MB.');
    const detected = await fileTypeFromBuffer(buffer).catch(() => null);
    if (!detected || !['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tif', 'tiff'].includes(detected.ext)) {
      return sendError(res, 415, 'O conteúdo não parece ser uma imagem compatível. Use JPG, PNG, WEBP, GIF ou AVIF.');
    }
    try {
      const metadata = await sharp(buffer, { animated: true, limitInputPixels: 40_000_000 }).metadata();
      if (!['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(metadata.format)) return sendError(res, 415, 'Formato de imagem não suportado. Use JPG, PNG, WEBP, GIF ou AVIF.');
      const sticker = await sharp(buffer, { animated: true, limitInputPixels: 40_000_000 })
        .rotate()
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 86, effort: 4 })
        .toBuffer();
      if (sticker.length > 1_000_000) return sendError(res, 413, 'A figurinha ficou muito grande. Tente uma imagem menor ou mais simples.');
      res.set({ 'Content-Type': 'image/webp', 'Content-Disposition': 'attachment; filename="nuvem-figurinha.webp"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.status(200).send(sticker);
    } catch {
      return sendError(res, 422, 'Não consegui ler essa imagem. Tente JPG, PNG, WEBP ou GIF.');
    }
  });


  app.post('/api/app/media/sticker-video', requireUser, limitMedia, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return sendError(res, 400, 'Escolha um vídeo para gerar a figurinha animada.');
    if (buffer.length > MAX_MEDIA_UPLOAD_BYTES) return sendError(res, 413, 'O vídeo ultrapassa o limite de 12 MB.');
    // Trust the detected file signature rather than the browser MIME header.
    // Some browsers label MOV/MKV files with non-video MIME types.
    const detected = await fileTypeFromBuffer(buffer).catch(() => null);
    if (!detected || !['mp4', 'webm', 'mov', 'mkv', 'avi', '3gp', 'mpeg'].includes(detected.ext)) return sendError(res, 415, 'O conteúdo do arquivo não parece ser um vídeo compatível.');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuvem-sticker-'));
    const input = path.join(dir, 'input.media');
    const output = path.join(dir, 'sticker.webp');
    try {
      await fs.writeFile(input, buffer, { flag: 'wx', mode: 0o600 });
      await execFileAsync(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', '6', '-an', '-vf', 'fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0', '-loop', '0', '-c:v', 'libwebp', '-quality', '65', '-compression_level', '4', '-pix_fmt', 'yuva420p', '-vsync', '0', '-f', 'webp', output], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      const stat = await fs.stat(output);
      if (!stat.isFile() || stat.size < 256) return sendError(res, 422, 'Não consegui gerar uma figurinha a partir desse vídeo.');
      if (stat.size > 1_000_000) return sendError(res, 413, 'A figurinha animada ficou acima de 1 MB. Tente um vídeo menor, com até 6 segundos.');
      const sticker = await fs.readFile(output);
      res.set({ 'Content-Type': 'image/webp', 'Content-Disposition': 'attachment; filename="nuvem-figurinha-animada.webp"', 'Content-Length': String(sticker.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.status(200).send(sticker);
    } catch {
      return sendError(res, 422, 'Não consegui processar esse vídeo. Tente MP4 curto com até 6 segundos.');
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  app.post('/api/app/media/sticker/send', requireUser, limitMedia, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return sendError(res, 400, 'A figurinha está vazia. Gere novamente.');
    if (buffer.length > 1_000_000) return sendError(res, 413, 'A figurinha ultrapassa o limite de envio.');
    const detected = await fileTypeFromBuffer(buffer).catch(() => null);
    if (!detected || detected.ext !== 'webp') return sendError(res, 415, 'O arquivo gerado não é uma figurinha WEBP válida.');
    if (typeof sendWhatsAppSticker !== 'function') return sendError(res, 503, 'O envio direto ao WhatsApp ainda não foi configurado.');
    try {
      await sendWhatsAppSticker(buffer);
      return res.json({ ok: true, message: 'Figurinha enviada ao seu WhatsApp.' });
    } catch (error) {
      const message = String(error?.message || '');
      return sendError(res, 503, /desconect|conectad|socket/i.test(message)
        ? 'O WhatsApp do servidor está desconectado. A figurinha será baixada como alternativa.'
        : 'Não consegui enviar ao WhatsApp agora. A figurinha será baixada como alternativa.');
    }
  });

  app.post('/api/app/media/audio', requireUser, limitMedia, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return sendError(res, 400, 'Escolha um vídeo ou áudio antes de converter.');
    if (buffer.length > MAX_MEDIA_UPLOAD_BYTES) return sendError(res, 413, 'O arquivo ultrapassa o limite de 12 MB.');
    // Validate the actual bytes, not only Content-Type: browsers and file pickers
    // sometimes send application/octet-stream or vendor-specific MIME values.
    const detected = await fileTypeFromBuffer(buffer).catch(() => null);
    if (!detected || !['mp4', 'webm', 'mov', 'mkv', 'avi', '3gp', 'mpeg', 'mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'aiff'].includes(detected.ext)) return sendError(res, 415, 'O conteúdo do arquivo não parece ser um áudio ou vídeo compatível.');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuvem-media-'));
    const input = path.join(dir, 'input.media');
    const output = path.join(dir, 'audio.mp3');
    try {
      await fs.writeFile(input, buffer, { flag: 'wx', mode: 0o600 });
      await execFileAsync(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', '-map_metadata', '-1', output], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      const stat = await fs.stat(output);
      if (!stat.isFile() || stat.size < 1024) return sendError(res, 422, 'O arquivo não contém uma faixa de áudio compatível.');
      if (stat.size > MAX_MEDIA_OUTPUT_BYTES) return sendError(res, 413, 'O áudio convertido ficou grande demais.');
      const mp3 = await fs.readFile(output);
      res.set({ 'Content-Type': 'audio/mpeg', 'Content-Disposition': 'attachment; filename="nuvem-audio.mp3"', 'Content-Length': String(mp3.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.status(200).send(mp3);
    } catch {
      return sendError(res, 422, 'Não consegui converter esse arquivo. Confira se ele está íntegro e contém áudio.');
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function pesquisarPlataformasDeAudio(query) {
    const pesquisas = [
      { prefix: 'ytsearch10:', source: 'YouTube', domain: 'youtube' },
      { prefix: 'scsearch8:', source: 'SoundCloud', domain: 'soundcloud' }
    ];
    const resultados = await Promise.allSettled(pesquisas.map(async pesquisa => {
      const data = await youtubedl(pesquisa.prefix + query, {
        dumpSingleJson: true, skipDownload: true, noWarnings: true,
        noCallHome: true, flatPlaylist: true, playlistEnd: 10,
        socketTimeout: 12, extractorRetries: 1
      });
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      return entries.map(entry => {
        let url = String(entry?.webpage_url || entry?.original_url || (String(entry?.url || '').startsWith('https://') ? entry.url : ''));
        if (!url && pesquisa.domain === 'youtube' && /^[\w-]{11}$/.test(String(entry?.id || ''))) {
          url = 'https://www.youtube.com/watch?v=' + entry.id;
        }
        let parsed;
        try { parsed = new URL(url); } catch { return null; }
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const permitido = pesquisa.domain === 'youtube'
          ? ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)
          : ['soundcloud.com', 'm.soundcloud.com'].includes(host);
        if (parsed.protocol !== 'https:' || !permitido) return null;
        const id = String(entry?.id || '');
        const embedUrl = pesquisa.domain === 'youtube' && /^[\w-]{11}$/.test(id)
          ? 'https://www.youtube-nocookie.com/embed/' + id
          : '';
        let thumbnail = pesquisa.domain === 'youtube' && /^[\w-]{11}$/.test(id)
          ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'
          : String(entry?.thumbnail || entry?.thumbnails?.at?.(-1)?.url || '');
        if (thumbnail) {
          try {
            const imageUrl = new URL(thumbnail);
            const imageHost = imageUrl.hostname.toLowerCase().replace(/^www\./, '');
            const validImageHost = pesquisa.domain === 'youtube'
              ? imageHost === 'i.ytimg.com' || imageHost === 'img.youtube.com'
              : imageHost.endsWith('.sndcdn.com') || imageHost === 'soundcloud.com';
            if (imageUrl.protocol !== 'https:' || !validImageHost) thumbnail = '';
            else thumbnail = imageUrl.href;
          } catch { thumbnail = ''; }
        }
        return {
          title: String(entry?.title || 'Áudio ou vídeo sem título').slice(0, 180),
          source: pesquisa.source + ' · resultado externo',
          license: 'Prévia e link oficial. O download depende das opções e dos direitos da plataforma.',
          url: parsed.href,
          embedUrl,
          thumbnail,
          downloadable: false,
          duration: Number.isFinite(Number(entry?.duration)) ? Number(entry.duration) : null,
          kind: 'external'
        };
      }).filter(Boolean);
    }));
    return resultados.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  }

  app.post('/api/app/media/audio/trim', requireUser, limitMedia, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return sendError(res, 400, 'Escolha um áudio ou vídeo para cortar.');
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    const fadeIn = Number(req.query.fadeIn || 0);
    const fadeOut = Number(req.query.fadeOut || 0);
    const volume = Number(req.query.volume || 100);
    const segmentDuration = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 600 || segmentDuration > 180) {
      return sendError(res, 400, 'Informe início e fim válidos. O corte pode ter até 3 minutos e terminar até 10 minutos.');
    }
    if (!Number.isFinite(fadeIn) || !Number.isFinite(fadeOut) || fadeIn < 0 || fadeOut < 0 || fadeIn > 10 || fadeOut > 10 || fadeIn + fadeOut > segmentDuration || !Number.isFinite(volume) || volume < 0 || volume > 200) {
      return sendError(res, 400, 'Confira os fades e o volume. Cada fade pode ter até 10 segundos e o volume de 0% a 200%.');
    }
    const detected = await fileTypeFromBuffer(buffer).catch(() => null);
    if (!detected || !['mp4','webm','mov','mkv','avi','3gp','mpeg','mp3','wav','ogg','oga','flac','m4a','aac','opus','aiff'].includes(detected.ext)) return sendError(res, 415, 'Esse arquivo não parece ser áudio ou vídeo compatível.');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuvem-audio-trim-'));
    const input = path.join(dir, 'input.media');
    const output = path.join(dir, 'audio-cortado.mp3');
    try {
      await fs.writeFile(input, buffer, { flag: 'wx', mode: 0o600 });
      const audioFilters = [];
      if (fadeIn > 0) audioFilters.push('afade=t=in:st=0:d=' + fadeIn);
      if (fadeOut > 0) audioFilters.push('afade=t=out:st=' + Math.max(0, segmentDuration - fadeOut) + ':d=' + fadeOut);
      if (volume !== 100) audioFilters.push('volume=' + (volume / 100));
      const args = ['-nostdin','-hide_banner','-loglevel','error','-y','-i',input,'-ss',String(start),'-t',String(segmentDuration),'-vn'];
      if (audioFilters.length) args.push('-af', audioFilters.join(','));
      args.push('-codec:a','libmp3lame','-b:a','192k','-map_metadata','-1',output);
      await execFileAsync(ffmpegPath, args, { timeout: 45000, maxBuffer: 1024*1024 });
      const stat = await fs.stat(output);
      if (!stat.isFile() || stat.size < 512) return sendError(res, 422, 'Não consegui cortar o arquivo. Confira os tempos e se ele contém áudio.');
      if (stat.size > MAX_MEDIA_OUTPUT_BYTES) return sendError(res, 413, 'O trecho ficou grande demais.');
      const mp3 = await fs.readFile(output);
      res.set({ 'Content-Type':'audio/mpeg','Content-Disposition':'attachment; filename="nuvem-audio-cortado.mp3"','Content-Length':String(mp3.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' });
      return res.status(200).send(mp3);
    } catch {
      return sendError(res, 422, 'Falha ao cortar o áudio. Tente outro arquivo ou um trecho menor.');
    } finally { await fs.rm(dir, { recursive:true, force:true }).catch(()=>{}); }
  });

  app.post('/api/app/media/audio/download', requireUser, limitMedia, async (req, res) => {
    let url;
    try { url = new URL(String(req.body?.url || '')); } catch { return sendError(res, 400, 'Link de áudio inválido.'); }
    const audioExtensions = /\.(?:mp3|wav|ogg|oga|flac|m4a|aac|opus|aiff)$/i;
    if (url.protocol !== 'https:' || !['upload.wikimedia.org','archive.org'].includes(url.hostname) || !audioExtensions.test(url.pathname)) {
      return sendError(res, 400, 'O download direto só funciona para arquivos de áudio de fontes abertas.');
    }
    let current = url;
    let upstream;
    try {
      for (let redirects = 0; redirects <= 4; redirects++) {
        const host = current.hostname.toLowerCase();
        const hostAllowed = host === 'upload.wikimedia.org' || host === 'archive.org' || host.endsWith('.archive.org');
        if (current.protocol !== 'https:' || !hostAllowed || !audioExtensions.test(current.pathname)) return sendError(res, 400, 'A fonte redirecionou para um endereço não permitido.');
        upstream = await fetch(current.href, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'NuvemAudio/1.0' } });
        if ([301,302,303,307,308].includes(upstream.status)) {
          const location = upstream.headers.get('location');
          if (!location || redirects === 4) return sendError(res, 502, 'A fonte redirecionou muitas vezes.');
          current = new URL(location, current);
          continue;
        }
        break;
      }
      if (!upstream?.ok) return sendError(res, 502, 'A fonte não disponibilizou o arquivo agora.');
      const length = Number(upstream.headers.get('content-length') || 0);
      if (length > MAX_MEDIA_UPLOAD_BYTES) return sendError(res, 413, 'O arquivo ultrapassa 12 MB. Escolha um arquivo menor ou corte um trecho no editor.');
      const arrayBuffer = await upstream.arrayBuffer();
      if (!arrayBuffer.byteLength || arrayBuffer.byteLength > MAX_MEDIA_UPLOAD_BYTES) return sendError(res, 413, 'O arquivo precisa ter até 12 MB.');
      const buffer = Buffer.from(arrayBuffer);
      const detected = await fileTypeFromBuffer(buffer).catch(() => null);
      if (!detected || !['mp3','mpeg','wav','ogg','oga','flac','m4a','aac','opus','aiff'].includes(detected.ext)) return sendError(res, 415, 'O link não retornou um arquivo de áudio compatível.');
      const base = path.basename(current.pathname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'nuvem-audio';
      res.set({ 'Content-Type': detected.mime || 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + base.replace(/"/g, '') + '"', 'Content-Length': String(buffer.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.status(200).send(buffer);
    } catch {
      return sendError(res, 502, 'Não consegui baixar o arquivo da fonte aberta. Tente abrir a fonte ou importar o arquivo no editor.');
    }
  });

  app.post('/api/app/media/audio/send', requireUser, limitMedia, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buffer.length) return sendError(res, 400, 'Prepare um áudio antes de enviar.');
    if (buffer.length > MAX_MEDIA_OUTPUT_BYTES) return sendError(res, 413, 'O áudio ultrapassa o limite de envio.');
    const detected = await fileTypeFromBuffer(buffer).catch(() => null);
    if (!detected || !['mp3','mpeg','wav','ogg','oga','flac','m4a','aac','opus'].includes(detected.ext)) return sendError(res, 415, 'O arquivo preparado não parece ser um áudio válido.');
    if (typeof sendWhatsAppAudio !== 'function') return sendError(res, 503, 'O envio direto de áudio ainda não está configurado.');
    try {
      await sendWhatsAppAudio(buffer);
      return res.json({ ok:true, message:'Áudio enviado ao WhatsApp conectado.' });
    } catch (error) {
      const message = String(error?.message || '');
      return sendError(res, 503, /desconect|conectad|socket/i.test(message) ? 'O WhatsApp do servidor está desconectado.' : 'Não consegui enviar o áudio ao WhatsApp agora.');
    }
  });

  app.post('/api/app/media/search-audio', requireUser, limitMedia, async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, 120) : '';
    if (query.length < 2) return sendError(res, 400, 'Digite pelo menos 2 caracteres para pesquisar.');
    try {
      const sources = await Promise.allSettled([
        pesquisarPlataformasDeAudio(query),
        pesquisarWikimediaCommons(query, { limite: 12, timeoutMs: 12000 }),
        pesquisarInternetArchive(query, { limite: 12, timeoutMs: 12000 })
      ]);
      const external = sources[0].status === 'fulfilled' ? sources[0].value : [];
      const openItems = sources.slice(1).flatMap(result => result.status === 'fulfilled' ? result.value : [])
        .filter(item => typeof item.url === 'string')
        .filter(item => {
          try {
            const url = new URL(item.url);
            return url.protocol === 'https:' && (url.hostname === 'upload.wikimedia.org' || url.hostname === 'archive.org');
          } catch { return false; }
        })
        .map(item => ({
          title: String(item.titulo || 'Áudio sem título').replace(/<[^>]*>/g, '').slice(0, 180),
          source: item.canal || item.fonte || 'Fonte aberta',
          license: String(item.licenca || 'Confira a licença na página da fonte').slice(0, 140),
          url: item.url, embedUrl: '', thumbnail: '', downloadable: /\.(?:mp3|wav|ogg|oga|flac|m4a|aac|opus|aiff)$/i.test(new URL(item.url).pathname), duration: Number.isFinite(item.duracao) ? item.duracao : null, kind: 'open'
        }));
      const unique = new Set();
      const items = [...external, ...openItems].filter(item => {
        if (unique.has(item.url)) return false;
        unique.add(item.url);
        return true;
      }).slice(0, 35).map((item, index) => ({ id: index + 1, ...item }));
      return res.json({
        results: items,
        notice: items.length
          ? `Encontramos ${items.length} opções em plataformas de áudio/vídeo e arquivos abertos. Resultados externos abrem na plataforma original; baixar e reutilizar depende dos direitos do conteúdo.`
          : 'Nenhum resultado respondeu nesta tentativa. Confira a conexão e tente novamente com o nome, artista ou uma descrição em inglês.'
      });
    } catch {
      return sendError(res, 502, 'As plataformas de áudio estão temporariamente indisponíveis. Tente novamente mais tarde.');
    }
  });


  // Importa um resultado público de áudio/vídeo para o editor sem mandar o usuário
  // para outra página. A URL é validada contra hosts conhecidos e não aceita playlists.
  app.post('/api/app/media/audio/import', requireUser, limitMedia, async (req, res) => {
    let url;
    try { url = new URL(String(req.body?.url || '')); } catch { return sendError(res, 400, 'Link de áudio inválido.'); }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
        !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host)) {
      return sendError(res, 400, 'Use um link HTTPS público de uma plataforma compatível. Links locais, privados ou com autenticação não são aceitos.');
    }
    try {
      const addresses = await lookup(host, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(entry => {
        try { return ipaddr.parse(entry.address).range() !== 'unicast'; } catch { return true; }
      })) return sendError(res, 400, 'Esse link não aponta para um endereço público seguro.');
    } catch {
      return sendError(res, 400, 'Não consegui verificar o endereço do link. Confira se ele está correto e público.');
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuvem-audio-import-'));
    const outputTemplate = path.join(dir, 'audio.%(ext)s');
    try {
      await youtubedl(url.href, {
        output: outputTemplate,
        format: 'bestaudio/best',
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: '5',
        noPlaylist: true,
        maxFilesize: '12M',
        matchFilter: 'duration <= 600',
        noWarnings: true,
        noCallHome: true,
        socketTimeout: 20,
        extractorRetries: 1,
        retries: 1
      });
      const entries = await fs.readdir(dir);
      const audioName = entries.find(name => /\.mp3$/i.test(name));
      if (!audioName) return sendError(res, 422, 'Não consegui preparar esse áudio. A plataforma pode não ser compatível, exigir login ou proteger o conteúdo; tente um link público direto ou um arquivo de até 12 MB.');
      const output = path.join(dir, audioName);
      const stat = await fs.stat(output);
      if (!stat.isFile() || stat.size < 1024) return sendError(res, 422, 'A plataforma não retornou um áudio válido.');
      if (stat.size > MAX_MEDIA_UPLOAD_BYTES) return sendError(res, 413, 'O áudio ultrapassa 12 MB. Escolha um resultado menor.');
      const mp3 = await fs.readFile(output);
      res.set({ 'Content-Type': 'audio/mpeg', 'Content-Disposition': 'attachment; filename="nuvem-audio-importado.mp3"', 'Content-Length': String(mp3.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.status(200).send(mp3);
    } catch (error) {
      const detail = String(error?.stderr || error?.message || '');
      const tooLong = /match filter|duration/i.test(detail);
      return sendError(res, 422, tooLong
        ? 'Esse resultado é longo demais para importação automática. Escolha um trecho/áudio de até 10 minutos.'
        : 'Não consegui importar esse resultado. Ele pode estar indisponível, protegido ou não permitir extração. Tente outro resultado ou importe um arquivo seu.');
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });


  // Account-scoped productivity endpoints. Never trust user_id from the request body.
  const taskSelect = 'id,title,description,status,priority,due_date,created_at,updated_at';
  const noteSelect = 'id,title,content,is_pinned,created_at,updated_at';
  const validDateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));

  app.get('/api/app/tasks', requireUser, limitProductivity, async (req, res) => {
    const { data, error } = await getSupabase().from('app_tasks').select(taskSelect)
      .eq('user_id', req.appUser.id).order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }).limit(200);
    if (error) return sendError(res, 503, 'Não foi possível carregar as tarefas. Aplique a migração productivity_workspace no Supabase.');
    return res.json({ tasks: data || [] });
  });

  app.post('/api/app/tasks', requireUser, limitProductivity, async (req, res) => {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const priority = ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium';
    const dueDate = body.due_date === null || body.due_date === '' || body.due_date === undefined ? null : body.due_date;
    if (!title || title.length > 160) return sendError(res, 400, 'O título da tarefa deve ter entre 1 e 160 caracteres.');
    if (typeof body.description !== 'undefined' && typeof body.description !== 'string') return sendError(res, 400, 'Os detalhes da tarefa são inválidos.');
    if (description.length > 2000) return sendError(res, 400, 'Os detalhes podem ter até 2.000 caracteres.');
    if (dueDate !== null && !validDateOnly(dueDate)) return sendError(res, 400, 'Informe uma data de prazo válida.');
    const { data, error } = await getSupabase().from('app_tasks').insert({ user_id: req.appUser.id, title, description, priority, due_date: dueDate, status: 'pending' }).select(taskSelect).single();
    if (error) return sendError(res, 503, 'Não foi possível salvar a tarefa. Verifique se a migração de produtividade foi aplicada.');
    return res.status(201).json({ task: data });
  });

  app.patch('/api/app/tasks/:id', requireUser, limitProductivity, async (req, res) => {
    if (!validUuid(req.params.id)) return sendError(res, 400, 'Identificador de tarefa inválido.');
    const body = req.body || {}, updates = { updated_at: new Date().toISOString() };
    if (Object.hasOwn(body, 'title')) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 160) return sendError(res, 400, 'O título deve ter entre 1 e 160 caracteres.');
      updates.title = body.title.trim();
    }
    if (Object.hasOwn(body, 'description')) {
      if (typeof body.description !== 'string' || body.description.trim().length > 2000) return sendError(res, 400, 'Os detalhes podem ter até 2.000 caracteres.');
      updates.description = body.description.trim();
    }
    if (Object.hasOwn(body, 'status')) {
      if (!['pending', 'in_progress', 'completed'].includes(body.status)) return sendError(res, 400, 'Status de tarefa inválido.');
      updates.status = body.status;
    }
    if (Object.hasOwn(body, 'priority')) {
      if (!['low', 'medium', 'high'].includes(body.priority)) return sendError(res, 400, 'Prioridade inválida.');
      updates.priority = body.priority;
    }
    if (Object.hasOwn(body, 'due_date')) {
      const dueDate = body.due_date === '' ? null : body.due_date;
      if (dueDate !== null && !validDateOnly(dueDate)) return sendError(res, 400, 'Informe uma data de prazo válida.');
      updates.due_date = dueDate;
    }
    if (Object.keys(updates).length === 1) return sendError(res, 400, 'Nenhuma alteração válida foi enviada.');
    const { data, error } = await getSupabase().from('app_tasks').update(updates).eq('id', req.params.id).eq('user_id', req.appUser.id).select(taskSelect).maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível atualizar a tarefa.');
    if (!data) return sendError(res, 404, 'Tarefa não encontrada.');
    return res.json({ task: data });
  });

  app.delete('/api/app/tasks/:id', requireUser, limitProductivity, async (req, res) => {
    if (!validUuid(req.params.id)) return sendError(res, 400, 'Identificador de tarefa inválido.');
    const { data, error } = await getSupabase().from('app_tasks').delete().eq('id', req.params.id).eq('user_id', req.appUser.id).select('id').maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível excluir a tarefa.');
    if (!data) return sendError(res, 404, 'Tarefa não encontrada.');
    return res.json({ ok: true });
  });

  app.get('/api/app/notes', requireUser, limitProductivity, async (req, res) => {
    const { data, error } = await getSupabase().from('app_notes').select(noteSelect).eq('user_id', req.appUser.id)
      .order('is_pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(200);
    if (error) return sendError(res, 503, 'Não foi possível carregar as notas. Aplique a migração productivity_workspace no Supabase.');
    return res.json({ notes: data || [] });
  });

  app.post('/api/app/notes', requireUser, limitProductivity, async (req, res) => {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const content = typeof body.content === 'string' ? body.content : '';
    const isPinned = typeof body.is_pinned === 'boolean' ? body.is_pinned : false;
    if (!title || title.length > 160) return sendError(res, 400, 'O título da nota deve ter entre 1 e 160 caracteres.');
    if (typeof body.content !== 'undefined' && typeof body.content !== 'string') return sendError(res, 400, 'O conteúdo da nota é inválido.');
    if (content.length > 20000) return sendError(res, 400, 'A nota pode ter até 20.000 caracteres.');
    const { data, error } = await getSupabase().from('app_notes').insert({ user_id: req.appUser.id, title, content, is_pinned: isPinned }).select(noteSelect).single();
    if (error) return sendError(res, 503, 'Não foi possível salvar a nota. Verifique se a migração de produtividade foi aplicada.');
    return res.status(201).json({ note: data });
  });

  app.patch('/api/app/notes/:id', requireUser, limitProductivity, async (req, res) => {
    if (!validUuid(req.params.id)) return sendError(res, 400, 'Identificador de nota inválido.');
    const body = req.body || {}, updates = { updated_at: new Date().toISOString() };
    if (Object.hasOwn(body, 'title')) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 160) return sendError(res, 400, 'O título deve ter entre 1 e 160 caracteres.');
      updates.title = body.title.trim();
    }
    if (Object.hasOwn(body, 'content')) {
      if (typeof body.content !== 'string' || body.content.length > 20000) return sendError(res, 400, 'A nota pode ter até 20.000 caracteres.');
      updates.content = body.content;
    }
    if (Object.hasOwn(body, 'is_pinned')) {
      if (typeof body.is_pinned !== 'boolean') return sendError(res, 400, 'O estado de fixação é inválido.');
      updates.is_pinned = body.is_pinned;
    }
    if (Object.keys(updates).length === 1) return sendError(res, 400, 'Nenhuma alteração válida foi enviada.');
    const { data, error } = await getSupabase().from('app_notes').update(updates).eq('id', req.params.id).eq('user_id', req.appUser.id).select(noteSelect).maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível atualizar a nota.');
    if (!data) return sendError(res, 404, 'Nota não encontrada.');
    return res.json({ note: data });
  });

  app.delete('/api/app/notes/:id', requireUser, limitProductivity, async (req, res) => {
    if (!validUuid(req.params.id)) return sendError(res, 400, 'Identificador de nota inválido.');
    const { data, error } = await getSupabase().from('app_notes').delete().eq('id', req.params.id).eq('user_id', req.appUser.id).select('id').maybeSingle();
    if (error) return sendError(res, 503, 'Não foi possível excluir a nota.');
    if (!data) return sendError(res, 404, 'Nota não encontrada.');
    return res.json({ ok: true });
  });

}
