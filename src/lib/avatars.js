// Avatares de perfil de criança - chave canônica compartilhada com o
// Aventura das Letras (mesma tabela child_profiles, mesmo conjunto de 6
// bichos). Antes desta unificação, este app salvava o avatar como emoji
// literal (ex: '🦫') enquanto o Aventura das Letras salvava a chave
// ('capybara') - os dois liam a coluna do outro errado. Chave vence porque
// é o que o Aventura das Letras já usa pra escolher a arte ilustrada
// (getAvatarImage), e essas mesmas imagens (assets/avatar_*.png) foram
// trazidas pra cá pra este app também deixar de mostrar emoji cru.

export const AVATAR_KEYS = ['capybara', 'turtle', 'sloth', 'frog', 'hedgehog', 'koala'];

const AVATAR_FILES = {
  capybara: 'avatar_capivara.png',
  turtle: 'avatar_tartaruga.png',
  sloth: 'avatar_preguica.png',
  frog: 'avatar_ra.png',
  hedgehog: 'avatar_porco-espinho.png',
  koala: 'avatar_coala.png',
};

// Perfis antigos salvos com o emoji direto (antes desta unificação) -
// normaliza na leitura pra nunca renderizar/gravar um valor inválido.
const LEGACY_EMOJI_TO_KEY = {
  '🦫': 'capybara', '🐢': 'turtle', '🦥': 'sloth',
  '🐸': 'frog', '🦔': 'hedgehog', '🐨': 'koala',
};

export function normalizeAvatarKey(value) {
  if (AVATAR_KEYS.includes(value)) return value;
  if (LEGACY_EMOJI_TO_KEY[value]) return LEGACY_EMOJI_TO_KEY[value];
  return AVATAR_KEYS[0];
}

export function avatarImageSrc(value) {
  return `assets/${AVATAR_FILES[normalizeAvatarKey(value)]}`;
}
