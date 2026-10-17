import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  throw new Error('Configuração incompleta: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY são obrigatórios.');
}
webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
}

const now = new Date();
const { data: reminders, error } = await supabase.from('app_reminders')
  .select('id,user_id,title,note,remind_at,repeat_daily,remind_date,active,last_notified_key,timezone')
  .eq('active', true).limit(5000);
if (error) throw new Error('Não foi possível carregar os lembretes: ' + error.message);

let sent = 0, skipped = 0, failed = 0;
for (const reminder of reminders || []) {
  let local;
  try { local = localParts(now, reminder.timezone || 'America/Sao_Paulo'); }
  catch { local = localParts(now, 'America/Sao_Paulo'); }
  if (reminder.remind_at.slice(0, 5) !== local.time) { skipped++; continue; }
  if (!reminder.repeat_daily && reminder.remind_date !== local.date) { skipped++; continue; }
  const key = local.date + 'T' + local.time;
  if (reminder.last_notified_key === key) { skipped++; continue; }

  const { data: subscriptions, error: subError } = await supabase.from('app_push_subscriptions')
    .select('id,endpoint,subscription').eq('user_id', reminder.user_id).limit(100);
  if (subError) { failed++; continue; }
  if (!subscriptions?.length) { skipped++; continue; }

  const payload = JSON.stringify({
    title: 'Lembrete da Nuvem',
    body: reminder.title + (reminder.note ? ' — ' + reminder.note : ''),
    url: '/app/',
    tag: 'nuvem-reminder-' + reminder.id
  });
  let delivered = false;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub.subscription, payload, { TTL: 60, urgency: 'high' });
      delivered = true;
      sent++;
    } catch (error) {
      failed++;
      if (error.statusCode === 404 || error.statusCode === 410) {
        await supabase.from('app_push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
  if (delivered) {
    const update = { last_notified_at: now.toISOString(), last_notified_key: key };
    if (!reminder.repeat_daily) update.active = false;
    const { error: updateError } = await supabase.from('app_reminders').update(update)
      .eq('id', reminder.id).eq('user_id', reminder.user_id).eq('active', true);
    if (updateError) console.error('Falha ao registrar lembrete enviado:', reminder.id, updateError.message);
  }
}
console.log(JSON.stringify({ checked: reminders?.length || 0, sent, skipped, failed }));
