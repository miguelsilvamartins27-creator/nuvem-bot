# Nuvem — app pessoal para iPhone

Esta pasta contém a primeira versão da interface web instalável (PWA) do app pessoal. É apenas a camada visual, não uma versão funcional completa nem um sistema de autenticação.

## O que existe nesta base
- Interface responsiva para iPhone e desktop.
- Navegação entre início, IA, mídia, finanças, histórico e configurações.
- Manifesto e service worker para instalação/cache da interface.
- Estados explícitos de preparação para não fingir que APIs já funcionam.
- Consulta visual do endpoint /health quando a interface é hospedada na mesma origem do backend.

## Antes de disponibilizar para uso real
1. Adicionar autenticação privada com Supabase Auth.
2. Verificar o token Supabase no servidor em todas as rotas privadas.
3. Nunca expor SUPABASE_SERVICE_ROLE_KEY, chaves Groq ou credenciais do WhatsApp no frontend.
4. Criar tabelas isoladas do app com políticas RLS e validar permissões.
5. Implementar endpoints autenticados para chat, finanças, perfil e ferramentas de mídia.
6. Definir limites de upload, tipo de arquivo, timeout e controle de custo.
7. Testar sem alterar a tabela/sessão Baileys existente.
8. Publicar apenas após testes de integração e revisão de segurança.

## Limitação desta etapa
O chat, as ferramentas de mídia e as finanças estão desativados até que as APIs seguras sejam implementadas. Os valores de finanças são intencionalmente vazios, não dados reais.
