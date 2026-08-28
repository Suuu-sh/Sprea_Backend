import { MockCollector } from "./mock-collector";
import { runPipeline } from "./pipeline";
import type { Collector } from "./types";

const cors={"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"authorization,content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...cors}});
const authorized=(r:Request,e:Env)=>!e.ADMIN_TOKEN||r.headers.get("authorization")===`Bearer ${e.ADMIN_TOKEN}`;
const emptyCollector:Collector={collect:async()=>[]};

async function dashboard(db:D1Database){
  const account=await db.prepare("SELECT initial_cash_yen,available_cash_yen,reserved_cash_yen FROM paper_accounts WHERE id=1").first<any>();
  const opportunities=await db.prepare(`SELECT o.id,p.name,p.model_number,o.buy_cost_yen,o.expected_revenue_yen,o.market_profit_yen,o.detected_at,
    (SELECT sl.source FROM price_snapshots ps JOIN source_listings sl ON sl.id=ps.listing_id WHERE ps.id=o.buy_snapshot_id) purchase_source,
    (SELECT sl.source FROM price_snapshots ps JOIN source_listings sl ON sl.id=ps.listing_id WHERE ps.id=o.sell_snapshot_id) buyback_source
    FROM opportunities o JOIN products p ON p.id=o.product_id ORDER BY o.detected_at DESC LIMIT 100`).all<any>();
  const trades=await db.prepare("SELECT COUNT(*) count FROM paper_trades WHERE status='OPEN'").first<any>();
  const evals=await db.prepare("SELECT outcome,realized_profit_yen FROM evaluations WHERE horizon_hours=48").all<any>();
  const tp=evals.results.filter(x=>x.outcome==='buy_correct').length,fp=evals.results.filter(x=>x.outcome==='buy_failed').length,fn=evals.results.filter(x=>x.outcome==='missed_opportunity').length;
  const bought=evals.results.filter(x=>String(x.outcome).startsWith('buy_'));
  return {portfolio:{initialCapital:account?.initial_cash_yen??300000,lockedCapital:account?.reserved_cash_yen??0,availableCash:account?.available_cash_yen??300000,openTrades:trades?.count??0},
    opportunities:opportunities.results.map(x=>({canonicalKey:x.model_number,title:x.name,purchaseSource:x.purchase_source,buybackSource:x.buyback_source,purchasePrice:x.buy_cost_yen,purchaseShipping:0,buybackPrice:x.expected_revenue_yen,marketProfit:x.market_profit_yen,profitRate:x.buy_cost_yen?x.market_profit_yen/x.buy_cost_yen*100:0,buybackStoreCount:1,secondBuybackPrice:0,topTwoSpreadRate:0,return30Days:0,spreaScore:0,detectedAt:x.detected_at})),decisions:[],
    metrics48h:{evaluated:evals.results.length,buyCount:bought.length,precision:tp+fp?tp/(tp+fp):0,recall:tp+fn?tp/(tp+fn):0,missedOpportunities:fn,averageProfit:bought.length?bought.reduce((s,x)=>s+x.realized_profit_yen,0)/bought.length:0,maximumLoss:bought.length?Math.min(...bought.map(x=>x.realized_profit_yen)):0}};
}

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    if(url.pathname==="/health") return json({ok:true});
    if(url.pathname==="/admin/run"&&request.method==="POST"){
      if(!authorized(request,env)) return json({error:"unauthorized"},401);
      if(env.COLLECTOR_MODE!=="mock") return json({error:"mock collector is disabled in production"},409);
      return json(await runPipeline(env.DB,new MockCollector()));
    }
    if(url.pathname==="/api/research/dashboard") return json(await dashboard(env.DB));
    if(url.pathname==="/api/portfolio"){
      const account=await env.DB.prepare("SELECT * FROM paper_accounts WHERE id=1").first(); return json(account);
    }
    if(url.pathname==="/api/metrics"){
      const h=Number(url.searchParams.get("horizon")??48);
      const rows=await env.DB.prepare(`SELECT outcome,realized_profit_yen FROM evaluations WHERE horizon_hours=?`).bind(h).all<any>();
      const tp=rows.results.filter(x=>x.outcome==="buy_correct").length, fp=rows.results.filter(x=>x.outcome==="buy_failed").length, fn=rows.results.filter(x=>x.outcome==="missed_opportunity").length;
      const bought=rows.results.filter(x=>x.outcome.startsWith("buy_"));
      return json({horizon_hours:h,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,average_profit_yen:bought.length?bought.reduce((s,x)=>s+x.realized_profit_yen,0)/bought.length:null,max_loss_yen:bought.length?Math.min(...bought.map(x=>x.realized_profit_yen)):null,samples:rows.results.length});
    }
    return json({error:"not found"},404);
  },
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(runPipeline(env.DB,env.COLLECTOR_MODE==="mock"?new MockCollector():emptyCollector));}
} satisfies ExportedHandler<Env>;
