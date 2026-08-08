// GAME 4: MINHA VEZ ('Minha Vez, Sua Vez') - pick the reply that stays on
// topic and waits for a turn in a scripted conversation, training turn-
// taking. Imports session-state.js, game-shared.js, lib/i18n.js and
// lib/game-progress.js - never app.js, so app.js can import this module
// (to wire chatInit/chatStart/chatContinue into the onclick handlers in
// index.html) without a circular dependency. CHAT_SCRIPT is content data
// used only by this game, so it lives here rather than in a shared module.
import { state, session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say, makeTtsBtn, makeTtsIcon } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';

const CHAT_SCRIPT = {
  pt: [
    { line:"Kapi: Oi! Eu adoro nadar no rio de manhã. E você, do que você mais gosta de brincar?",
      options:[ {text:"Eu gosto de jogar bola no parque!", ok:true},
                {text:"Ontem eu vi um desenho na TV que não tinha nada a ver...", ok:false, hint:"(muda de assunto sem responder à pergunta)"},
                {text:"Sabia que eu tenho um carrinho azul?? Olha aqui, olha aqui!", ok:false, hint:"(fala sem esperar e muda de assunto de repente)"} ]},
    { line:"Kapi: Que legal! E qual é sua cor favorita?",
      options:[ {text:"Minha cor favorita é o verde, que nem você!", ok:true},
                {text:"Eu não gosto de esperar minha vez de falar.", ok:false, hint:"(não responde à pergunta)"},
                {text:"Sabia que capivara também gosta de melancia??", ok:false, hint:"(muda de assunto de repente)"} ]},
    { line:"Kapi: Melancia é deliciosa mesmo! 🍉 O que você faria se um amigo quisesse brincar de outra coisa que você não gosta?",
      options:[ {text:"Eu podia falar com calma que prefiro outra brincadeira, e ver se dá pra combinar.", ok:true},
                {text:"Eu ia gritar que não quero.", ok:false, hint:"(reação muito forte, difícil pro amigo entender)"},
                {text:"Ia embora sem falar nada.", ok:false, hint:"(não conta o que está sentindo)"} ]},
    { line:"Kapi: Você pode me contar sobre seu animal favorito?",
      options:[ {text:"Claro! Eu gosto muito de cachorros, eles são super fofos.", ok:true},
                {text:"Animais são legais eu acho, mas ontem eu joguei videogame até tarde e...", ok:false, hint:"(começa a falar de outra coisa em vez de responder)"},
                {text:"Não sei, deixa eu te mostrar uma coisa aqui no meu bolso agora.", ok:false, hint:"(troca de assunto de repente, sem esperar)"} ]},
    { line:"Kapi: Última pergunta! O que você faria se alguém te interrompesse enquanto você está falando?",
      options:[ {text:"Eu podia pedir com educação: 'Posso terminar de falar, por favor?'", ok:true},
                {text:"Eu ia ficar quieto e nunca mais falar nada.", ok:false, hint:"(evita resolver a situação)"},
                {text:"Eu ia falar mais alto ainda por cima da pessoa.", ok:false, hint:"(também corta a vez da outra pessoa)"} ]},
    { line:"Kapi: Sabe, às vezes eu fico triste quando chove e não posso brincar lá fora. O que você faz quando não pode sair?",
      options:[ {text:"Eu gosto de desenhar ou ler um livro legal dentro de casa.", ok:true},
                {text:"Eu fico chorando muito até a chuva parar.", ok:false, hint:"(não ajuda a melhorar a situação)"},
                {text:"Eu adoro pular corda! Quer ver como eu pulo bem alto?", ok:false, hint:"(ignora o que o Kapi falou sobre a chuva)"} ]},
    { line:"Kapi: Qual foi a coisa mais engraçada que já aconteceu com você?",
      options:[ {text:"Uma vez meu cachorro escorregou no tapete e ficou me olhando com uma cara engraçada!", ok:true},
                {text:"Deixa eu te mostrar esse machucado que eu fiz no joelho.", ok:false, hint:"(muda de assunto para algo não engraçado)"},
                {text:"Eu não quero falar com você.", ok:false, hint:"(encerra a conversa de forma rude)"} ]},
    { line:"Kapi: Se você pudesse ter um superpoder, qual seria e por quê?",
      options:[ {text:"Eu queria poder voar, assim eu chegaria super rápido em qualquer lugar!", ok:true},
                {text:"E aí depois a gente vai jogar bola?", ok:false, hint:"(muda de assunto sem responder a pergunta)"},
                {text:"Eu ia ter todos os poderes do mundo, e você não teria nenhum!", ok:false, hint:"(resposta que pode chatear o amigo)"} ]},
    { line:"Kapi: E se a gente inventasse uma brincadeira nova agora? Como ela poderia ser?",
      options:[ {text:"A gente podia brincar de ser explorador do espaço! O que acha?", ok:true},
                {text:"Eu prefiro brincar de esconde-esconde e ponto final.", ok:false, hint:"(não escuta a ideia do amigo)"},
                {text:"Olha o avião passando lá no céu!", ok:false, hint:"(muda de assunto do nada)"} ]},
  ],
  it: [
    { line:"Kapi: Ciao! Adoro nuotare nel fiume la mattina. E tu, a cosa ti piace giocare di più?",
      options:[ {text:"A me piace giocare a palla al parco!", ok:true},
                {text:"Ieri ho visto un cartone che non c'entrava niente...", ok:false, hint:"(cambia argomento senza rispondere alla domanda)"},
                {text:"Sai che ho una macchinina blu?? Guarda, guarda!", ok:false, hint:"(parla senza aspettare e cambia argomento all'improvviso)"} ]},
    { line:"Kapi: Che bello! E qual è il tuo colore preferito?",
      options:[ {text:"Il mio colore preferito è il verde, come te!", ok:true},
                {text:"Non mi piace aspettare il mio turno per parlare.", ok:false, hint:"(non risponde alla domanda)"},
                {text:"Sai che ai capibara piace anche l'anguria??", ok:false, hint:"(cambia argomento all'improvviso)"} ]},
    { line:"Kapi: L'anguria è davvero deliziosa! 🍉 Cosa faresti se un amico volesse giocare a qualcosa che a te non piace?",
      options:[ {text:"Potrei dire con calma che preferisco un altro gioco, e vedere se troviamo un accordo.", ok:true},
                {text:"Mi metterei a urlare che non voglio.", ok:false, hint:"(reazione troppo forte, difficile da capire per l'amico)"},
                {text:"Me ne andrei senza dire niente.", ok:false, hint:"(non spiega cosa sta provando)"} ]},
    { line:"Kapi: Mi racconti qual è il tuo animale preferito?",
      options:[ {text:"Certo! Mi piacciono molto i cani, sono super teneri.", ok:true},
                {text:"Gli animali sono carini credo, ma ieri ho giocato ai videogiochi fino a tardi e...", ok:false, hint:"(inizia a parlare d'altro invece di rispondere)"},
                {text:"Non lo so, fammi vedere una cosa che ho in tasca adesso.", ok:false, hint:"(cambia argomento all'improvviso, senza aspettare)"} ]},
    { line:"Kapi: Ultima domanda! Cosa faresti se qualcuno ti interrompesse mentre stai parlando?",
      options:[ {text:"Potrei chiedere gentilmente: 'Posso finire di parlare, per favore?'", ok:true},
                {text:"Starei zitto/a e non parlerei mai più.", ok:false, hint:"(evita di risolvere la situazione)"},
                {text:"Parlerei ancora più forte sopra l'altra persona.", ok:false, hint:"(toglie il turno anche all'altra persona)"} ]},
    { line:"Kapi: Sai, a volte sono triste quando piove e non posso giocare fuori. Tu cosa fai quando non puoi uscire?",
      options:[ {text:"Mi piace disegnare o leggere un bel libro in casa.", ok:true},
                {text:"Piango tantissimo finché non smette di piovere.", ok:false, hint:"(non aiuta a migliorare la situazione)"},
                {text:"Adoro saltare la corda! Vuoi vedere come salto in alto?", ok:false, hint:"(ignora quello che ha detto Kapi sulla pioggia)"} ]},
    { line:"Kapi: Qual è la cosa più divertente che ti è mai successa?",
      options:[ {text:"Una volta il mio cane è scivolato sul tappeto e mi ha guardato con una faccia buffissima!", ok:true},
                {text:"Fammi farti vedere questa ferita che mi sono fatto sul ginocchio.", ok:false, hint:"(cambia argomento su qualcosa di non divertente)"},
                {text:"Non voglio parlare con te.", ok:false, hint:"(chiude la conversazione in modo scortese)"} ]},
    { line:"Kapi: Se potessi avere un superpotere, quale sarebbe e perché?",
      options:[ {text:"Vorrei poter volare, così arriverei super veloce ovunque!", ok:true},
                {text:"E poi dopo andiamo a giocare a palla?", ok:false, hint:"(cambia argomento senza rispondere alla domanda)"},
                {text:"Avrei tutti i poteri del mondo, e tu non ne avresti nessuno!", ok:false, hint:"(risposta che potrebbe ferire l'amico)"} ]},
    { line:"Kapi: E se inventassimo un gioco nuovo adesso? Come potrebbe essere?",
      options:[ {text:"Potremmo giocare a fare gli esploratori dello spazio! Che ne dici?", ok:true},
                {text:"Preferisco giocare a nascondino e basta.", ok:false, hint:"(non ascolta l'idea dell'amico)"},
                {text:"Guarda quell'aereo che passa nel cielo!", ok:false, hint:"(cambia argomento all'improvviso)"} ]},
  ]
};

