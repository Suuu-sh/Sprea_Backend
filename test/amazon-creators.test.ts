import {describe,expect,it} from "vitest";
import {searchAmazonCreators} from "../src/collectors/amazon-creators";

describe("Amazon Creators discovery collector",()=>{
 it("authenticates, searches Japan, and keeps exact new Amazon offers",async()=>{
  const requests:Array<{url:string;init?:RequestInit}>=[];
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);requests.push({url,init});if(url.includes("/auth/o2/token"))return new Response(JSON.stringify({access_token:"test-token",expires_in:3600}),{status:200});return new Response(JSON.stringify({searchResult:{items:[
   {asin:"B000000001",detailPageURL:"https://www.amazon.co.jp/dp/B000000001",itemInfo:{title:{displayValue:"PlayStation 5 CFI-2000A01 新品"}},offersV2:{listings:[{availability:{type:"IN_STOCK"},condition:{value:"New"},isBuyBoxWinner:true,merchantInfo:{name:"Amazon.co.jp"},price:{money:{amount:97800,currency:"JPY"}}}]}},
   {asin:"B000000002",detailPageURL:"https://www.amazon.co.jp/dp/B000000002",itemInfo:{title:{displayValue:"PlayStation 5 CFI-1000A01 新品"}},offersV2:{listings:[{availability:{type:"IN_STOCK"},condition:{value:"New"},isBuyBoxWinner:true,merchantInfo:{name:"Amazon.co.jp"},price:{money:{amount:80000,currency:"JPY"}}}]}}
  ]}}),{status:200});};
  const result=await searchAmazonCreators({jan:null,model_number:"CFI-2000A01",product_name:"PlayStation 5",brand:"Sony",category:"game",search_query:"CFI-2000A01",discovery_ceiling_yen:100000},{clientId:"client",clientSecret:"secret",partnerTag:"sprea-22"},new Date("2026-08-30T00:00:00Z"),fetcher as typeof fetch);
  expect(result).toHaveLength(1);expect(result[0]).toMatchObject({source:"amazon-discovery",externalId:"B000000001",priceYen:97800,purchasable:true});expect(requests[0].url).toBe("https://api.amazon.co.jp/auth/o2/token");expect(requests[1].url).toBe("https://creatorsapi.amazon/catalog/v1/searchItems");expect(requests[1].init?.headers).toMatchObject({authorization:"Bearer test-token","x-marketplace":"www.amazon.co.jp"});const body=JSON.parse(String(requests[1].init?.body));expect(body).toMatchObject({partnerTag:"sprea-22",marketplace:"www.amazon.co.jp",condition:"New",availability:"Available",itemCount:10});
 });
});
