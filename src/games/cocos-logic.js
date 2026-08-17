// Lógica pura de "Quantos Cocos?" - gera pares de quantidades pra comparação
// de magnitude (a criança escolhe qual pilha tem MAIS, sem contar) e as
// posições dos cocos em cada pilha. Sem DOM, sem Supabase, testável em
// isolamento. cocos.js (camada de interação) consome este módulo.

// Arranjos fixos tipo "padrão de dado" pra 1-3 cocos (nível fácil) - permitem
// reconhecimento perceptivo instantâneo (subitizing), nunca contagem serial.
// Quantidades acima de 3 só aparecem em níveis com canonical=false.
const CANONICAL = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 25], [70, 25], [50, 72]],
};

export function canonicalPositions(n) {
  return (CANONICAL[n] || CANONICAL[3]).map(([x, y]) => ({ x, y }));
}

// Espalha n pontos pseudo-aleatoriamente numa área quadrada (%), com raio
// mínimo entre pontos pra evitar sobreposição visual - obriga subagrupamento
// visual em vez de leitura em grade regular. Determinístico dado um rng, pra
// ser testável; se não conseguir encaixar todos com a distância mínima em
// tempo hábil, completa o restante sem a restrição (nunca trava).
export function scatterPositions(n, rng = Math.random) {
  const positions = [];
  let attempts = 0;
  while (positions.length < n && attempts < n * 40) {
    attempts++;
    const x = 15 + rng() * 70;
    const y = 15 + rng() * 70;
    if (positions.every(p => Math.hypot(p.x - x, p.y - y) > 22)) {
      positions.push({ x, y });
    }
  }
  while (positions.length < n) positions.push({ x: 15 + rng() * 70, y: 15 + rng() * 70 });
  return positions;
}

// Gera um par { left, right } de quantidades distintas entre 1 e maxQty, com
// razão (maior/menor) >= minRatio - garante que a comparação nunca fique mais
// ambígua do que o nível permite. Lado da maior quantidade é sorteado, pra
// não criar um viés posicional (ex: "a resposta certa é sempre a direita").
export function generateRoundPair(maxQty, minRatio, rng = Math.random) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const a = 1 + Math.floor(rng() * maxQty);
    const b = 1 + Math.floor(rng() * maxQty);
    if (a === b) continue;
    const ratio = Math.max(a, b) / Math.min(a, b);
    if (ratio >= minRatio) return rng() < 0.5 ? { left: a, right: b } : { left: b, right: a };
  }
  // Fallback determinístico (razão máxima possível pro nível) - só é
  // alcançado se minRatio estiver configurado perto do limite do maxQty.
  return rng() < 0.5 ? { left: 1, right: maxQty } : { left: maxQty, right: 1 };
}
