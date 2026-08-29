const baseUrl=(process.env.SPREA_API_URL??"https://sprea-research.suuu-sh.workers.dev").replace(/\/$/,"");
const token=process.env.SPREA_ADMIN_TOKEN;
if(!token)throw new Error("SPREA_ADMIN_TOKEN is required");

async function get(path,authenticated=true){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15_000);
 try{
  const response=await fetch(`${baseUrl}${path}`,{headers:authenticated?{authorization:`Bearer ${token}`}:{},signal:controller.signal});
  if(!response.ok)throw new Error(`${path} returned HTTP ${response.status}`);
  return await response.json();
 }finally{clearTimeout(timeout);}
}

const health=await get("/health",false);
if(health.ok!==true)throw new Error("health response is invalid");
const [dashboard,evaluator,trades,collector]=await Promise.all([
 get("/api/research/dashboard"),get("/api/research/evaluator"),get("/api/research/paper-trades"),get("/api/collector/status?limit=1")
]);
if(!Array.isArray(dashboard.opportunities)||!Array.isArray(dashboard.decisions))throw new Error("dashboard response is invalid");
if(!Array.isArray(evaluator.schedules)||!Array.isArray(evaluator.runs))throw new Error("evaluator response is invalid");
if(!Array.isArray(trades))throw new Error("paper trade response is invalid");
if(!Array.isArray(collector.runs))throw new Error("collector response is invalid");
const scored=dashboard.opportunities.filter(item=>Number.isFinite(item.spreaScore)&&item.scoreVersion==="rule-v1").length;
console.log(JSON.stringify({ok:true,collectorRuns:collector.runs.length,activeOpportunities:dashboard.opportunities.length,scoredOpportunities:scored,paperTrades:trades.length,evaluationSchedules:evaluator.schedules.length,evaluatorRuns:evaluator.runs.length}));
