import {describe,expect,it} from "vitest";
import {candidateIdentity,discoveryQuery,purchaseTargets} from "../src/discovery";
const quote={jan:"4549995000000",model_number:"ABC-123",product_name:"Device 256GB Black",condition:"new",attributes_json:'{"storage":"256GB","color":"black"}'};
describe("buyback-driven product discovery",()=>{
 it("deduplicates primarily by JAN",()=>expect(candidateIdentity(quote)).toBe("jan:4549995000000:new"));
 it("falls back to normalized model number",()=>expect(candidateIdentity({...quote,jan:null})).toBe("model:ABC123:new"));
 it("builds queries in model, JAN, then name/attribute order",()=>{expect(discoveryQuery(quote)).toBe("ABC-123");expect(discoveryQuery({...quote,model_number:null})).toBe("4549995000000");expect(discoveryQuery({...quote,jan:null,model_number:null})).toContain("256GB black");});
 it("derives a strict target and a bounded discovery ceiling",()=>expect(purchaseTargets(105000,5000,1000)).toEqual({target:99000,ceiling:102000}));
});
