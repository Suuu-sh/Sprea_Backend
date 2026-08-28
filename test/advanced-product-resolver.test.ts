import {describe,expect,it} from "vitest";
import {matchProduct,type ProductMatchCandidate} from "../src/application/product-resolver";

const candidates:ProductMatchCandidate[]=[
 {id:"black",modelNumber:"CFI-2000A01",productName:"PlayStation 5 Slim Digital Edition",brand:"Sony",category:"game_console",condition:"new",attributes:{storage:"1TB",color:"black",edition:"digital",discDrive:false}},
 {id:"white",modelNumber:"CFI-2000A01",productName:"PlayStation 5 Slim",brand:"Sony",category:"game_console",condition:"new",attributes:{storage:"1TB",color:"white",edition:"standard",discDrive:true}},
 {id:"phone",productName:"iPhone 17 Pro 256GB ブラック",brand:"Apple",category:"smartphone",condition:"new",attributes:{storage:"256 GB",color:"black"}},
];
const base={jan:undefined,modelNumber:undefined,productName:"",brand:undefined,category:undefined,condition:"new" as const,attributes:{}};

describe("precision-first attribute matching",()=>{
 it("uses model and attributes to disambiguate duplicate models",()=>expect(matchProduct({...base,modelNumber:"cfi 2000a01",brand:"Sony",category:"game_console",attributes:{color:"ブラック",discDrive:false}},candidates)).toMatchObject({matched:true,matchedProductId:"black",confidence:.97,reason:"model_attributes"}));
 it("uses exact normalized name plus category and attributes",()=>expect(matchProduct({...base,productName:"IPHONE 17 PRO 256 GB ブラック 新品",category:"smartphone",attributes:{storage:"256G",color:"黒"}},candidates)).toMatchObject({matched:true,matchedProductId:"phone",confidence:.95,reason:"name_attributes"}));
 it("leaves ambiguous name-only input unresolved",()=>expect(matchProduct({...base,productName:"PlayStation 5 Slim",category:"game_console"},candidates)).toEqual({matched:false,confidence:0,reason:"unresolved"}));
});
