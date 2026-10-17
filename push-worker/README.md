# Worker de notificações da Nuvem

Este worker envia lembretes por Web Push em segundo plano, mesmo quando a página do app não está aberta, desde que o navegador e o sistema aceitem notificações push. A entrega pode atrasar e não é garantida em tempo real.

## Configuração sem serviço pago adicional

1. Aplique no SQL Editor do Supabase, nesta ordem, as migrações `20261016_app_reminders.sql` e `20261017_app_push.sql`. Não altere a tabela `baileys_auth`.
2. Gere um par de chaves VAPID em ambiente confiável:
   - Execute `npm install` e `npm run generate-vapid` dentro de `push-worker`.
   - Guarde a chave privada em local seguro. Nunca a publique, cole em mensagens ou coloque no código.
3. No serviço web da Nuvem no Render, adicione somente a variável `VAPID_PUBLIC_KEY`.
4. No GitHub, abra **Settings → Secrets and variables → Actions** e crie os secrets:
   - `SUPABASE_URL`: URL do projeto Supabase.
   - `SUPABASE_SERVICE_ROLE_KEY`: chave service-role do Supabase.
   - `VAPID_PUBLIC_KEY`: chave pública do par VAPID.
   - `VAPID_PRIVATE_KEY`: chave privada do par VAPID.
   - `VAPID_SUBJECT`: um contato real seu, no formato `mailto:seu-email-real`.
   Não compartilhe os valores desses secrets em chats, issues ou no código.
5. O workflow `.github/workflows/lembretes.yml` executa o worker a cada cinco minutos e também permite execução manual em **Actions → Lembretes da Nuvem → Run workflow**. O agendamento só funciona depois que o workflow estiver na branch padrão do repositório. O GitHub pode atrasar execuções; portanto, não é adequado para alarmes críticos nem garante o minuto exato.
6. Abra `https://nuvem-bot.onrender.com/app/`, entre na conta e ative as notificações no dispositivo. Faça um teste com um lembrete alguns minutos à frente.

## Limites e segurança

- Esta opção evita criar um Cron Job pago no Render, mas está sujeita às cotas e regras de uso do GitHub Actions.
- A chave privada VAPID e a chave service-role devem ficar somente nos secrets do GitHub; a chave pública VAPID também precisa estar no serviço web do Render.
- As notificações dependem de permissão do navegador, conexão, sistema operacional e serviço push. Não é possível garantir entrega instantânea.
- O worker não precisa nem deve modificar a sessão do WhatsApp em `baileys_auth`.
