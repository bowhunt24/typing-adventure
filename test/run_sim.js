const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
// Drop the external Supabase CDN script — we stub `supabase` ourselves so this
// test runs with no network access.
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, "");

// The app's top-level `let`/`const` bindings (state, currentProfileKey,
// lessonQueue, CURRICULA, DEFAULT_WORD_LISTS, ...) live in the page's global
// lexical scope, not as `window.*` properties — only its top-level `function`
// declarations do. This second inline script shares that same lexical scope
// (both are classic scripts in one document), so it's the cleanest way to
// expose test hooks without touching app code or relying on string eval.
html = html.replace("</body>", `
<script>
window.__test = {
  getState: ()=>state,
  setCurrentProfileKey: (k)=>{ currentProfileKey = k; },
  getCurrentProfileKey: ()=>currentProfileKey,
  getLessonQueue: ()=>lessonQueue,
  getLessonIndex: ()=>lessonIndex,
  getCurrentScreen: ()=>currentScreen,
  getCurricula: ()=>CURRICULA,
  getDefaultWordLists: ()=>DEFAULT_WORD_LISTS
};
</script>
</body>`);

let savedState = null;

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "https://example.com/",
  beforeParse(window){
    window.speechSynthesis = undefined; // force speak() to no-op quietly
    window.AudioContext = undefined;
    window.alert = ()=>{ /* swallow */ };
    window.confirm = ()=>true;
    window.supabase = {
      createClient(){
        return {
          from(){
            return {
              select(){ return { eq(){ return { maybeSingle: async ()=> ({ data: savedState ? { state: savedState } : null, error: null }) }; } }; },
              upsert: async (row)=>{ savedState = row.state; return { error: null }; }
            };
          }
        };
      }
    };
  }
});

const { window } = dom;

function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function waitForInit(){
  for(let i=0;i<50;i++){
    if(window.__test.getState()) return;
    await wait(20);
  }
  throw new Error("state never initialized");
}

async function playThroughCurriculum(profileKey, label){
  window.__test.setCurrentProfileKey(profileKey);
  const state = window.__test.getState();
  const p = state.profiles[profileKey];
  const curriculum = window.__test.getCurricula()[p.curriculum];
  console.log(`\n=== ${label} (${curriculum.length} stages) ===`);

  let rounds = 0;
  // Every stage can ask for up to `roundsToPass` strong rounds before it
  // advances, so the guard has to budget for the slowest possible ladder.
  const totalGateRounds = curriculum.reduce((n, s)=> n + (s.roundsToPass || 1), 0);
  const MAX_ROUNDS = totalGateRounds + curriculum.length + 12;
  let clearsOnStage = 0;
  while(rounds < MAX_ROUNDS){
    rounds++;
    const stageBefore = Math.min(p.stage, curriculum.length - 1);
    const stageDefBefore = curriculum[stageBefore];
    const needRounds = stageDefBefore.roundsToPass || 1;
    clearsOnStage++;
    window.startLesson();
    if(window.__test.getCurrentScreen() !== "lesson") throw new Error("startLesson did not navigate to lesson screen");

    // Answer every character correctly, exactly as typed (handles requireCase stages).
    let guard = 0;
    while(window.__test.getLessonIndex() < window.__test.getLessonQueue().length){
      guard++;
      if(guard > 500) throw new Error("answer loop did not terminate — possible bug in charIndex/lessonIndex advance");
      const ch = window.currentChar();
      window.handleAnswer(ch, { exact: true });
    }
    await wait(350); // let the setTimeout(endLesson, 300) inside handleAnswer's last call fire

    const gate = `gate=${stageDefBefore.passAccuracy||80}%${needRounds>1?` x${needRounds} rounds`:""}`;
    console.log(`  stage ${stageBefore} (${stageDefBefore.label}, type=${stageDefBefore.type}${stageDefBefore.requireCase?", requireCase":""}${stageDefBefore.repeatable?", repeatable":""}, ${gate}, ${window.__test.getLessonQueue().length} items) -> round ${clearsOnStage}/${needRounds}, coins=${p.coins}, savings=$${p.savings}, bestWpm=${p.bestWpm}`);

    window.closeCompleteModal();

    if(!stageDefBefore.repeatable && stageBefore < curriculum.length - 1){
      if(clearsOnStage < needRounds){
        // Mid-gate: it must NOT have advanced yet, and the clear must be banked.
        if(p.stage !== stageBefore){
          throw new Error(`Stage ${stageBefore} advanced after ${clearsOnStage} of ${needRounds} required rounds — the repeat-clear gate is not being enforced`);
        }
        if((p.stageClears||{})[stageBefore] !== clearsOnStage){
          throw new Error(`Stage ${stageBefore} did not bank strong round ${clearsOnStage} (stageClears=${JSON.stringify(p.stageClears)})`);
        }
      } else {
        if(p.stage === stageBefore){
          throw new Error(`Stage ${stageBefore} did not advance after ${needRounds} 100% round(s) — advancement logic is broken`);
        }
        if((p.stageClears||{})[stageBefore] !== undefined){
          throw new Error(`Stage ${stageBefore} left a stale clear counter behind after advancing`);
        }
      }
    }
    if(p.stage !== stageBefore) clearsOnStage = 0;
    if(p.stage >= curriculum.length - 1 && curriculum[curriculum.length-1].repeatable && rounds > curriculum.length + 3){
      break;
    }
  }

  if(p.stage !== curriculum.length - 1){
    throw new Error(`Expected ${label} to reach the final stage (${curriculum.length - 1}), stuck at ${p.stage}`);
  }
  console.log(`  ✓ ${label} reached the final stage and the endless stage kept accepting rounds without erroring.`);
  console.log(`  final: coins=${p.coins}, savings=$${p.savings}, badges=${JSON.stringify(p.speedBadges)}, bestWpm=${p.bestWpm}`);
}

