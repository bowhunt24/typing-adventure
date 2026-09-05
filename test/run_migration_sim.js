// Simulates loading the app against a state shaped like what's actually sitting
// in production Supabase right now (pre-refactor field names: track, no
// curriculum/savings/wordLists/value fields) and checks the migration in
// init() upgrades it safely — no reset, no crash, no lost progress.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, "");
html = html.replace("</body>", `
<script>
window.__test = {
  getState: ()=>state,
  getCurricula: ()=>CURRICULA,
};
</script>
</body>`);

// Shape of the real pre-refactor saved row, with realistic in-progress data.
const legacyState = {
  parentPin: "1234",
  vault: [
    { id:"v1", threshold:100,  label:"Pick a small treat" },
    { id:"v2", threshold:250,  label:"$5 for the toy fund" },
    { id:"v3", threshold:500,  label:"Choose a $15 toy" },
    { id:"v4", threshold:1000, label:"Big reward — $25 toward something special" },
    // The hand-typed stopgap Evan put on v6 to stop Elliott blowing past the
    // top of the ladder — the one-time rebalance should replace it.
    { id:"v6", threshold:100000, label:"Major reward — $50 toward something special", value:50 }
  ],
  redeemed: ["everit:v1", "everit:v2", "everit:v3", "everit:v4"],
  profiles: {
    // Everett as he actually stands in production today: mid-ladder on
    // Sentences (index 5). The seven advanced stages go in after Numbers &
    // Punctuation, so this index must not move.
    everit: { name:"Everett", avatar:"🏎️", theme:"supercar", track:"homerow", coins:1550, correct:400, attempts:420, stage:5, pin:"0319",
               weeklyRounds:6, weekId:"2026-W36", streak:1, longestStreak:1, lastPracticeDate:"2026-08-30" },
    // Elliott's row as it actually stands in production today: she has burned
    // all the way to stage 12 (Numbers & Punctuation) with the endless Speed
    // Trials the only thing left. The seven advanced stages are inserted after
    // her current stage and before Speed Trials, so this index must not move.
    elliott: { name:"Elliott", avatar:"🦄", theme:"sparkle", track:"letterhunt", curriculum:"sparkle", stage:12,
               coins:7710, savings:55, letterHits:{ E:32, L:32, I:32, O:32, T:32, A:14, B:14, C:14, D:14 },
               lettersMastered:["E","L","I","O","T","A","B","C","D"], pin:"1129",
               purchaseHistory:[{ date:"2026-09-03", item:"A paw patrol toy for $25", amount:25 }],
               speedBadges:{ bronze:false, silver:false, gold:false }, bestWpm:0,
               weeklyRounds:33, weekId:"2026-W36", streak:1, longestStreak:1, lastPracticeDate:"2026-09-05" },
    dad: { name:"Dad", avatar:"🔧", theme:"supercar", track:"homerow", coins:20, correct:10, attempts:12, stage:0,
           weeklyRounds:0, weekId:null, streak:0, longestStreak:0, lastPracticeDate:null, leaderboardEligible:false }
  }
};

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "https://example.com/",
  beforeParse(window){
    window.speechSynthesis = undefined;
    window.AudioContext = undefined;
    window.alert = ()=>{};
    window.confirm = ()=>true;
    window.supabase = {
      createClient(){
        return {
          from(){
            return {
              select(){ return { eq(){ return { maybeSingle: async ()=> ({ data: { state: legacyState }, error: null }) }; } }; },
              upsert: async ()=> ({ error: null })
            };
          }
        };
      }
    };
  }
});

const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

