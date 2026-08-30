import {describe,expect,it} from "vitest";
import {candidateIdentity,discoveryQuery,purchaseTargets,rakutenDiscoveryQueries,rakutenDiscoveryQuery,rakutenIdentityMatches,searchRakuten} from "../src/discovery";
const quote={jan:"4549995000000",model_number:"ABC-123",product_name:"Device 256GB Black",condition:"new",attributes_json:'{"storage":"256GB","color":"black"}'};
describe("buyback-driven product discovery",()=>{
 it("deduplicates primarily by JAN",()=>expect(candidateIdentity(quote)).toBe("jan:4549995000000:new"));
 it("falls back to normalized model number",()=>expect(candidateIdentity({...quote,jan:null})).toBe("model:ABC123:new"));
 it("builds queries in model, JAN, then name/attribute order",()=>{expect(discoveryQuery(quote)).toBe("ABC-123");expect(discoveryQuery({...quote,model_number:null})).toBe("4549995000000");expect(discoveryQuery({...quote,jan:null,model_number:null})).toContain("256GB black");});
 it("derives a strict target and a bounded discovery ceiling",()=>expect(purchaseTargets(105000,5000,1000)).toEqual({target:99000,ceiling:102000}));
 it("matches Rakuten caption JAN even when the title omits it",()=>expect(rakutenIdentityMatches({...quote,model_number:null},{itemName:"Device 256GB Black",itemCaption:"JAN 4549995000000",catchcopy:"新品"})).toBe(true));
 it("uses a product name or embedded Japanese model instead of a JAN-only Rakuten keyword",()=>{expect(rakutenDiscoveryQuery({...quote,model_number:null,product_name:"Apple iPhone16 Pro Max 1TB 送料無料"})).toBe("Apple iPhone16 Pro Max 1TB");expect(rakutenDiscoveryQuery({...quote,model_number:null,product_name:"iPad Air MH5T4J/A 128GB"})).toBe("MH5T4J/A");});
 it("adds compact and broad Rakuten fallback queries for AND-search variations",()=>expect(rakutenDiscoveryQueries({...quote,model_number:null,product_name:"iPhone 17 Pro Max 512GB"})).toEqual(["iPhone 17 Pro Max 512GB","iPhone17ProMax 512GB","iPhone17ProMax"]));
 it("rejects used or refurbished Rakuten listings",()=>expect(rakutenIdentityMatches({...quote,jan:null},{itemName:"Device ABC-123 整備済品",itemCaption:"",catchcopy:""})).toBe(false));
 it("matches reordered Rakuten titles without weakening capacity checks",()=>{const candidate={jan:"4549995649321",model_number:null,product_name:"iPhone 17 Pro Max 512GB",attributes_json:"{}"};expect(rakutenIdentityMatches(candidate,{itemName:"Apple iPhone 17 Pro Max SIMフリー 国内版 512GB 新品",itemCaption:"",catchcopy:"送料無料"})).toBe(true);expect(rakutenIdentityMatches(candidate,{itemName:"Apple iPhone 17 Pro Max SIMフリー 256GB 新品",itemCaption:"",catchcopy:""})).toBe(false);});
 it("searches Rakuten by lowest price without hiding above-target market data and keeps exact model matches",async()=>{
  let requested:URL|undefined;
  const fetcher=async(input:RequestInfo|URL)=>{requested=new URL(String(input));return new Response(JSON.stringify({Items:[
   {Item:{itemCode:"shop:1",itemName:"PlayStation 5 CFI-2000A01 新品",itemPrice:97800,itemUrl:"https://example.com/1",availability:1,postageFlag:0}},
   {Item:{itemCode:"shop:2",itemName:"PlayStation 5 CFI-1000A01 新品",itemPrice:80000,itemUrl:"https://example.com/2",availability:1,postageFlag:0}},
   {Item:{itemCode:"shop:3",itemName:"PlayStation 5 CFI-2000A01 送料別",itemPrice:90000,itemUrl:"https://example.com/3",availability:1,postageFlag:1}},
   {Item:{itemCode:"shop:4",itemName:"PlayStation 5 CFI-2000A01 新品",itemPrice:110000,itemUrl:"https://example.com/4",availability:1,postageFlag:0}},
  ]}),{status:200});};
  const candidate={id:1,canonical_product_id:1,jan:null,model_number:"CFI-2000A01",product_name:"PlayStation 5",brand:"Sony",category:"game",condition:"new",attributes_json:"{}",best_buyback_price_yen:105000,search_query:"CFI-2000A01",discovery_ceiling_yen:100000};
  const result=await searchRakuten(candidate,"app","access",new Date("2026-08-30T00:00:00Z"),fetcher as typeof fetch);
  expect(requested?.searchParams.has("maxPrice")).toBe(false);expect(requested?.searchParams.has("sort")).toBe(false);expect(requested?.searchParams.has("postageFlag")).toBe(false);expect(result).toHaveLength(2);expect(result[0]).toMatchObject({source:"rakuten-discovery",externalId:"shop:1",priceYen:97800,purchasable:true});expect(result[1]).toMatchObject({externalId:"shop:4",priceYen:110000});
 });
 it("retries Rakuten 429 responses with bounded exponential backoff",async()=>{let calls=0;const waits:number[]=[];const fetcher=async()=>{calls++;return calls<3?new Response("rate limited",{status:429}):new Response(JSON.stringify({items:[]}),{status:200})};const candidate={id:1,canonical_product_id:1,jan:null,model_number:"CFI-2000A01",product_name:"PlayStation 5",brand:"Sony",category:"game",condition:"new",attributes_json:"{}",best_buyback_price_yen:105000,search_query:"CFI-2000A01",discovery_ceiling_yen:100000};await expect(searchRakuten(candidate,"app","access",new Date("2026-08-30T00:00:00Z"),fetcher as typeof fetch,async ms=>{waits.push(ms)})).resolves.toEqual([]);expect(calls).toBe(3);expect(waits).toEqual([1000,2000]);});
});
