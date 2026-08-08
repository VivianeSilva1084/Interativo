// GAME 3: HISTÓRIA ("Monte a História") - order picture cards into the
// right sequence, training narrative sequencing. Imports session-state.js,
// game-shared.js, lib/i18n.js and lib/game-progress.js - never app.js, so
// app.js can import this module (to wire storyInit/storyStart into the
// onclick handlers in index.html) without a circular dependency.
// STORY_BANK is content data used only by this game, so it lives here
// rather than in a shared module.
import { state, session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';

const STORY_BANK = {
  pt: [
    { title:"O crescimento da planta", cards:["🌱","🌿","🪴","🌳","🍎"] },
    { title:"O dia de manhã", cards:["😴","⏰","🪥","👕","🎒"] },
    { title:"A borboleta", cards:["🥚","🐛","🍃","🛖","🦋"] },
    { title:"Fazendo um bolo", cards:["🥚","🥣","🧁","🎂","🥳"] },
    { title:"Um dia de chuva", cards:["☁️","🌧️","☔","🌈","☀️"] },
    { title:"A carta", cards:["✍️","✉️","📮","📬","📖"] },
    { title:"O pintinho", cards:["🥚","🐣","🐥","🌽","🐔"] }
  ],
  it: [
    { title:"La crescita della pianta", cards:["🌱","🌿","🪴","🌳","🍎"] },
    { title:"Il mattino", cards:["😴","⏰","🪥","👕","🎒"] },
    { title:"La farfalla", cards:["🥚","🐛","🍃","🛖","🦋"] },
    { title:"Facendo una torta", cards:["🥚","🥣","🧁","🎂","🥳"] },
    { title:"Una giornata di pioggia", cards:["☁️","🌧️","☔","🌈","☀️"] },
    { title:"La lettera", cards:["✍️","✉️","📮","📬","📖"] },
    { title:"Il pulcino", cards:["🥚","🐣","🐥","🌽","🐔"] }
  ]
};

let story = { correct:[], shuffled:[], answer:[], title:'', lastPickIdx:null, lastWasPerfect:true };

export function storyInit(){
  const t = L();
  document.getElementById('storyTitle').textContent = t.story.title;
  document.getElementById('storyStartBtn').textContent = t.startBtn;
  document.getElementById('storyResetBtn').textContent = t.playAgainBtn;
  document.getElementById('storyPreStart').style.display = 'flex';
  document.getElementById('storyPlayArea').style.display = 'none';
  document.getElementById('storyResetBtn').style.display = 'none';
  setInstructions('storyInstructions', t.story.instr('...'), true);
  hideFeedback('storyFeedback');
  renderDiffRow('storyDiffRow', 'historia');
}
export function storyStart(){
  const t = L();
  const cfg = DIFF.historia[getDifficulty('historia')];
  const bank = STORY_BANK[state.lang];
  let idx;
  if(!story.lastWasPerfect && story.lastPickIdx !== null && bank[story.lastPickIdx]){
    idx = story.lastPickIdx; // retry the same story after a wrong/partial attempt
  } else {
    do { idx = Math.floor(Math.random()*bank.length); } while(bank.length > 1 && idx === story.lastPickIdx);
  }
  story.lastPickIdx = idx;
  const pick = bank[idx];
  story.title = pick.title;
  story.correct = pick.cards.slice(0, cfg.len);
  story.answer = [];
  story.shuffled = [...story.correct].sort(()=>Math.random()-0.5);
  setInstructions('storyInstructions', t.story.instr(pick.title), true);
  document.getElementById('storyPreStart').style.display = 'none';
  document.getElementById('storyPlayArea').style.display = 'flex';
  document.getElementById('storyResetBtn').style.display = 'none';
  hideFeedback('storyFeedback');
  renderStoryCards(); renderStoryAnswer();
  window.instructionEndedAt = Date.now();
}
function renderStoryCards(){
  const wrap = document.getElementById('storyCards');
  wrap.innerHTML = '';
  story.shuffled.forEach(emoji=>{
    const used = story.answer.includes(emoji);
    const card = document.createElement('div');
    card.className = 'story-card';
    card.textContent = emoji;
    card.style.opacity = used ? '0.35' : '1';
    card.style.pointerEvents = used ? 'none' : 'auto';
    card.onclick = ()=>storyPick(emoji);
    wrap.appendChild(card);
  });
}
function renderStoryAnswer(){
  const wrap = document.getElementById('storyAnswer');
  wrap.innerHTML = '';
  for(let i=0;i<story.correct.length;i++){
    const slot = document.createElement('div');
    const filled = story.answer[i] !== undefined;
    slot.className = 'answer-slot' + (filled?' filled':'');
    slot.textContent = filled ? story.answer[i] : (i+1);
    wrap.appendChild(slot);
  }
}
function storyPick(emoji){
  if(story.answer.length >= story.correct.length) return;
  const rt = Date.now() - (window.instructionEndedAt || Date.now());
  window.instructionEndedAt = Date.now();
  story.answer.push(emoji);
  const isCorrect = emoji === story.correct[story.answer.length - 1];
  logGameEvent({ eventType: 'answer', targetType: 'instruction', target: story.title, responseValue: emoji, correct: isCorrect, responseTimeMs: rt });
  renderStoryCards(); renderStoryAnswer();
  if(story.answer.length === story.correct.length) checkStory();
}
function checkStory(){
  const t = L();
  let correctCount = 0;
  for(let i=0;i<story.correct.length;i++) if(story.answer[i] === story.correct[i]) correctCount++;
  const ratio = correctCount/story.correct.length;
  const stars = ratio===1?3: ratio>=0.6?2: ratio>0?1:0;
  setStars('historia', stars);
  session.sessionCompleted = true;
  logGameEvent({ eventType: 'activity_complete' });
  story.lastWasPerfect = correctCount === story.correct.length;
  if(story.lastWasPerfect){
    showFeedback('storyFeedback', t.story.perfect, true); addSeeds(6); say(t.mascotGood);
  } else {
    showFeedback('storyFeedback', t.story.partial(correctCount, story.correct.length), false); say(t.mascotTry);
  }
  document.getElementById('storyResetBtn').style.display = 'inline-block';
}
