import {describe,expect,it} from "vitest";
import worker from "../src/index";

const env={ALLOWED_ORIGIN:"https://sprea-frontend.pages.dev"} as Env;
const preflight=(origin:string)=>worker.fetch!(new Request("https://api.example/api/research/dashboard",{method:"OPTIONS",headers:{origin,"access-control-request-method":"GET","access-control-request-headers":"authorization"}}),env);

describe("frontend CORS",()=>{
 it("allows the canonical production frontend",async()=>{const response=await preflight("https://sprea-frontend.pages.dev");expect(response.status).toBe(204);expect(response.headers.get("access-control-allow-origin")).toBe("https://sprea-frontend.pages.dev");});
 it("allows Cloudflare Pages deployment previews",async()=>{const origin="https://af24bdf4.sprea-frontend.pages.dev",response=await preflight(origin);expect(response.status).toBe(204);expect(response.headers.get("access-control-allow-origin")).toBe(origin);});
 it("rejects lookalike and unrelated Pages origins",async()=>{for(const origin of ["https://sprea-frontend.pages.dev.evil.example","https://other.pages.dev","http://preview.sprea-frontend.pages.dev"]){const response=await preflight(origin);expect(response.status).toBe(403);expect(response.headers.get("access-control-allow-origin")).toBeNull();}});
});
