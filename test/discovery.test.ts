import {describe,expect,it} from "vitest";
import {candidateIdentity,discoveryQuery,purchaseTargets,rakutenIdentityMatches,searchRakuten} from "../src/discovery";
const quote={jan:"4549995000000",model_number:"ABC-123",product_name:"Device 256GB Black",condition:"new",attributes_json:'{"storage":"256GB","color":"black"}'};
describe("buyback-driven product discovery",()=>{
 it("deduplicates primarily by JAN",()=>expect(candidateIdentity(quote)).toBe("jan:4549995000000:new"));
 it("falls back to normalized model number",()=>expect(candidateIdentity({...quote,jan:null})).toBe("model:ABC123:new"));
 it("builds queries in model, JAN, then name/attribute order",()=>{expect(discoveryQuery(quote)).toBe("ABC-123");expect(discoveryQuery({...quote,model_number:null})).toBe("4549995000000");expect(discoveryQuery({...quote,jan:null,model_number:null})).toContain("256GB black");});
 it("derives a strict target and a bounded discovery ceiling",()=>expect(purchaseTargets(105000,5000,1000)).toEqual({target:99000,ceiling:102000}));
 it("matches Rakuten caption JAN even when the title omits it",()=>expect(rakutenIdentityMatches({...quote,model_number:null},{itemName:"Device 256GB Black",itemCaption:"JAN 4549995000000",catchcopy:"新品"})).toBe(true));
 it("rejects used or refurbished Rakuten listings",()=>expect(rakutenIdentityMatches({...quote,jan:null},{itemName:"Device ABC-123 整備済品",itemCaption:"",catchcopy:""})).toBe(false));
 it("searches Rakuten below the inverse-price ceiling and keeps exact model matches",async()=>{
  let requested:URL|undefined;
  const fetcher=async(input:RequestInfo|URL)=>{requested=new URL(String(input));return new Response(JSON.stringify({items:[
   {itemCode:"shop:1",itemName:"PlayStation 5 CFI-2000A01 新品",itemPrice:97800,itemUrl:"https://example.com/1",availability:1,postageFlag:0},
   {itemCode:"shop:2",itemName:"PlayStation 5 CFI-1000A01 新品",itemPrice:80000,itemUrl:"https://example.com/2",availability:1,postageFlag:0},
   {itemCode:"shop:3",itemName:"PlayStation 5 CFI-2000A01 送料別",itemPrice:90000,itemUrl:"https://example.com/3",availability:1,postageFlag:1},
  ]}),{status:200});};
  const candidate={id:1,canonical_product_id:1,jan:null,model_number:"CFI-2000A01",product_name:"PlayStation 5",brand:"Sony",category:"game",condition:"new",attributes_json:"{}",best_buyback_price_yen:105000,search_query:"CFI-2000A01",discovery_ceiling_yen:100000};
  const result=await searchRakuten(candidate,"app","access",new Date("2026-08-30T00:00:00Z"),fetcher as typeof fetch);
  expect(requested?.searchParams.get("maxPrice")).toBe("100000");expect(requested?.searchParams.get("sort")).toBe("+itemPrice");expect(result).toHaveLength(1);expect(result[0]).toMatchObject({source:"rakuten-discovery",externalId:"shop:1",priceYen:97800,purchasable:true});
 });
});
