# Fechamento contábil

Painel claro e instalável para a execução mensal das contas por empresa. A interface fica em `fechamento/` no GitHub Pages; autenticação, dados e permissões ficam no projeto Supabase da conta do administrador, separado do painel antigo. Nenhuma informação contábil deve ser publicada no GitHub.

## Ativação

1. No projeto Supabase `jbnqgchofaprjjwbuzpe`, execute `supabase/closing_schema.sql` no SQL Editor.
2. Importe uma única vez os dados históricos e atuais com o arquivo privado de migração, guardado fora do repositório. Não copie esse arquivo para o GitHub.
3. Crie ou localize o usuário administrador em **Authentication → Users** e vincule seu ID a `fc_members`, marcando `is_admin = true`. O administrador deve definir sua senha pela página de recuperação ou pelo convite da conta, sem compartilhar senha.
4. Implante `supabase/functions/fc-invite-member/index.ts` como Edge Function `fc-invite-member`. Desative **Verify JWT with legacy secret** nas configurações dessa função: o código valida a sessão do usuário e o perfil de administrador. As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo Supabase à função. A chave de serviço nunca vai para o navegador ou GitHub.
5. Em **Authentication → URL Configuration**, permita `https://tuliodubiella-arch.github.io/painel-rotinas-grupo-cavalca/fechamento/` como redirect URL. Em **Sign In / Providers**, desative cadastros públicos; novos usuários entram por convite. Configure o GitHub Pages para publicar a branch `main` a partir da raiz.
6. Teste convite, primeiro acesso, PLAY/PAUSE/STOP, sincronização em dois usuários, modo offline e fechamento completo antes de substituir o site atual.

O site atual não é alterado por esta implantação. Na migração, os apontamentos de teste de setembro/2026 são omitidos e os apontamentos reais de outubro/2026 são preservados.

## Operação

- A conta de cada responsável usa e-mail e senha próprios. A pessoa convidada define a senha pelo link recebido. Se já usa o mesmo Supabase, entra com a senha existente.
- A primeira entrada em cada aparelho precisa de internet. Depois disso, a interface e os dados já carregados funcionam offline; alterações ficam em fila até a conexão voltar. Não limpe os dados do navegador enquanto houver registros pendentes.
- Os horários de execução e recebimento são mostrados em Brasília/DF. O servidor mantém os instantes em UTC.
- Os dias úteis excluem sábados, domingos, feriados nacionais, 14/11 em Cascavel/PR, Corpus Christi de 2026 e feriados adicionais cadastrados no painel. Confirme feriados locais de anos futuros no cadastro.