(async ()=>{
  for(let i=0;i<50 && !window.__test.getState();i++) await wait(20);
  const state = window.__test.getState();
  if(!state) throw new Error("state never loaded");

  const everett = state.profiles.everit;
  const elliott = state.profiles.elliott;
  const dad = state.profiles.dad;
  const sparkle = window.__test.getCurricula().sparkle;

  const checks = [
    ["Everett's supercar ladder grew to 16 stages", window.__test.getCurricula().supercar.length === 16],
    ["Elliott's sparkle ladder grew to 21 stages", sparkle.length === 21],

    ["Everett kept his coins", everett.coins === 1550],
    ["Everett curriculum migrated to supercar", everett.curriculum === "supercar"],
    ["Everett kept his in-progress stage (5 = Sentences, unchanged index)", everett.stage === 5],
    ["Everett kept his streak", everett.streak === 1 && everett.longestStreak === 1],
    ["Everett got new profile fields (savings/badges/bestWpm)", everett.savings === 0 && everett.speedBadges && typeof everett.bestWpm === "number"],
    ["Everett's 4 redemptions preserved", state.redeemed.filter(r=>r.startsWith("everit:")).length === 4],

    ["Elliott kept her coins", elliott.coins === 7710],
    ["Elliott kept her savings and logged purchase", elliott.savings === 55 && elliott.purchaseHistory.length === 1],
    ["Elliott curriculum migrated to sparkle", elliott.curriculum === "sparkle"],
    ["Elliott kept her in-progress stage (12), the advanced stages went in after it", elliott.stage === 12],
    ["Elliott is still on Numbers & Punctuation", sparkle[elliott.stage].label === "Numbers & Punctuation"],
    ["Elliott's earlier bridge stages are still where they were",
      ["Word Builder","Word Play","First Sentences","Story Sentences"]
        .every((label, i)=> sparkle[4 + i] && sparkle[4 + i].label === label)],
    ["Bridge stages are still untimed and spoken aloud",
      sparkle.slice(4, 8).every(s=> s.timed === false && s.speak === true)],
    ["Elliott still merges back into the shared ladder after the bridge", sparkle[8].label === "Short Words"],
    ["Elliott's next seven stages are the new advanced ladder",
      ["Big Words","Real Sentences","Tricky Punctuation","Two-Sentence Stories","Paragraph Practice","Story Paragraphs","Typing Champion"]
        .every((label, i)=> sparkle[elliott.stage + 1 + i] && sparkle[elliott.stage + 1 + i].label === label)],
    ["Speed Trials is still the endless final stage for both kids",
      sparkle[sparkle.length-1].label === "Speed Trials" && sparkle[sparkle.length-1].repeatable === true
      && window.__test.getCurricula().supercar[15].label === "Speed Trials"],
    ["Everett's advanced ladder starts right after Numbers & Punctuation",
      window.__test.getCurricula().supercar[7].label === "Numbers & Punctuation" && window.__test.getCurricula().supercar[8].label === "Big Words"],
    ["Advanced stages ask for tighter accuracy than 80%",
      sparkle.slice(13, 20).every(s=> (s.passAccuracy||80) >= 85)],
    ["Paragraph stages ask for repeat clears and fewer items per round",
      sparkle.slice(17, 20).every(s=> s.roundsToPass >= 2 && s.itemsPerRound <= 2)],
    ["Nothing before the advanced ladder had its gate changed",
      sparkle.slice(0, 13).every(s=> !s.passAccuracy && !s.roundsToPass)],
    ["Both kids start the new ladder with a clean clear counter",
      JSON.stringify(elliott.stageClears) === "{}" && JSON.stringify(everett.stageClears) === "{}"],
    ["Elliott's weekly rounds and streak survived", elliott.weeklyRounds === 33 && elliott.streak === 1],
    ["Elliott's old lettersMastered/letterHits preserved (dormant history)", elliott.lettersMastered.length === 9 && elliott.letterHits.L === 32],
    ["Elliott got new profile fields", typeof elliott.savings === "number" && elliott.speedBadges && typeof elliott.bestWpm === "number"],

    ["Dad curriculum migrated to supercar", dad.curriculum === "supercar"],
    ["Dad still excluded from leaderboard", dad.leaderboardEligible === false],

    ["Vault tiers backfilled with $ values", state.vault.find(t=>t.id==="v2").value === 5 && state.vault.find(t=>t.id==="v1").value === 0],
    ["New higher vault tiers (v5-v10) were added", ["v5","v6","v7","v8","v9","v10"].every(id=> state.vault.some(t=>t.id===id))],
    ["The stretched ladder reaches past Elliott's current coin count",
      state.vault.filter(t=> t.threshold > elliott.coins).length >= 5],
    ["Rank ladders climb past where both kids already are (neither is at the top)",
      window.getRankInfo("sparkle", elliott.coins).next !== null && window.getRankInfo("supercar", everett.coins).next !== null],
    ["Elliott's rank reflects her 7,710 coins", window.getRankInfo("sparkle", elliott.coins).current.name === "Moonlight Rider"],
    ["Existing 4 tiers were not duplicated", state.vault.filter(t=>["v1","v2","v3","v4"].includes(t.id)).length === 4],
    ["The 100000 stopgap on v6 was rebalanced onto the new ladder", state.vault.find(t=>t.id==="v6").threshold === 10000],
    ["Every tier sits at a distinct threshold once sorted for display",
      new Set(state.vault.map(t=>t.threshold)).size === state.vault.length],
    ["The rebalance is marked done so parent edits stick from here on", state.ladderVersion === 2],
    ["Redemption history and dollar values were left alone",
      state.redeemed.length === 4 && state.vault.find(t=>t.id==="v6").value === 50],

    ["Word lists preloaded with real content", state.wordLists && state.wordLists.sightWords && state.wordLists.sightWords.length > 0 && state.wordLists.capitalization.length > 0],
  ];

  let failed = 0;
  checks.forEach(([label, ok])=>{
    console.log((ok ? "✓" : "✗ FAIL") + " " + label);
    if(!ok) failed++;
  });

  if(failed){
    console.error(`\n${failed} migration check(s) failed.`);
    process.exit(1);
  }
  console.log("\nALL MIGRATION CHECKS PASSED — existing Supabase data upgrades safely.");
  process.exit(0);
})().catch(e=>{
  console.error("MIGRATION SIMULATION FAILED:", e);
  process.exit(1);
});
