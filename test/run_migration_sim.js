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
    { id:"v4", threshold:1000, label:"Big reward — $25 toward something special" }
  ],
  redeemed: ["everit:v1", "everit:v2", "everit:v3", "everit:v4"],
  profiles: {
    everit: { name:"Everett", avatar:"🏎️", theme:"supercar", track:"homerow", coins:1230, correct:400, attempts:420, stage:5, pin:"0319",
               weeklyRounds:4, weekId:"2026-W35", streak:3, longestStreak:6, lastPracticeDate:"2026-08-31" },
    // Elliott's row as it actually stands in production today: already migrated
    // onto the sparkle curriculum, mid-ladder at stage 3 (Bottom Row), with real
    // coins, savings and a logged purchase. The four new bridge stages are
    // inserted AFTER the letter rows, so this index must not move.
    elliott: { name:"Elliott", avatar:"🦄", theme:"sparkle", track:"letterhunt", curriculum:"sparkle", stage:3,
               coins:3310, savings:20, letterHits:{ E:32, L:32, I:32, O:32, T:32, A:14, B:14, C:14, D:14 },
               lettersMastered:["E","L","I","O","T","A","B","C","D"], pin:"1129",
               purchaseHistory:[{ date:"2026-09-03", item:"A paw patrol toy for $25", amount:25 }],
               speedBadges:{ bronze:false, silver:false, gold:false }, bestWpm:0,
               weeklyRounds:22, weekId:"2026-W36", streak:1, longestStreak:1, lastPracticeDate:"2026-09-03" },
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
    ["Everett's supercar ladder is unchanged (9 stages)", window.__test.getCurricula().supercar.length === 9],
    ["Elliott's sparkle ladder is 14 stages", sparkle.length === 14],

    ["Everett kept his coins", everett.coins === 1230],
    ["Everett curriculum migrated to supercar", everett.curriculum === "supercar"],
    ["Everett kept his in-progress stage (5 = Sentences, unchanged index)", everett.stage === 5],
    ["Everett kept his streak", everett.streak === 3 && everett.longestStreak === 6],
    ["Everett got new profile fields (savings/badges/bestWpm)", everett.savings === 0 && everett.speedBadges && typeof everett.bestWpm === "number"],
    ["Everett's 4 redemptions preserved", state.redeemed.filter(r=>r.startsWith("everit:")).length === 4],

    ["Elliott kept her coins", elliott.coins === 3310],
    ["Elliott kept her savings and logged purchase", elliott.savings === 20 && elliott.purchaseHistory.length === 1],
    ["Elliott curriculum migrated to sparkle", elliott.curriculum === "sparkle"],
    ["Elliott kept her in-progress stage (3), the bridge was inserted after it", elliott.stage === 3],
    ["Elliott is still on Bottom Row", sparkle[elliott.stage].label === "Bottom Row"],
    ["Elliott's next four stages are the new word/sentence bridge",
      ["Word Builder","Word Play","First Sentences","Story Sentences"]
        .every((label, i)=> sparkle[elliott.stage + 1 + i] && sparkle[elliott.stage + 1 + i].label === label)],
    ["Bridge stages are untimed and spoken aloud",
      sparkle.slice(4, 8).every(s=> s.timed === false && s.speak === true)],
    ["Elliott still merges back into the shared ladder after the bridge", sparkle[8].label === "Short Words"],
    ["Elliott's weekly rounds and streak survived", elliott.weeklyRounds === 22 && elliott.streak === 1],
    ["Elliott's old lettersMastered/letterHits preserved (dormant history)", elliott.lettersMastered.length === 9 && elliott.letterHits.L === 32],
    ["Elliott got new profile fields", typeof elliott.savings === "number" && elliott.speedBadges && typeof elliott.bestWpm === "number"],

    ["Dad curriculum migrated to supercar", dad.curriculum === "supercar"],
    ["Dad still excluded from leaderboard", dad.leaderboardEligible === false],

    ["Vault tiers backfilled with $ values", state.vault.find(t=>t.id==="v2").value === 5 && state.vault.find(t=>t.id==="v1").value === 0],
    ["New higher vault tiers (v5/v6) were added", state.vault.some(t=>t.id==="v5") && state.vault.some(t=>t.id==="v6")],
    ["Existing 4 tiers were not duplicated", state.vault.filter(t=>["v1","v2","v3","v4"].includes(t.id)).length === 4],

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
