// Lógica pura do jogo "Cestas da Ilha" (Torre de Londres adaptada) - sem DOM,
// sem Supabase, testável em isolamento. cestas.js (camada de interação)
// consome este módulo. Estado do tabuleiro = array de arrays (cada cesta é
// uma pilha; o ÚLTIMO elemento é o topo/frente, o único que pode ser
// movido). Ex: [['🍎','🍌'], ['🍇'], []].

export function stateKey(boardState){
  return boardState.map(basket => basket.join(',')).join('|');
}

export function cloneState(boardState){
  return boardState.map(basket => [...basket]);
}

export function statesEqual(a, b){
  return stateKey(a) === stateKey(b);
}

// Lista todos os movimentos legais a partir de boardState: para cada cesta de
// origem não-vazia e cada cesta de destino diferente com espaço sobrando,
// retorna { from, to, nextState }.
export function enumerateMoves(boardState, capacities){
  const moves = [];
  for(let from = 0; from < boardState.length; from++){
    if(boardState[from].length === 0) continue;
    for(let to = 0; to < boardState.length; to++){
      if(to === from) continue;
      if(boardState[to].length >= capacities[to]) continue;
      const next = cloneState(boardState);
      const fruit = next[from].pop();
      next[to].push(fruit);
      moves.push({ from, to, nextState: next });
    }
  }
  return moves;
}

// BFS a partir da meta sobre o grafo de estados (o movimento é reversível -
// mover uma fruta de A pra B é desfeito movendo a mesma fruta de B pra A, se
// a capacidade permitir - então a distância até a meta, calculada a partir
// dela, é válida em qualquer direção). Espaço de estados é pequeno (poucas
// frutas/cestas), roda em milissegundos, síncrono.
export function bfsDistancesFromGoal(goalState, capacities){
  const distances = new Map();
  const goalKey = stateKey(goalState);
  distances.set(goalKey, 0);
  const queue = [goalState];
  let head = 0;
  while(head < queue.length){
    const current = queue[head++];
    const currentDist = distances.get(stateKey(current));
    for(const { nextState } of enumerateMoves(current, capacities)){
      const key = stateKey(nextState);
      if(!distances.has(key)){
        distances.set(key, currentDist + 1);
        queue.push(nextState);
      }
    }
  }
  return distances;
}

// Random walk de genMoves passos legais a partir da meta, evitando desfazer
// o passo anterior imediatamente (não escolhe o mesmo par origem/destino
// invertido em sequência - senão o scramble colapsa de volta na meta). Se
// depois de genMoves passos o resultado ainda for igual à meta, tenta de
// novo (até maxAttempts vezes) - se persistir, aceita mesmo assim (comum e
// esperado com poucas frutas, técnica padrão em tarefas tipo CANTAB SOC).
export function generateInitialState(goalState, capacities, genMoves, rng = Math.random, maxAttempts = 15){
  for(let attempt = 0; attempt < maxAttempts; attempt++){
    let current = cloneState(goalState);
    let lastMove = null;
    for(let step = 0; step < genMoves; step++){
      let candidates = enumerateMoves(current, capacities);
      if(lastMove){
        const filtered = candidates.filter(m => !(m.from === lastMove.to && m.to === lastMove.from));
        if(filtered.length > 0) candidates = filtered;
      }
      if(candidates.length === 0) break;
      const pick = candidates[Math.floor(rng() * candidates.length)];
      current = pick.nextState;
      lastMove = pick;
    }
    if(!statesEqual(current, goalState) || attempt === maxAttempts - 1) return current;
  }
  return cloneState(goalState);
}

// extra = movimentos além do mínimo necessário (minMoves, já calculado via
// BFS). 3 estrelas = plano ótimo; 2 = replanejou e conseguiu (a habilidade
// sendo bem praticada, não uma falha); 1 = resolveu por tentativa e erro.
export function computeStars(minMoves, movesUsed){
  const extra = movesUsed - minMoves;
  if(extra <= 0) return 3;
  if(extra <= 2) return 2;
  return 1;
}

export function moveCap(minMoves){
  return minMoves * 3 + 4;
}
