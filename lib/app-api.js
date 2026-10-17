import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import { fileTypeFromBuffer } from 'file-type';
import express from 'express';
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

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

export function montarAppPessoal(app, { getSupabase, getAiRouter, env = process.env }) {
  const root = path.resolve('app');
  app.use('/app-assets', express.static(root, { index: false, dotfiles: 'deny', fallthrough: false, maxAge: '1h' }));
  app.get('/app', (_req, res) => res.sendFile(path.join(root, 'index.html')));
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

  app.get('/api/app/chat', requireUser, async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 40));
    const { data, error } = await getSupabase().from('app_chat_messages').select('id,role,content,created_at').eq('user_id', req.appUser.id).order('created_at', { ascending: true }).limit(limit);
    if (error) return sendError(res, 503, 'Não foi possível carregar o histórico. Verifique se a migração do banco foi aplicada.');
    return res.json({ messages: data || [] });
  });

  app.post('/api/app/chat', requireUser, limitChat, async (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > MAX_CHAT_CHARS) return sendError(res, 400, 'A mensagem deve ter entre 1 e 4000 caracteres.');
    const supabase = getSupabase();
    const { data: profile } = await supabase.from('app_profiles').select('display_name,assistant_name,language,response_style').eq('user_id', req.appUser.id).maybeSingle();
    const { data: recent } = await supabase.from('app_chat_messages').select('role,content').eq('user_id', req.appUser.id).order('created_at', { ascending: false }).limit(12);
    const lang = profile?.language || 'pt-BR';
    const style = profile?.response_style || 'balanced';
    const system = `Você é ${profile?.assistant_name || 'Nuvem'}, assistente pessoal. Responda no idioma ${lang}. Estilo: ${style}. Nome do usuário: ${profile?.display_name || 'não informado'}. Não afirme ter executado ações que não executou.`;
    try {
      const messages = [{ role: 'system', content: system }, ...(recent || []).reverse().map(m => ({ role: m.role, content: m.content })), { role: 'user', content }];
      const result = await getAiRouter().executar({ modalidade: 'texto', mensagens: messages, temperatura: 0.7, maxTokens: 1200 });
      const answer = String(result?.texto || '').trim().slice(0, 12000);
      if (!answer) return sendError(res, 502, 'A IA não retornou uma resposta.');
      const { error: saveUserError } = await supabase.from('app_chat_messages').insert({ user_id: req.appUser.id, role: 'user', content });
      if (saveUserError) return sendError(res, 503, 'A resposta foi gerada, mas não foi possível salvar o histórico.');
      const { data: savedAssistant, error: saveAssistantError } = await supabase.from('app_chat_messages').insert({ user_id: req.appUser.id, role: 'assistant', content: answer }).select('id,role,content,created_at').single();
      if (saveAssistantError) return sendError(res, 503, 'A resposta foi gerada, mas não foi possível salvar o histórico.');
      return res.json({ message: savedAssistant });
    } catch {
      return sendError(res, 502, 'A IA está indisponível no momento. Tente novamente mais tarde.');
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

  app.post('/api/app/media/search-audio', requireUser, limitMedia, async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim().replace(/[\\u0000-\\u001f\\u007f]/g, ' ').slice(0, 120) : '';
    if (query.length < 2) return sendError(res, 400, 'Digite pelo menos 2 caracteres para pesquisar.');
    try {
      const results = await Promise.all([
        pesquisarWikimediaCommons(query, { limite: 4, timeoutMs: 7000 }),
        pesquisarInternetArchive(query, { limite: 4, timeoutMs: 7000 })
      ]);
      const items = results.flat().slice(0, 8).map((item, index) => ({
        id: index + 1,
        title: String(item.titulo || 'Áudio sem título').slice(0, 180),
        source: item.canal || item.fonte || 'Fonte aberta',
        url: item.url,
        duration: Number.isFinite(item.duracao) ? item.duracao : null
      }));
      return res.json({ results: items, notice: 'Resultados de fontes abertas; confira a licença e os termos de cada arquivo antes de reutilizar.' });
    } catch {
      return sendError(res, 502, 'As fontes de áudio estão temporariamente indisponíveis. Tente novamente mais tarde.');
    }
  });

}
