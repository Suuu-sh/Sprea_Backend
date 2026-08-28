import { MockCollector } from "./mock-collector";
import { runPipeline } from "./pipeline";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const authorized=(r:Request,e:Env)=>!e.ADMIN_TOKEN||r.headers.get("authorization")===`Bearer ${e.ADMIN_TOKEN}`;

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==="/health") return json({ok:true});
    if(url.pathname==="/admin/run"&&request.method==="POST"){
      if(!authorized(request,env)) return json({error:"unauthorized"},401);
      return json(await runPipeline(env.DB,new MockCollector()));
    }
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
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(runPipeline(env.DB,new MockCollector()));}
} satisfies ExportedHandler<Env>;
