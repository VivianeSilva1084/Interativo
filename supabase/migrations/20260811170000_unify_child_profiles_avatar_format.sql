-- Unifica o formato de child_profiles.avatar: de emoji literal (usado até
-- aqui pelo Ilha do Foco) para a chave em texto que o Aventura das Letras
-- (mesmo backend Supabase, projeto separado em d:\Projetos\Aventura das
-- letras) sempre usou - os dois apps liam a coluna do outro errado. Ver
-- src/lib/avatars.js (novo, client Ilha do Foco) para o mapeamento chave→
-- imagem espelhado; este UPDATE só corrige o que já está em produção,
-- dados novos já saem como chave direto do client daqui pra frente (nos
-- dois apps).

update public.child_profiles set avatar = 'capybara' where avatar = '🦫';
update public.child_profiles set avatar = 'turtle'   where avatar = '🐢';
update public.child_profiles set avatar = 'sloth'    where avatar = '🦥';
update public.child_profiles set avatar = 'frog'     where avatar = '🐸';
update public.child_profiles set avatar = 'hedgehog' where avatar = '🦔';
update public.child_profiles set avatar = 'koala'    where avatar = '🐨';

-- Valor órfão que não batia com nenhum avatar válido em nenhum dos dois
-- apps (nem emoji, nem uma das 6 chaves) - sem como saber qual bicho era,
-- normalizado pro padrão (capivara). O client (normalizeAvatarKey) já trata
-- qualquer valor desconhecido do mesmo jeito, então isso só limpa o dado.
update public.child_profiles set avatar = 'capybara' where avatar = 'kitten';
