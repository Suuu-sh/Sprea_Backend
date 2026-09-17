import {normalizeAttributes,normalizeColor,normalizeModelNumber,normalizeProductName,normalizeStorage} from "./domain";
import {ingestListings} from "./pipeline";
import type {ListingObservation} from "./types";
import {searchAmazonCreators} from "./collectors/amazon-creators";

type QuoteRow={provider:string;source_type:string;product_name:string;jan:string|null;model_number:string|null;brand:string|null;category:string|null;condition:string;attributes_json:string;price:number;fetched_at:string};
type Candidate={id:number;canonical_product_id:number;jan:string|null;model_number:string|null;product_name:string;brand:string|null;category:string|null;condition:string;attributes_json:string;best_buyback_price_yen:number;search_query:string;discovery_ceiling_yen:number};
type Hit={code?:unknown;name?:unknown;price?:unknown;inStock?:unknown;condition?:unknown;janCode?:unknown;shipping?:{code?:unknown};url?:unknown};
type RakutenItem={itemCode?:unknown;itemName?:unknown;itemCaption?:unknown;catchcopy?:unknown;itemPrice?:unknown;itemUrl?:unknown;availability?:unknown;postageFlag?:unknown;pointRate?:unknown;pointRateEndTime?:unknown};
type RakutenWrappedItem=RakutenItem|{item?:RakutenItem}|{Item?:RakutenItem};
export type DiscoveryEnv={DB:D1Database;YAHOO_CLIENT_ID?:string;RAKUTEN_APPLICATION_ID?:string;RAKUTEN_ACCESS_KEY?:string;AMAZON_CREATORS_CLIENT_ID?:string;AMAZON_CREATORS_CLIENT_SECRET?:string;AMAZON_PARTNER_TAG?:string};
// Keep one scheduled invocation bounded even when a marketplace API is slow or
// repeatedly returns transient errors. Unprocessed queue rows remain pending
// and are picked up by the next five-minute tick.
const DISCOVERY_REQUEST_TIMEOUT_MS=8_000;
const MAX_DISCOVERY_RUNTIME_MS=4*60_000;
// Workers on the free plan have a small per-invocation subrequest budget. A
// scheduled run intentionally uses a single primary query/retry so one noisy
// provider cannot exhaust the budget before the other provider gets a turn.
type DiscoverySearchOptions={maxQueries?:number;maxAttempts?:number};
const SCHEDULED_DISCOVERY_OPTIONS:DiscoverySearchOptions={maxQueries:1,maxAttempts:1};
async function fetchWithTimeout(input:RequestInfo|URL,init:RequestInit={},fetcher:typeof fetch=fetch):Promise<Response>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),DISCOVERY_REQUEST_TIMEOUT_MS);try{return await fetcher(input,{...init,signal:controller.signal});}finally{clearTimeout(timer);}}
async function responseErrorDetail(response:Response):Promise<string>{const body=await response.text().catch(()=>"");return body.replace(/\s+/g," ").trim().slice(0,240);}
const validJan=(value:string|null)=>value&&/^\d{8,14}$/.test(value)?value:null;
const jstDate=(at:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo"}).format(at);
function csvStoreCount(row:Pick<QuoteRow,"attributes_json">):number{
 try{const value=JSON.parse(row.attributes_json||"{}").storeCount;return Number.isSafeInteger(value)&&value>0?Number(value):0;}catch{return 0;}
}
export function candidateIdentity(row:Pick<QuoteRow,"jan"|"model_number"|"product_name"|"condition"|"attributes_json">):string{const jan=validJan(row.jan);if(jan)return`jan:${jan}:${row.condition}`;const model=normalizeModelNumber(row.model_number);if(model)return`model:${model}:${row.condition}`;return`name:${normalizeProductName(row.product_name)}:${row.attributes_json}:${row.condition}`;}
export function discoveryQuery(input:{jan:string|null;model_number:string|null;product_name:string;attributes_json:string}):string{const model=input.model_number?.trim();if(model)return model;const jan=validJan(input.jan);if(jan)return jan;const attributes=JSON.parse(input.attributes_json||"{}") as Record<string,unknown>,suffix=[attributes.storage,attributes.color,attributes.edition].filter(x=>typeof x==="string").join(" ");return`${input.product_name} ${suffix}`.trim();}
export function purchaseTargets(bestBuyback:number,requiredProfit:number,saleCosts:number,buffer=3000){const target=Math.max(0,bestBuyback-requiredProfit-saleCosts);return{target,ceiling:target+buffer};}
export function rakutenDiscoveryQuery(candidate:Pick<Candidate,"model_number"|"product_name">):string{const model=candidate.model_number?.trim();if(model)return model;const embedded=candidate.product_name.match(/\b(?:[A-Z0-9]{4,}J\/A|CFI[- ]?\d{4}[A-Z]\d{2})\b/i)?.[0];if(embedded)return embedded;return candidate.product_name.normalize("NFKC").replace(/[\[【].*?[\]】]/g," ").replace(/新品|未開封|送料無料|買取価格|SIMフリー/gi," ").replace(/\s+/g," ").trim().slice(0,128);}
export function rakutenDiscoveryQueries(candidate:Pick<Candidate,"model_number"|"product_name">):string[]{const primary=rakutenDiscoveryQuery(candidate),capacity=primary.match(/\b\d+(?:GB|TB)\b/i)?.[0]??"",compact=primary.replace(/\b(iPhone|iPad)\s+(\d+)/i,"$1$2").replace(/\s+(Pro|Max|Air)\b/gi,"$1").replace(/\s+\d+(?:GB|TB)\b.*$/i,"").trim(),fallback=[compact,capacity].filter(Boolean).join(" ");return[...new Set([primary,fallback,compact].filter(Boolean))];}
const normalizedAttribute=(value:unknown)=>typeof value==="string"?value.normalize("NFKC").toLowerCase().replace(/[\s\-_]/g,""):"";
const unsafeRetailText=/(?:中古|整備済|再生品|訳あり|ジャンク|海外版|並行輸入|輸入版|デモ機|展示品)/iu;
const accessoryRetailText=/(?:usb\s*メモリ|フラッシュドライブ|外付けドライブ|写真バックアップ|容量不足解消|ケース|カバー|保護フィルム|ガラスフィルム|ストラップ|ケーブル|充電器|アダプタ|モバイルバッテリー|交換用|修理用|液晶パネル|レンズカバー)/iu;
function expectedVariant(candidate:Pick<Candidate,"product_name"|"attributes_json">){const raw=JSON.parse(candidate.attributes_json||"{}") as Record<string,unknown>,attributes=normalizeAttributes(raw),name=candidate.product_name.normalize("NFKC"),storage=attributes.storage??normalizeStorage(name.match(/\b\d+(?:\.\d+)?\s*(?:GB?|TB?)\b/i)?.[0]),nameColor=normalizeColor(name),color=attributes.color??(["black","white","blue","red","green","pink","silver","gold","gray","purple"].includes(nameColor??"")?nameColor:undefined);return{storage:typeof storage==="string"?storage:undefined,color:typeof color==="string"?color:undefined,edition:typeof attributes.edition==="string"?attributes.edition:undefined,carrier:typeof attributes.carrier==="string"?attributes.carrier:undefined};}
function variantCompatible(candidate:Pick<Candidate,"product_name"|"attributes_json">,text:string){const expected=expectedVariant(candidate),title=normalizeProductName(text),compact=normalizedAttribute(title);if(expected.storage&&!compact.includes(normalizedAttribute(expected.storage)))return false;if(expected.color&&!title.split(" ").includes(expected.color))return false;if(expected.edition&&!compact.includes(normalizedAttribute(expected.edition)))return false;const candidateText=normalizedAttribute(`${candidate.product_name} ${expected.carrier??""}`),titleText=normalizedAttribute(text);if(candidateText.includes("simフリー")&&/(?:docomo|ドコモ|softbank|ソフトバンク|au版|キャリア版|simロック)/iu.test(text)&&!titleText.includes("simフリー"))return false;if(expected.carrier&&!titleText.includes(normalizedAttribute(expected.carrier)))return false;return true;}
export function retailIdentityMatches(candidate:Pick<Candidate,"jan"|"model_number"|"product_name"|"attributes_json">,text:string,jan?:string|null){
 if(unsafeRetailText.test(text)||accessoryRetailText.test(text)||!variantCompatible(candidate,text))return false;
 const candidateJan=validJan(candidate.jan),listingJan=validJan(jan??null),embeddedJans=text.match(/(?<!\d)\d{8,14}(?!\d)/g)?.map(value=>validJan(value)).filter((value):value is string=>Boolean(value))??[];
 // A candidate identified by JAN must not fall back to a loose name match. This avoids
 // treating accessories and another colour/capacity variant as the same product.
 if(candidateJan){
  if(listingJan)return listingJan===candidateJan;
  if(embeddedJans.length)return embeddedJans.includes(candidateJan);
  const model=normalizeModelNumber(candidate.model_number),normalized=normalizeModelNumber(text);
  return Boolean(model&&normalized.includes(model));
 }
 const normalized=normalizeModelNumber(text),model=normalizeModelNumber(candidate.model_number);if(model)return normalized.includes(model);
 const name=normalizeProductName(candidate.product_name),title=normalizeProductName(text),compactTitle=title.replace(/\s/g,"");if(!name)return false;const tokens=name.split(/\s+/).map(value=>value.replace(/[^a-z0-9一-龠ぁ-んァ-ヶ]/gi,"")).filter(value=>value.length>1&&!/^(apple|simフリー|国内版|本体|モデル|black|white|blue|red|green|pink|silver|gold|gray|purple)$/.test(value));return tokens.length>=2&&tokens.every(value=>compactTitle.includes(value.replace(/\s/g,"")));
}
export function rakutenIdentityMatches(candidate:Pick<Candidate,"jan"|"model_number"|"product_name"|"attributes_json">,item:Pick<RakutenItem,"itemName"|"itemCaption"|"catchcopy">){const text=[item.itemName,item.catchcopy,item.itemCaption].filter(x=>typeof x==="string").join(" ");return retailIdentityMatches(candidate,text);}

async function promote(db:D1Database,row:QuoteRow,identity:string,at:string):Promise<number|null>{const jan=validJan(row.jan);if(!jan&&!normalizeModelNumber(row.model_number))return null;const aliasType=jan?"gtin":"mpn",aliasValue=jan??`${normalizeModelNumber(row.model_number)}:`;const existing=await db.prepare("SELECT canonical_product_id FROM canonical_product_aliases WHERE alias_type=? AND alias_value=? AND condition=?").bind(aliasType,aliasValue,row.condition).first<{canonical_product_id:number}>();if(existing)return existing.canonical_product_id;const key=jan?`gtin:${jan}:${row.condition}`:`mpn:${aliasValue}:${row.condition}`;await db.prepare(`INSERT INTO canonical_products(canonical_key,gtin,manufacturer_part_number,brand,model,variant,category,capacity,color,condition,title,created_at,updated_at) VALUES(?,?,?,?,?,'',?,'','',?,?,?,?) ON CONFLICT(canonical_key) DO NOTHING`).bind(key,jan,row.model_number,row.brand??"",row.product_name,row.category??"",row.condition,row.product_name,at,at).run();const product=await db.prepare("SELECT id FROM canonical_products WHERE canonical_key=?").bind(key).first<{id:number}>();if(!product)return null;await db.prepare("INSERT OR IGNORE INTO canonical_product_aliases(alias_type,alias_value,condition,canonical_product_id,created_at) VALUES(?,?,?,?,?)").bind(aliasType,aliasValue,row.condition,product.id,at).run();return product.id;}

type DiscoveryQueueMeta={dirty:number;reset_requested:number;provider_signature:string;generation:number;quote_count:number;candidate_count:number;canonical_count:number;rebuilt_at:string|null};
const queueProviderSignature=(providers:string[])=>[...new Set(providers)].sort().join(",");

/**
 * Mark the materialized provider queue for a single rebuild.  The next
 * scheduled invocation performs the expensive candidate pass once and then
 * clears this flag.  Keeping the flag in D1 avoids MAX/COUNT scans on every
 * five-minute invocation.
 */
export async function markDiscoveryQueueDirty(db:D1Database,reset=true,at=new Date()):Promise<void>{
 try{
  await db.prepare(`INSERT INTO product_discovery_queue_meta(id,dirty,reset_requested,provider_signature,generation,quote_count,candidate_count,canonical_count,rebuilt_at,updated_at) VALUES(1,1,?, '',0,0,0,0,NULL,?) ON CONFLICT(id) DO UPDATE SET dirty=1,reset_requested=MAX(reset_requested,excluded.reset_requested),updated_at=excluded.updated_at`).bind(reset?1:0,at.toISOString()).run();
 }catch(error){
  // Keep quote ingestion compatible with a database while the queue migration
  // is being applied.  The scheduled worker will use the materialized queue
  // once the migration is present.
  if(error instanceof Error&&error.message.includes("no such table: product_discovery_queue_meta"))return;
  throw error;
 }
}

async function readDiscoveryQueueMeta(db:D1Database):Promise<DiscoveryQueueMeta|null>{
 return await db.prepare("SELECT dirty,reset_requested,provider_signature,generation,quote_count,candidate_count,canonical_count,rebuilt_at FROM product_discovery_queue_meta WHERE id=1").first<DiscoveryQueueMeta>();
}

/**
 * Materialize one provider-state row per candidate/provider only when the
 * daily snapshot changes.  Scheduled runs then read the due index directly
 * instead of cross joining every candidate with every provider.
 */
async function rebuildDiscoveryQueue(db:D1Database,providers:string[],meta:DiscoveryQueueMeta|null,counts:{quotes:number; candidates:number; canonical:number},at:Date):Promise<DiscoveryQueueMeta>{
 const now=at.toISOString(),signature=queueProviderSignature(providers),reset=Boolean(meta?.reset_requested??1);
 for(const provider of providers){
  const statement=reset
   ? `INSERT INTO product_discovery_provider_state(candidate_id,provider,status,attempt_count,failure_count,last_searched_at,next_search_at,last_error,updated_at,queue_priority_yen)
      SELECT id,?,'pending',0,0,NULL,?,'',?,best_buyback_price_yen FROM product_discovery_candidates
      WHERE resolver_status IN ('searchable','retail_found')
      ON CONFLICT(candidate_id,provider) DO UPDATE SET status='pending',next_search_at=excluded.next_search_at,last_error='',updated_at=excluded.updated_at,queue_priority_yen=excluded.queue_priority_yen`
   : `INSERT INTO product_discovery_provider_state(candidate_id,provider,status,attempt_count,failure_count,last_searched_at,next_search_at,last_error,updated_at,queue_priority_yen)
      SELECT id,?,'pending',0,0,NULL,?,'',?,best_buyback_price_yen FROM product_discovery_candidates
      WHERE resolver_status IN ('searchable','retail_found')
      ON CONFLICT(candidate_id,provider) DO NOTHING`;
  await db.prepare(statement).bind(provider,now,now).run();
 }
 const generation=Number(meta?.generation??0)+1;
 await db.prepare(`UPDATE product_discovery_queue_meta SET dirty=0,reset_requested=0,provider_signature=?,generation=?,quote_count=?,candidate_count=?,canonical_count=?,rebuilt_at=?,updated_at=? WHERE id=1`).bind(signature,generation,counts.quotes,counts.candidates,counts.canonical,now,now).run();
 return{dirty:0,reset_requested:0,provider_signature:signature,generation,quote_count:counts.quotes,candidate_count:counts.candidates,canonical_count:counts.canonical,rebuilt_at:now};
}

export async function buildDiscoveryCandidates(db:D1Database,at=new Date()):Promise<{quotes:number;candidates:number;canonical:number}>{
 const snapshotDate=jstDate(at),currentCsvRows=(await db.prepare(`WITH latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY provider,COALESCE(external_id,id) ORDER BY fetched_at DESC,id DESC) rank FROM buyback_quotes WHERE source_type='csv' AND json_extract(attributes_json,'$.snapshotDate')=?) SELECT provider,source_type,product_name,jan,model_number,brand,category,condition,attributes_json,price,fetched_at FROM latest WHERE rank=1 AND buyback_status='accepting' AND condition IN ('new','unused','unknown') AND price>0`).bind(snapshotDate).all<QuoteRow>()).results;
 // A complete CSV snapshot is the buyback source of truth.  Read only that
 // snapshot when it exists; do not delete the old rows here because deleting a
 // large pre-CSV history on every daily rebuild consumes the D1 write quota.
 // The one-time retention migration handles old history separately.
 const rows=currentCsvRows.length?currentCsvRows:(await db.prepare(`WITH latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY provider,COALESCE(external_id,id) ORDER BY fetched_at DESC,id DESC) rank FROM buyback_quotes) SELECT provider,source_type,product_name,jan,model_number,brand,category,condition,attributes_json,price,fetched_at FROM latest WHERE rank=1 AND buyback_status='accepting' AND condition IN ('new','unused','unknown') AND price>0`).all<QuoteRow>()).results;
 const activeRows=rows;
 const groups=new Map<string,QuoteRow[]>();for(const row of activeRows){const key=candidateIdentity(row),items=groups.get(key)??[];items.push(row);groups.set(key,items);}
 const aliases=(await db.prepare("SELECT alias_type,alias_value,condition,canonical_product_id FROM canonical_product_aliases WHERE alias_type IN ('gtin','mpn')").all<any>()).results,aliasMap=new Map(aliases.map(row=>[`${row.alias_type}:${row.alias_value}:${row.condition}`,Number(row.canonical_product_id)]));
 const missing:[string,QuoteRow,string,string][]=[];for(const[identity,items]of groups){const best=[...items].sort((a,b)=>b.price-a.price)[0],jan=validJan(best.jan),model=normalizeModelNumber(best.model_number),aliasType=jan?"gtin":"mpn",aliasValue=jan??`${model}:`;if((jan||model)&&!aliasMap.has(`${aliasType}:${aliasValue}:${best.condition}`))missing.push([identity,best,aliasType,aliasValue]);}
 if(missing.length)await db.batch(missing.map(([,row,,])=>{const jan=validJan(row.jan),model=normalizeModelNumber(row.model_number),key=jan?`gtin:${jan}:${row.condition}`:`mpn:${model}::${row.condition}`;return db.prepare(`INSERT INTO canonical_products(canonical_key,gtin,manufacturer_part_number,brand,model,variant,category,capacity,color,condition,title,created_at,updated_at) VALUES(?,?,?,?,?,'',?,'','',?,?,?,?) ON CONFLICT(canonical_key) DO NOTHING`).bind(key,jan,row.model_number,row.brand??"",row.product_name,row.category??"",row.condition,row.product_name,at.toISOString(),at.toISOString());}));
 const products=(await db.prepare("SELECT id,canonical_key FROM canonical_products").all<any>()).results,productByKey=new Map(products.map(row=>[String(row.canonical_key),Number(row.id)])),aliasStatements:D1PreparedStatement[]=[];
 for(const[,row,aliasType,aliasValue]of missing){const jan=validJan(row.jan),model=normalizeModelNumber(row.model_number),key=jan?`gtin:${jan}:${row.condition}`:`mpn:${model}::${row.condition}`,productId=productByKey.get(key);if(productId){aliasMap.set(`${aliasType}:${aliasValue}:${row.condition}`,productId);aliasStatements.push(db.prepare("INSERT OR IGNORE INTO canonical_product_aliases(alias_type,alias_value,condition,canonical_product_id,created_at) VALUES(?,?,?,?,?)").bind(aliasType,aliasValue,row.condition,productId,at.toISOString()));}}
 if(aliasStatements.length)await db.batch(aliasStatements);
 const config=await db.prepare("SELECT minimum_profit_yen,sale_shipping_yen,fees_yen FROM research_settings WHERE id=1").first<any>(),candidateStatements:D1PreparedStatement[]=[];let canonical=0;
 for(const[identity,items]of groups){const best=[...items].sort((a,b)=>b.price-a.price)[0],jan=validJan(best.jan),model=normalizeModelNumber(best.model_number),aliasType=jan?"gtin":"mpn",aliasValue=jan??`${model}:`,productId=(jan||model)?aliasMap.get(`${aliasType}:${aliasValue}:${best.condition}`)??null:null;if(productId)canonical++;const providers=new Set(items.map(x=>x.provider)),providerCount=Math.max(providers.size,...items.map(csvStoreCount)),targets=purchaseTargets(best.price,config.minimum_profit_yen,config.sale_shipping_yen+config.fees_yen),query=discoveryQuery(best);candidateStatements.push(db.prepare(`INSERT INTO product_discovery_candidates(identity_key,canonical_product_id,jan,model_number,product_name,brand,category,condition,attributes_json,best_buyback_price_yen,best_buyback_provider,buyback_provider_count,resolver_status,resolver_confidence,resolver_reason,search_query,target_purchase_price_yen,discovery_ceiling_yen,next_search_at,first_seen_at,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(identity_key) DO UPDATE SET canonical_product_id=excluded.canonical_product_id,product_name=excluded.product_name,best_buyback_price_yen=excluded.best_buyback_price_yen,best_buyback_provider=excluded.best_buyback_provider,buyback_provider_count=excluded.buyback_provider_count,resolver_status=CASE WHEN product_discovery_candidates.resolver_status='retail_found' THEN 'retail_found' ELSE excluded.resolver_status END,resolver_confidence=excluded.resolver_confidence,resolver_reason=excluded.resolver_reason,search_query=excluded.search_query,target_purchase_price_yen=excluded.target_purchase_price_yen,discovery_ceiling_yen=excluded.discovery_ceiling_yen,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`).bind(identity,productId,best.jan,best.model_number,best.product_name,best.brand,best.category,best.condition,best.attributes_json,best.price,best.provider,providerCount,productId?"searchable":"unresolved",productId?(jan?1:.99):0,productId?(jan?"jan_exact":"model_exact"):"identity_insufficient",query,targets.target,targets.ceiling,at.toISOString(),at.toISOString(),at.toISOString(),at.toISOString()));}
 for(let index=0;index<candidateStatements.length;index+=100)await db.batch(candidateStatements.slice(index,index+100));
 // A CSV import represents the complete active buyback snapshot.  Once that
 // snapshot has been materialized, remove candidates not seen in it so stale
 // products do not remain in the provider queue forever.  The delete is done
 // once per daily rebuild (not on every five-minute tick) and cascades only
 // discovery telemetry; canonical products and Paper Trading history remain.
 if(rows.some(row=>row.source_type==="csv"))await db.prepare("DELETE FROM product_discovery_candidates WHERE last_seen_at < ?").bind(at.toISOString()).run();
 return{quotes:activeRows.length,candidates:groups.size,canonical};
}
async function yahoo(candidate:Candidate,clientId:string,at:Date,fetcher:typeof fetch=fetch):Promise<ListingObservation[]>{const url=new URL("https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch");url.searchParams.set("appid",clientId);url.searchParams.set("query",candidate.search_query);url.searchParams.set("results","20");url.searchParams.set("condition","new");url.searchParams.set("in_stock","true");url.searchParams.set("sort","+price");const response=await fetchWithTimeout(url,{headers:{accept:"application/json","user-agent":"SpreaResearch/1.0"}},fetcher);if(!response.ok){const detail=await responseErrorDetail(response);throw new Error(`Yahoo discovery failed (${response.status})${detail?`: ${detail}`:""}`);}const payload=await response.json() as{hits?:Hit[]},results:ListingObservation[]=[];for(const hit of payload.hits??[]){const title=typeof hit.name==="string"?hit.name:"",jan=typeof hit.janCode==="string"?hit.janCode:null,price=Number(hit.price),externalId=typeof hit.code==="string"?hit.code:"",productUrl=typeof hit.url==="string"?hit.url:"";if(!retailIdentityMatches(candidate,title,jan)||!Number.isSafeInteger(price)||price<=0||!externalId||!productUrl||hit.condition!=="new"||hit.inStock!==true||Number(hit.shipping?.code)!==2)continue;results.push({source:"yahoo-discovery",externalId,side:"purchase",title,url:productUrl,gtin:candidate.jan??undefined,manufacturerPartNumber:candidate.model_number??undefined,brand:candidate.brand??undefined,model:candidate.product_name,category:candidate.category??undefined,condition:"new",priceYen:price,shippingYen:0,feeYen:0,rewardYen:0,stock:1,stockStatus:"in_stock",purchasable:true,capturedAt:at.toISOString(),raw:hit});}return results.sort((a,b)=>a.priceYen-b.priceYen).slice(0,10);}

export async function searchRakuten(candidate:Candidate,applicationId:string,accessKey:string,at:Date,fetcher:typeof fetch=fetch,sleeper:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),options:DiscoverySearchOptions={}):Promise<ListingObservation[]>{
 const url=new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701");
 url.searchParams.set("applicationId",applicationId);url.searchParams.set("hits","30");url.searchParams.set("format","json");url.searchParams.set("formatVersion","2");url.searchParams.set("availability","1");
 let rawItems:RakutenWrappedItem[]=[],usedQuery="",responseMeta:Record<string,unknown>={};const queries=rakutenDiscoveryQueries(candidate).slice(0,Math.max(1,Math.min(3,options.maxQueries??3))),maxAttempts=Math.max(1,Math.min(3,options.maxAttempts??3));for(let queryIndex=0;queryIndex<queries.length;queryIndex++){usedQuery=queries[queryIndex];url.searchParams.set("keyword",usedQuery);let response:Response|undefined;for(let attempt=0;attempt<maxAttempts;attempt++){response=await fetchWithTimeout(url,{headers:{accessKey,accept:"application/json",origin:"https://sprea-frontend.pages.dev",referer:"https://sprea-frontend.pages.dev/"}},fetcher);if(response.ok||![429,500,502,503,504].includes(response.status))break;if(attempt<maxAttempts-1)await sleeper(1000*2**attempt);}if(!response?.ok){const detail=response?await responseErrorDetail(response):"";throw new Error(`Rakuten discovery failed (${response?.status??"network"})${detail?`: ${detail}`:""}`);}const payload=await response.json() as{items?:RakutenWrappedItem[];Items?:RakutenWrappedItem[];count?:unknown;pageCount?:unknown;error?:unknown;error_description?:unknown};rawItems=payload.items??payload.Items??[];responseMeta={keys:Object.keys(payload),count:payload.count,pageCount:payload.pageCount,error:payload.error,errorDescription:payload.error_description};if(rawItems.length)break;if(queryIndex<queries.length-1)await sleeper(1100);}
 const results:ListingObservation[]=[];let identityMatches=0,eligible=0;
 for(const wrapped of rawItems){const item="item" in wrapped&&wrapped.item?wrapped.item:"Item" in wrapped&&wrapped.Item?wrapped.Item:wrapped as RakutenItem,title=typeof item.itemName==="string"?item.itemName:"",price=Number(item.itemPrice),externalId=typeof item.itemCode==="string"?item.itemCode:"",productUrl=typeof item.itemUrl==="string"?item.itemUrl:"",pointRate=Number(item.pointRate),reward=Number.isFinite(pointRate)&&pointRate>0&&typeof item.pointRateEndTime==="string"&&Date.parse(item.pointRateEndTime)>at.getTime()+24*3_600_000?Math.floor(price*pointRate/100):0;if(!rakutenIdentityMatches(candidate,item))continue;identityMatches++;if(!Number.isSafeInteger(price)||price<=0||!externalId||!productUrl||Number(item.availability)!==1||Number(item.postageFlag)!==0)continue;eligible++;results.push({source:"rakuten-discovery",externalId,side:"purchase",title,url:productUrl,gtin:candidate.jan??undefined,manufacturerPartNumber:candidate.model_number??undefined,brand:candidate.brand??undefined,model:candidate.product_name,category:candidate.category??undefined,condition:"new",priceYen:price,shippingYen:0,feeYen:0,rewardYen:reward,stock:1,stockStatus:"in_stock",purchasable:true,capturedAt:at.toISOString(),raw:item});}console.info("Rakuten discovery summary",{candidateId:candidate.id,query:usedQuery,returned:rawItems.length,identityMatches,eligible,response:responseMeta});
 return results.sort((a,b)=>a.priceYen-b.priceYen).slice(0,10);
}

