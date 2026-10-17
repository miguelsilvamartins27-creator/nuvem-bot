# Worker de notificações da Nuvem

Este worker envia lembretes por Web Push em segundo plano, inclusive quando a página do app não está aberta, desde que o dispositivo/navegador aceite notificações push.

## Configuração

1. Aplique primeiro a migração `supabase/migrations/20261016_app_reminders.sql` e depois `supabase/migrations/20261017_app_push.sql` no SQL Editor do Supabase. Não altere a tabela `baileys_auth`.
2. Gere as chaves VAPID localmente dentro desta pasta com `npm install` e `npm run generate-vapid`. **Não publique nem compartilhe `VAPID_PRIVATE_KEY`.**
3. Na configuração do serviço web da Nuvem no Render, adicione somente `VAPID_PUBLIC_KEY`.
4. Crie um serviço Cron Job no Render apontando para este repositório e para a branch que contém estas alterações. Configure:
   - Build command: `cd push-worker && npm install`
   - Start command: `cd push-worker && npm start`
   - Schedule: `* * * * *` (a cada minuto, em UTC; o worker converte para o fuso de cada lembrete)
   - Plano: o menor plano compatível com sua conta
5. No Cron Job, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`. Use os mesmos valores de Supabase já usados pela aplicação, sem colar segredos em chats, issues ou no GitHub. `VAPID_SUBJECT` deve ser um contato real seu, por exemplo `mailto:seu-email-real`.
6. Só depois de o serviço web receber a chave pública e o Cron Job estar configurado, abra o app e clique em **Ativar notificações neste dispositivo**.

## Segurança e custos

- A chave privada VAPID e a chave service-role ficam somente nas variáveis secretas do Cron Job; não as coloque no código nem na aplicação do navegador.
- A chave pública VAPID é pública e pode ficar na variável do serviço web.
- O Cron Job não deve ser criado sem revisar o preço exibido no Render. A documentação do Render informa cobrança mínima de US$ 1 por serviço Cron por mês, mesmo com execução curta. O custo pode variar conforme plano/uso.
- As notificações dependem das permissões do navegador, do sistema operacional, de conexão e do serviço push do fabricante. Não é possível garantir entrega instantânea em todo dispositivo.
- Esta configuração não exige alterações na sessão do WhatsApp.
