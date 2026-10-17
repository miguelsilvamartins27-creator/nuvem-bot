# Nuvem — app pessoal para iPhone

A pasta contém a interface PWA e a API inicial do app. Ainda é uma versão de desenvolvimento; não disponibilize dados pessoais até concluir configuração e testes.

## Interface e endpoints
- `GET /app/`: serve a interface.
- `GET /api/app/config`: entrega apenas URL do Supabase e chave anon pública para iniciar login.
- `/api/app/me`: perfil pessoal.
- `/api/app/chat`: histórico e conversa com o roteador de IA existente.
- `/api/app/expenses`: listar, registrar e excluir despesas.
- Todas as rotas de dados exigem token Bearer válido do Supabase Auth e correspondência exata com `APP_ALLOWED_EMAIL`.

## Configuração obrigatória no Render
Adicionar as variáveis abaixo sem remover as existentes:
- `SUPABASE_URL`: URL atual do projeto Supabase.
- `SUPABASE_ANON_KEY`: chave anon/public do mesmo projeto, nunca a service role.
- `APP_ALLOWED_EMAIL`: e-mail exato da única conta autorizada.

Manter as variáveis Groq e Supabase existentes do bot sem compartilhar seus valores. A service role continua somente no backend.

## Configuração no Supabase
1. Criar o usuário pessoal em Authentication → Users, com e-mail e senha fortes. Não há cadastro público no app.
2. Revisar e executar `app/supabase-migration.sql` no SQL Editor.
3. Confirmar que o usuário criado tem exatamente o e-mail definido em `APP_ALLOWED_EMAIL`.
4. Nunca executar comandos que apaguem ou recriem `baileys_auth`; a migração só cria tabelas novas do app.

## Limites e segurança
O servidor valida a sessão com Supabase Auth em cada rota privada e filtra os dados pelo ID do usuário validado. O app não recebe a chave service role nem a chave Groq. Chat limita cada mensagem a 4000 caracteres. A Central de mídia aceita imagens e GIFs para figurinhas WEBP, vídeos curtos para figurinhas animadas e arquivos de áudio/vídeo para conversão MP3. Limite de entrada: 12 MB; os arquivos temporários são apagados após a operação. Use HTTPS, MFA no painel e mantenha o repositório privado.

## Limitação importante
O login e as APIs dependem das variáveis de ambiente e da migração SQL. Não use finanças/histórico antes dessas etapas. O app ainda precisa de testes integrados no Render antes de ser considerado pronto.


## Central de mídia
- `POST /api/app/media/sticker`: converte imagem/GIF em WEBP de figurinha (até 12 MB de entrada; resultado até 1 MB).
- `POST /api/app/media/sticker-video`: cria WEBP animado a partir de vídeo curto (até 12 MB de entrada, 6 segundos de saída, resultado até 1 MB).
- `POST /api/app/media/audio`: extrai áudio para MP3 de arquivo de vídeo/áudio (até 12 MB de entrada, tempo limite de 30 s).
- `POST /api/app/media/search-audio`: pesquisa metadados em Wikimedia Commons e Internet Archive. A interface só exibe links HTTPS de domínios esperados.
- Todos os endpoints exigem sessão Supabase válida e e-mail autorizado. Há limite de oito operações de mídia por minuto e arquivos temporários são apagados ao final de cada operação.
- A pesquisa de áudio não faz download automático. A disponibilidade depende das fontes externas e o usuário deve respeitar as licenças de cada arquivo.
