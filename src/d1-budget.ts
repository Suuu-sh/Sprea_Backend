/** Shared, fail-closed UTC-day budget. R2 accounting never spends D1 quota.
 * Reservations are persisted BEFORE SQL, so crashes and concurrent requests
 * cannot refund work whose outcome is unknown. Only successful calls refund.
 */
export const DAILY_BUDGET={reads:2_000_000,writes:60_000};
const KEY='operations/d1-budget-v1.json';
export class BudgetPause extends Error {
 readonly code='d1_budget_paused';
 constructor(public readonly retryAt:string){super(`DBの安全予算に達したため処理を待機します。再開予定: ${retryAt}`);}
}
type Ledger={day:string;reads:number;writes:number;halted?:boolean};
const nextDay=(at:Date)=>new Date(Date.parse(at.toISOString().slice(0,10))+86400000).toISOString();
export async function budgetStatus(bucket:R2Bucket,at=new Date()){
 const object=await bucket.get(KEY),value=object?await object.json<Ledger>():null;
 return {day:at.toISOString().slice(0,10),reads:value?.day===at.toISOString().slice(0,10)?value.reads:0,writes:value?.day===at.toISOString().slice(0,10)?value.writes:0,limits:DAILY_BUDGET,scope:"this_worker_reserved_and_measured",retryAt:nextDay(at)};
}
async function adjust(bucket:R2Bucket,reads:number,writes:number,day:string,at:Date,halt=false){
 for(let attempt=0;attempt<10;attempt++){
  const object=await bucket.get(KEY),old=object?await object.json<Ledger>():null;
  // A request crossing midnight cannot refund the next day's reservations.
  if(old&&old.day>day)throw new BudgetPause(nextDay(at));
  if(old&&(!/^\d{4}-\d{2}-\d{2}$/.test(old.day)||!Number.isFinite(old.reads)||!Number.isFinite(old.writes)))throw new BudgetPause(nextDay(at));
  const value=old?.day===day?old:{day,reads:0,writes:0};
  if(value.halted)throw new BudgetPause(nextDay(at));
  const next=halt?{day,...DAILY_BUDGET,halted:true}:{day,reads:Math.max(0,value.reads+reads),writes:Math.max(0,value.writes+writes)};
  if(next.reads>DAILY_BUDGET.reads||next.writes>DAILY_BUDGET.writes)throw new BudgetPause(nextDay(at));
  const saved=await bucket.put(KEY,JSON.stringify(next),{onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}});
  if(saved)return;
 }
 throw new BudgetPause(new Date(at.getTime()+60000).toISOString());
}
/** All SQL goes through this adapter, including GETs, cron and manual APIs.
 * Unknown/bulk writes are denied instead of guessing their cost. */
export function budgetDatabase(db:D1Database,bucket:R2Bucket):D1Database{
 let calls=0;
 const originals=new WeakMap<D1PreparedStatement,{statement:D1PreparedStatement;sql:string}>();
 async function execute(statements:{statement:D1PreparedStatement;sql:string}[]){
  const at=new Date(),day=at.toISOString().slice(0,10);
  if(++calls>170)throw new BudgetPause(new Date(at.getTime()+300000).toISOString());
  let writeReserve=0;
  for(const {sql} of statements){
   const readOnly=/^\s*(SELECT|EXPLAIN)\b/i.test(sql)||(/^\s*WITH\b/i.test(sql)&&!/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql));
   if(!readOnly){
    // Bound all bulk writes explicitly at the caller. Cascading deletes are
    // deliberately not permitted through the automatic production path.
    if(/\bDELETE\b|\b(?:CREATE|ALTER|DROP)\b/i.test(sql)||/INSERT[\s\S]+SELECT\b/i.test(sql))throw new BudgetPause(nextDay(at));
    writeReserve+=/\bUPDATE\b/i.test(sql)&&!/^\s*INSERT/i.test(sql)&&!/WHERE\s+(?:id|run_id|listing_id|candidate_id)\s*=/i.test(sql)?4096:128;
   }
  }
  const readReserve=250_000;
  await adjust(bucket,readReserve,writeReserve,day,at);
  // On any error keep the reservation: a batch may have spent resources even
  // if the caller did not receive a successful response.
  const results=await db.batch(statements.map(x=>x.statement));
  for(let i=0;i<results.length;i++)if(Number(results[i].meta.rows_read)>10000)console.warn("d1_expensive_query",{sql:statements[i].sql.slice(0,180),reads:results[i].meta.rows_read,writes:results[i].meta.rows_written});
  const reads=results.reduce((n,r)=>n+Number(r.meta.rows_read??readReserve),0),writes=results.reduce((n,r)=>n+Number(r.meta.rows_written??writeReserve),0);
  if(reads>readReserve||writes>writeReserve){
   // Unexpected query expansion: consume the remaining budget and stop. The
   // 40k write / 3m read account headroom is not an invitation to keep running.
   await adjust(bucket,0,0,day,at,true);
   throw new BudgetPause(nextDay(at));
  }
  await adjust(bucket,reads-readReserve,writes-writeReserve,day,at);
  return results;
 }
 function wrap(statement:D1PreparedStatement,sql:string):D1PreparedStatement{
  const wrapped=new Proxy(statement,{get(target,key){
   if(key==='bind')return(...values:unknown[])=>wrap(target.bind(...values),sql);
   if(key==='run'||key==='all')return async()=> (await execute([{statement:target,sql}]))[0];
   if(key==='first')return async(column?:string)=>{const row=(await execute([{statement:target,sql}]))[0].results[0] as Record<string,unknown>|undefined;return column?row?.[column]??null:row??null;};
   if(key==='raw')return async()=>{throw new Error('Unmetered raw SQL is disabled');};
   return Reflect.get(target,key,target);
  }});
  originals.set(wrapped,{statement,sql});return wrapped;
 }
 return new Proxy(db,{get(target,key){
  if(key==='prepare')return(sql:string)=>wrap(target.prepare(sql),sql);
  if(key==='batch')return async(statements:D1PreparedStatement[])=>{
   const values=statements.map(s=>{const original=originals.get(s);if(!original)throw new Error('Unmetered statement');return original;});
   return execute(values);
  };
  if(key==='exec'||key==='dump'||key==='withSession')return()=>{throw new Error('Unmetered database operation disabled');};
  return Reflect.get(target,key,target);
 }});
}
