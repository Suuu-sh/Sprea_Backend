import {describe,expect,it} from "vitest";
import {downloadKaitorixCsv} from "../src/application/kaitorix-csv-download";

const gzip = new Uint8Array([0x1f,0x8b,0x08,0x00,0x00,0x00]);

function archive(){
  const writes:Array<{key:string;body:ArrayBuffer;options:unknown}>=[];
  return {bucket:{put:async(key:string,body:ArrayBuffer,options:unknown)=>{writes.push({key,body,options});}},get:()=>writes.find(write=>write.key.endsWith(".csv.gz"))};
}

describe("KaitoriX CSV download",()=>{
 it("generates today's export when it is not ready and archives gzip in R2",async()=>{
  const store=archive();
  const calls:string[]=[];
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);calls.push(`${init?.method??"GET"} ${url}`);
   if(url.endsWith("/status"))return new Response(JSON.stringify({has_addon:true,generated_today:false}),{status:200});
   if(url.endsWith("/generate"))return new Response(JSON.stringify({ok:true}),{status:200});
   return new Response(gzip,{status:200});
  };
  const result=await downloadKaitorixCsv({KAITORIX_API_KEY:"ktx_test",MODELS:store.bucket as unknown as R2Bucket},new Date("2026-09-13T00:10:00.000Z"),fetcher);
  expect(result.date).toBe("2026-09-13");
  expect(result.objectKey).toBe("kaitorix/csv/2026-09-13.csv.gz");
  expect(result.bytes).toBe(gzip.byteLength);
  expect(calls.map(call=>call.split(" ")[0])).toEqual(["GET","POST","GET"]);
  expect(store.get()?.key).toBe(result.objectKey);
  expect((store.get()?.options as {customMetadata:{source:string}}).customMetadata.source).toBe("kaitorix");
 });

 it("accepts an already-generated export (409) without generating twice",async()=>{
  const store=archive();
  let generateCalls=0;
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith("/status"))return new Response(JSON.stringify({has_addon:true,generated_today:true}),{status:200});
   if(url.endsWith("/generate")){generateCalls+=1;return new Response(null,{status:409});}
   return new Response(gzip,{status:200});
  };
  await downloadKaitorixCsv({KAITORIX_API_KEY:"ktx_test",MODELS:store.bucket as unknown as R2Bucket},new Date("2026-09-13T00:10:00.000Z"),fetcher);
  expect(generateCalls).toBe(0);
 });

 it("fails clearly when the CSV add-on is unavailable",async()=>{
  const fetcher=async()=>new Response(JSON.stringify({has_addon:false}),{status:200});
  await expect(downloadKaitorixCsv({KAITORIX_API_KEY:"ktx_test",MODELS:{} as R2Bucket},new Date(),fetcher)).rejects.toThrow("add-on is not enabled");
 });
});