export async function runProductDiscovery(env:DiscoveryEnv,trigger="manual",limit=10,at=new Date()){
 const searchOptions=trigger==="scheduled"?SCHEDULED_DISCOVERY_OPTIONS:{};
 const providers=new Map<string,(candidate:Candidate)=>Promise<ListingObservation[]>>();
 if(env.YAHOO_CLIENT_ID)providers.set("yahoo",candidate=>yahoo(candidate,env.YAHOO_CLIENT_ID!,at));
 if(env.RAKUTEN_APPLICATION_ID&&env.RAKUTEN_ACCESS_KEY)providers.set("rakuten",candidate=>searchRakuten(candidate,env.RAKUTEN_APPLICATION_ID!,env.RAKUTEN_ACCESS_KEY!,at,fetch,undefined,searchOptions));
 if(env.AMAZON_CREATORS_CLIENT_ID&&env.AMAZON_CREATORS_CLIENT_SECRET&&env.AMAZON_PARTNER_TAG)providers.set("amazon",candidate=>searchAmazonCreators(candidate,{clientId:env.AMAZON_CREATORS_CLIENT_ID!,clientSecret:env.AMAZON_CREATORS_CLIENT_SECRET!,partnerTag:env.AMAZON_PARTNER_TAG!},at));
 if(!providers.size)throw new Error("At least one retail discovery provider is required");

 // A frequent cron can overlap a slow provider request. Do not start a second
 // worker while the previous one is still active; the current queue item remains
 // pending and will be picked up on the next invocation.
 const active=await env.DB.prepare("SELECT id FROM product_discovery_runs WHERE status='running' AND started_at>=? ORDER BY id DESC LIMIT 1").bind(new Date(at.getTime()-10*60_000).toISOString()).first<{id:number}>();
 if(active)return{status:"busy",runId:Number(active.id),searched:0,retailFound:0,purchasable:0,profitable:0,threshold:0,buys:0,failures:0};
 await env.DB.prepare("UPDATE product_discovery_runs SET status='failed',message='interrupted before completion',finished_at=? WHERE status='running' AND started_at<?").bind(at.toISOString(),new Date(at.getTime()-10*60_000).toISOString()).run();
 const names=[...providers.keys()],signature=queueProviderSignature(names),queueMeta=await readDiscoveryQueueMeta(env.DB);
 let built={quotes:Number(queueMeta?.quote_count??0),candidates:Number(queueMeta?.candidate_count??0),canonical:Number(queueMeta?.canonical_count??0)};
 const queueNeedsRebuild=!queueMeta||Boolean(queueMeta.dirty)||queueMeta.provider_signature!==signature;
 if(queueNeedsRebuild){
  // A dirty flag is set by the completed daily CSV import (or an explicit
  // buyback ingest).  Only that transition rebuilds candidates from quotes.
  if(!queueMeta||queueMeta.dirty)built=await buildDiscoveryCandidates(env.DB,at);
  await rebuildDiscoveryQueue(env.DB,names,queueMeta,built,at);
 }
 const settings=await env.DB.prepare("SELECT minimum_profit_yen,sale_shipping_yen,fees_yen FROM research_settings WHERE id=1").first<{minimum_profit_yen:number;sale_shipping_yen:number;fees_yen:number}>();
 const minimumProfit=Math.max(0,Number(settings?.minimum_profit_yen??5000)),saleCosts=Math.max(0,Number(settings?.sale_shipping_yen??0)+Number(settings?.fees_yen??0));
 // The provider-state table is the durable exploration queue.  It is
 // materialized only for searchable candidates, so this query uses the due
 // index directly and reads only rows whose next attempt is ready; it no
 // longer cross joins all candidates with every provider on every five-minute tick.
 // Query each provider independently.  The due index is ordered by
 // (provider,next_search_at,priority), so a fixed-provider query can stop
 // after the requested batch.  An IN (...) query has to merge providers and
 // sort all due rows into a temporary B-tree first; with thousands of pending
 // candidates that would read the entire queue on every five-minute tick and
 // exhaust D1's row-read quota before the queue could finish.
 const perProviderLimit=trigger==="scheduled"?Math.max(1,Math.floor(12/names.length)):Math.max(1,Math.min(100,limit)),pairLimit=perProviderLimit*names.length;
 const providerRows=await Promise.all(names.map(provider=>env.DB.prepare(`SELECT c.*,s.provider,s.status provider_status,s.last_searched_at
  FROM product_discovery_provider_state s
  JOIN product_discovery_candidates c ON c.id=s.candidate_id
 WHERE s.provider=?
    AND s.next_search_at<=?
  ORDER BY s.next_search_at,s.queue_priority_yen DESC,s.candidate_id
  LIMIT ?`).bind(provider,at.toISOString(),perProviderLimit).all<Candidate&{provider:string}>()));
 const pairs=providerRows.flatMap(result=>result.results).slice(0,pairLimit);
 if(!pairs.length)return{status:"idle",runId:0,...built,searched:0,retailFound:0,yahooFound:0,purchasable:0,profitable:0,threshold:0,buys:0,failures:0,providers:{}};
 const insert=await env.DB.prepare("INSERT INTO product_discovery_runs(trigger,status,quote_count,candidate_count,canonical_count,started_at) VALUES(?,'running',?,?,?,?)").bind(trigger,built.quotes,built.candidates,built.canonical,at.toISOString()).run(),runId=Number(insert.meta.last_row_id),deadline=Date.now()+MAX_DISCOVERY_RUNTIME_MS;
 let purchasable=0,profitable=0,threshold=0,buys=0,failures=0;
 const foundCandidates=new Set<number>(),searchedCandidates=new Set<number>(),providerStats:Record<string,{searched:number;found:number;listings:number;profitable:number;threshold:number;failures:number}>={},providerErrors:Record<string,string>={},lastRequest=new Map<string,number>();
 for(const name of names)providerStats[name]={searched:0,found:0,listings:0,profitable:0,threshold:0,failures:0};
 const waitForProvider=async(provider:string)=>{
   const minimumInterval=provider==="yahoo"?2_050:provider==="rakuten"?1_100:1_000;
   const wait=Math.max(0,minimumInterval-(Date.now()-(lastRequest.get(provider)??0)));
   if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   lastRequest.set(provider,Date.now());
 };
 for(const pair of pairs){
  if(Date.now()>=deadline)break;
  searchedCandidates.add(pair.id);const stats=providerStats[pair.provider],search=providers.get(pair.provider)!;stats.searched++;
  try{
   await waitForProvider(pair.provider);
   const listings=await search(pair);
   // Persist and ingest only a single lowest-price listing whose profit meets the
   // configured threshold. This is the definition of a confirmed opportunity and
   // keeps D1 writes bounded even when a marketplace returns many hits.
   const confirmed=listings.filter(listing=>pair.best_buyback_price_yen-listing.priceYen+(listing.rewardYen??0)-saleCosts>=minimumProfit).sort((a,b)=>a.priceYen-b.priceYen).slice(0,1);
   if(confirmed.length){stats.found++;foundCandidates.add(pair.id);}stats.listings+=confirmed.length;purchasable+=confirmed.length;
   for(const listing of confirmed){const profit=pair.best_buyback_price_yen-listing.priceYen+(listing.rewardYen??0)-saleCosts;if(profit>0){profitable++;stats.profitable++;}if(profit>=minimumProfit){threshold++;stats.threshold++;}await env.DB.prepare("INSERT OR IGNORE INTO product_discovery_results(run_id,candidate_id,source,external_id,title,price_yen,product_url,within_discovery_ceiling,captured_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(runId,pair.id,listing.source,listing.externalId,listing.title,listing.priceYen,listing.url,listing.priceYen<=pair.discovery_ceiling_yen?1:0,at.toISOString()).run();}
   if(confirmed.length){const summary=await ingestListings(env.DB,confirmed,at);buys+=summary.buys;await env.DB.prepare("UPDATE product_discovery_candidates SET resolver_status='retail_found',updated_at=? WHERE id=?").bind(at.toISOString(),pair.id).run();}
   const nextSearchMinutes=confirmed.length?24*60:6*60;
   await env.DB.prepare("INSERT INTO product_discovery_provider_state(candidate_id,provider,status,attempt_count,failure_count,last_searched_at,next_search_at,last_error,updated_at,queue_priority_yen) VALUES(?,?, 'succeeded',1,0,?,?,?, ?,?) ON CONFLICT(candidate_id,provider) DO UPDATE SET status=excluded.status,attempt_count=product_discovery_provider_state.attempt_count+1,last_searched_at=excluded.last_searched_at,next_search_at=excluded.next_search_at,last_error='',updated_at=excluded.updated_at,queue_priority_yen=excluded.queue_priority_yen").bind(pair.id,pair.provider,at.toISOString(),new Date(at.getTime()+nextSearchMinutes*60_000).toISOString(),"",at.toISOString(),pair.best_buyback_price_yen).run();
  }catch(error){failures++;stats.failures++;const message=error instanceof Error?error.message.slice(0,500):"search failed";providerErrors[pair.provider]=message;const cooldown=/\((?:400|401|403)\)/.test(message)?6*60*60_000:/\(429\)/.test(message)?15*60_000:60*60_000;await env.DB.prepare("INSERT INTO product_discovery_provider_state(candidate_id,provider,status,attempt_count,failure_count,last_searched_at,next_search_at,last_error,updated_at,queue_priority_yen) VALUES(?,?, 'failed',1,1,?,?,?, ?,?) ON CONFLICT(candidate_id,provider) DO UPDATE SET status=excluded.status,attempt_count=product_discovery_provider_state.attempt_count+1,failure_count=product_discovery_provider_state.failure_count+1,last_searched_at=excluded.last_searched_at,next_search_at=excluded.next_search_at,last_error=excluded.last_error,updated_at=excluded.updated_at,queue_priority_yen=excluded.queue_priority_yen").bind(pair.id,pair.provider,at.toISOString(),new Date(at.getTime()+cooldown).toISOString(),message,at.toISOString(),pair.best_buyback_price_yen).run();}
 }
 for(const[name,stats]of Object.entries(providerStats))await env.DB.prepare("INSERT INTO product_discovery_provider_runs(run_id,provider,searched_count,found_count,listing_count,profitable_count,threshold_count,failure_count) VALUES(?,?,?,?,?,?,?,?)").bind(runId,name,stats.searched,stats.found,stats.listings,stats.profitable,stats.threshold,stats.failures).run();
 const searchedPairs=Object.values(providerStats).reduce((total,stats)=>total+stats.searched,0);
 const status=failures===searchedPairs&&searchedPairs?"failed":"succeeded",deferred=Math.max(0,pairs.length-searchedPairs),errorSummary=Object.entries(providerErrors).map(([provider,message])=>`${provider}: ${message}`).join(" | ").slice(0,700),message=`searched ${searchedPairs}/${pairs.length} candidate/provider pairs; candidates ${searchedCandidates.size}; confirmed ${foundCandidates.size}${deferred?`; deferred ${deferred} for the next tick`:""}${errorSummary?`; errors ${errorSummary}`:""}`;
 await env.DB.prepare("UPDATE product_discovery_runs SET status=?,searched_count=?,yahoo_found_count=?,purchasable_count=?,profitable_count=?,threshold_count=?,buy_count=?,failure_count=?,message=?,finished_at=? WHERE id=?").bind(status,searchedCandidates.size,foundCandidates.size,purchasable,profitable,threshold,buys,failures,message,new Date().toISOString(),runId).run();
 return{runId,...built,searched:searchedCandidates.size,searchedPairs,retailFound:foundCandidates.size,yahooFound:foundCandidates.size,purchasable,profitable,threshold,buys,failures,deferred,providers:providerStats};
}

export async function discoveryFunnel(db:D1Database){
 const settings=await db.prepare("SELECT minimum_profit_yen,sale_shipping_yen,fees_yen FROM research_settings WHERE id=1").first<any>(),minimumProfit=Math.max(0,Number(settings?.minimum_profit_yen??5000));
 // Use the latest run summary instead of recounting the raw result tables. The
 // old COUNT/DISTINCT aggregates scanned every historical marketplace row on
 // each dashboard request and were the main source of D1 read exhaustion.
 const run=await db.prepare("SELECT * FROM product_discovery_runs ORDER BY id DESC LIMIT 1").first<any>();
 const latestRuns=run?(await db.prepare("SELECT * FROM product_discovery_provider_runs WHERE run_id=?").bind(run.id).all<any>()).results:[];
 const providers=latestRuns.map(row=>({provider:String(row.provider),found:Number(row.found_count??0),listings:Number(row.listing_count??0),profitable:Number(row.profitable_count??0),threshold:Number(row.threshold_count??0),averageProfitGap:0}));
 return{minimumProfit,buybackQuotes:Number(run?.quote_count??0),candidates:Number(run?.candidate_count??0),canonicalProducts:Number(run?.canonical_count??0),yahooFound:Number(run?.yahoo_found_count??0),purchasable:Number(run?.purchasable_count??0),profitable:Number(run?.profitable_count??0),threshold:Number(run?.threshold_count??0),buys:Number(run?.buy_count??0),providers,lastProviderRuns:latestRuns,lastRun:run??null};
}

/**
 * Return only queue metadata and the latest bounded run.  This endpoint is
 * intentionally not a COUNT/GROUP BY over provider_state: the UI can inspect
 * progress without rescanning the full discovery queue in D1.
 */
export async function discoveryQueueStatus(db:D1Database){
 const meta=await readDiscoveryQueueMeta(db);
 const run=await db.prepare("SELECT id,trigger,status,quote_count,candidate_count,canonical_count,searched_count,purchasable_count,profitable_count,threshold_count,buy_count,failure_count,message,started_at,finished_at FROM product_discovery_runs ORDER BY id DESC LIMIT 1").first<any>();
 const providers=run?(await db.prepare("SELECT provider,searched_count,found_count,listing_count,profitable_count,threshold_count,failure_count FROM product_discovery_provider_runs WHERE run_id=? ORDER BY provider").bind(run.id).all<any>()).results:[];
 const errorSection=String(run?.message??"").match(/; errors (.+)$/)?.[1]??"",providerErrors=new Map(errorSection.split(" | ").map(value=>{const separator=value.indexOf(": ");return separator>0?[value.slice(0,separator),value.slice(separator+2)]:["",""]}).filter(([provider])=>Boolean(provider)) as Array<[string,string]>);
 const signature=String(meta?.provider_signature??"");
 const providerCount=providers.length||signature.split(",").map(value=>value.trim()).filter(Boolean).length;
 const searchedCandidates=Number(run?.searched_count??0);
 const searchedPairs=providers.reduce((total,row)=>total+Number(row.searched_count??0),0);
 const batchPairsMatch=String(run?.message??"").match(/searched\s+\d+\/(\d+)\s+candidate\/provider pairs/);
 const batchPairs=batchPairsMatch?Number(batchPairsMatch[1]):null;
 const deferredPairs=batchPairs==null?null:Math.max(0,batchPairs-searchedPairs);
 const state=run?.status==="running"?"running":meta?.dirty?"rebuild_pending":run?.status==="failed"?"failed":"idle";
 return{
  state,
  generation:Number(meta?.generation??0),
  dirty:Boolean(meta?.dirty),
  candidates:Number(meta?.candidate_count??run?.candidate_count??0),
  quotes:Number(meta?.quote_count??run?.quote_count??0),
  canonicalProducts:Number(meta?.canonical_count??run?.canonical_count??0),
  providerCount,
  totalPairs:Number(meta?.candidate_count??run?.candidate_count??0)*providerCount,
  rebuiltAt:meta?.rebuilt_at??null,
      lastRun:run?{id:Number(run.id),trigger:String(run.trigger),status:String(run.status),searched:searchedCandidates,searchedPairs,batchPairs,deferredPairs,purchasable:Number(run.purchasable_count??0),profitable:Number(run.profitable_count??0),threshold:Number(run.threshold_count??0),buys:Number(run.buy_count??0),failures:Number(run.failure_count??0),message:String(run.message??""),startedAt:String(run.started_at),finishedAt:run.finished_at?String(run.finished_at):null}:null,
  providers:providers.map(row=>({provider:String(row.provider),searched:Number(row.searched_count??0),found:Number(row.found_count??0),listings:Number(row.listing_count??0),profitable:Number(row.profitable_count??0),threshold:Number(row.threshold_count??0),failures:Number(row.failure_count??0),lastError:providerErrors.get(String(row.provider))??""})),
 };
}