(async ()=>{
  await waitForInit();
  console.log("init() completed, state loaded:", !!window.__test.getState());

  const state = window.__test.getState();

  // Sanity: Elliott's migrated/fresh profile should start on the new bridge stage.
  const elliott = state.profiles.elliott;
  if(elliott.curriculum !== "sparkle") throw new Error("Elliott's curriculum did not default to sparkle");
  const CURRICULA = window.__test.getCurricula();
  if(CURRICULA.sparkle[0].type !== "sightwords") throw new Error("Sparkle curriculum should start with a sightwords bridge stage");
  console.log("Elliott starts at stage", elliott.stage, "=", CURRICULA.sparkle[elliott.stage].label);

  await playThroughCurriculum("elliott", "Elliott / Sparkle Trail");
  await playThroughCurriculum("everit", "Everett / Supercar Garage");

  // Vault + savings sanity: redeem every tier for Everett and confirm savings accumulates,
  // then log a purchase and confirm the balance draws down correctly.
  window.__test.setCurrentProfileKey("everit");
  const everett = state.profiles.everit;
  everett.coins = 999999;
  let expectedSavings = 0;
  state.vault.forEach(tier=>{ expectedSavings += tier.value || 0; });
  const origPrompt = window.prompt;
  window.prompt = ()=> state.parentPin; // auto-answer the parent PIN prompt
  state.vault.forEach(tier=>{ window.redeemVault(tier.id); });
  if(Math.abs(everett.savings - expectedSavings) > 0.001){
    throw new Error(`Expected savings ${expectedSavings}, got ${everett.savings}`);
  }
  console.log(`\n✓ Redeeming every vault tier banked $${everett.savings} into savings as expected.`);

  window.prompt = (msg)=>{
    if(/PIN/.test(msg)) return state.parentPin;
    if(/What did/.test(msg)) return "Big LEGO set";
    return String(everett.savings); // spend it all
  };
  const before = everett.savings;
  window.logPurchase();
  if(everett.savings !== 0) throw new Error(`Expected savings to hit 0 after spending it all, got ${everett.savings}`);
  if(everett.purchaseHistory.length !== 1) throw new Error("Purchase was not logged to history");
  console.log(`✓ Logged a $${before} purchase ("${everett.purchaseHistory[0].item}"), savings now $${everett.savings}.`);
  window.prompt = origPrompt;

  // Word list override sanity: a parent-edited list should be picked up by getWordList().
  state.wordLists.shortWords = ["zap", "pop"];
  const list = window.getWordList("shortWords");
  if(list.join(",") !== "zap,pop") throw new Error("getWordList() did not pick up a parent override");
  state.wordLists.shortWords = [];
  const DEFAULT_WORD_LISTS = window.__test.getDefaultWordLists();
  const fallback = window.getWordList("shortWords");
  if(fallback.join(",") !== DEFAULT_WORD_LISTS.shortWords.join(",")) throw new Error("getWordList() did not fall back to defaults when emptied");
  console.log("✓ getWordList() overrides and falls back correctly.");

  console.log("\nALL SIMULATION CHECKS PASSED");
  process.exit(0);
})().catch(e=>{
  console.error("\nSIMULATION FAILED:", e);
  process.exit(1);
});
