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
    elliott: { name:"Elliott", avatar:"🦄", theme:"sparkle", track:"letterhunt", coins:340, letterHits:{ E:5, L:9, I:4, O:3, T:6 }, lettersMastered:["E","L","I","O","T"], pin:"1129",
               weeklyRounds:6, weekId:"2026-W35", streak:5, longestStreak:5, lastPracticeDate:"2026-08-31" },
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

  const checks = [
    ["Everett kept his coins", everett.coins === 1230],
    ["Everett curriculum migrated to supercar", everett.curriculum === "supercar"],
    ["Everett kept his in-progress stage (5 = Sentences, unchanged index)", everett.stage === 5],
    ["Everett kept his streak", everett.streak === 3 && everett.longestStreak === 6],
    ["Everett got new profile fields (savings/badges/bestWpm)", everett.savings === 0 && everett.speedBadges && typeof everett.bestWpm === "number"],
    ["Everett's 4 redemptions preserved", state.redeemed.filter(r=>r.startsWith("everit:")).length === 4],

    ["Elliott kept her coins", elliott.coins === 340],
    ["Elliott curriculum migrated to sparkle", elliott.curriculum === "sparkle"],
    ["Elliott starts at stage 0 (new Sight Words bridge), not mid-curriculum", elliott.stage === 0],
    ["Elliott's old lettersMastered/letterHits preserved (dormant history)", elliott.lettersMastered.length === 5 && elliott.letterHits.L === 9],
    ["Elliott got new profile fields", elliott.savings === 0 && elliott.speedBadges && typeof elliott.bestWpm === "number"],

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