function setChatBubble(text){
  const el = document.getElementById('chatBubble');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.className = 'speech-text';
  span.textContent = text;
  el.appendChild(span);
  el.appendChild(makeTtsBtn(text, true));
}

let chat = { step:0, firstTryCorrect:0, triedThisTurn:false, willAdvance:false, turns:[] };
export function chatInit(){
  const t = L();
  document.getElementById('chatTitle').textContent = t.chat.title;
  setInstructions('chatInstructions', t.chat.instr, true);
  document.getElementById('chatStartBtn').textContent = t.startBtn;
  document.getElementById('chatPreStart').style.display = 'flex';
  document.getElementById('chatPlayArea').style.display = 'none';
  document.getElementById('turnIndicatorLabel').textContent = t.chat.turnLabel;
  document.getElementById('chatContinueBtn').textContent = t.continueBtn;
  document.getElementById('chatContinueBtn').style.display = 'none';
  hideFeedback('chatFeedback');
  renderDiffRow('chatDiffRow', 'minhavez');
}
export function chatStart(){
  const cfg = DIFF.minhavez[getDifficulty('minhavez')];
  const script = CHAT_SCRIPT[state.lang];
  const shuffled = [...script].sort(()=>Math.random()-0.5);
  chat.turns = shuffled.slice(0, cfg.turns);
  chat.showHint = cfg.hint;
  chat.step = 0; chat.firstTryCorrect = 0; chat.triedThisTurn = false;
  document.getElementById('chatPreStart').style.display = 'none';
  document.getElementById('chatPlayArea').style.display = 'flex';
  hideFeedback('chatFeedback');
  renderChatStep();
}
function renderChatStep(){
  document.getElementById('turnIndicator').style.display = 'none';
  document.getElementById('chatContinueBtn').style.display = 'none';
  if(chat.step >= chat.turns.length){ chatEnd(); return; }
  const s = chat.turns[chat.step];
  setChatBubble(s.line);
  const optWrap = document.getElementById('replyOptions');
  optWrap.innerHTML = '';
  const shuffled = [...s.options].sort(()=>Math.random()-0.5);
  shuffled.forEach(opt=>{
    const btn = document.createElement('button');
    btn.className = 'reply-btn';
    btn.innerHTML = opt.text + (chat.showHint && opt.hint ? `<span class="reply-hint">${opt.hint}</span>` : '');
    btn.onclick = ()=>chatPick(opt);
    btn.appendChild(makeTtsIcon(opt.text));
    optWrap.appendChild(btn);
  });
  window.instructionEndedAt = Date.now();
}
function chatPick(opt){
  const t = L();
  document.querySelectorAll('.reply-btn').forEach(b=>b.style.pointerEvents='none');
  const rt = Date.now() - (window.instructionEndedAt || Date.now());
  logGameEvent({ eventType: 'answer', targetType: 'dialog', responseValue: opt.text, correct: opt.ok, responseTimeMs: rt });
  if(opt.ok){
    if(!chat.triedThisTurn) chat.firstTryCorrect++;
    showFeedback('chatFeedback', t.chat.correct, true);
    chat.willAdvance = true;
  } else {
    chat.triedThisTurn = true;
    showFeedback('chatFeedback', t.chat.wrong, false);
    chat.willAdvance = false;
  }
  document.getElementById('turnIndicator').style.display = 'flex';
  document.getElementById('chatContinueBtn').style.display = 'inline-block';
}
export function chatContinue(){
  document.getElementById('chatContinueBtn').style.display = 'none';
  hideFeedback('chatFeedback');
  if(chat.willAdvance){
    chat.step++;
    chat.triedThisTurn = false;
  }
  renderChatStep(); // same turn repeats if the last answer was wrong, otherwise moves on
}
function chatEnd(){
  session.sessionCompleted = true;
  logGameEvent({ eventType: 'activity_complete' });
  const t = L();
  setChatBubble(t.chat.closing);
  document.getElementById('replyOptions').innerHTML = '';
  document.getElementById('turnIndicator').style.display = 'none';
  const ratio = chat.firstTryCorrect/chat.turns.length;
  const stars = ratio===1?3: ratio>=0.5?2: ratio>0?1:0;
  setStars('minhavez', stars); addSeeds(chat.firstTryCorrect*3);
  showFeedback('chatFeedback', t.chat.result(chat.firstTryCorrect, chat.turns.length), true);
  say(stars>=2 ? t.mascotGood : t.mascotTry);
}
