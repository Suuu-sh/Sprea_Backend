import {describe, expect, it} from "vitest";
import {matchProduct, type ProductMatchCandidate} from "../src/application/product-resolver";

const products: ProductMatchCandidate[] = [
  {id: "jan-product", jan: "4900000000001", modelNumber: "OTHER-1", condition: "new"},
  {id: "model-product", jan: "4900000000002", modelNumber: "AB-CD 123", condition: "new"},
];
const quote = (overrides: Record<string, unknown> = {}) => ({jan: undefined, modelNumber: undefined, productName:"", attributes:{}, condition: "new" as const, ...overrides});

describe("buyback product matching", () => {
  it("matches an exact JAN with maximum confidence", () => expect(matchProduct(quote({jan:"4900000000001"}),products)).toMatchObject({matched:true,matchedProductId:"jan-product",confidence:1,reason:"jan_exact"}));
  it("does not match a different JAN", () => expect(matchProduct(quote({jan:"9999999999999"}),products)).toMatchObject({matched:false,reason:"unresolved"}));
  it("never treats empty JAN values as equal", () => expect(matchProduct(quote({jan:"  "}),[{id:"empty",jan:"",condition:"new"}])).toMatchObject({matched:false}));
  it("matches an exact model number with a compatible condition", () => expect(matchProduct(quote({modelNumber:"AB-CD 123"}),products)).toMatchObject({matched:true,productId:"model-product",confidence:.99,reason:"model_exact"}));
  it("normalizes model case, spaces and hyphens", () => expect(matchProduct(quote({modelNumber:"ab cd-123"}),products)).toMatchObject({matched:true,productId:"model-product"}));
  it("prefers JAN over a model match", () => expect(matchProduct(quote({jan:"4900000000001",modelNumber:"AB-CD 123"}),products)).toMatchObject({productId:"jan-product",reason:"jan_exact"}));
  it("returns unresolved when neither identifier matches", () => expect(matchProduct(quote({jan:"nope",modelNumber:"nope"}),products)).toEqual({matched:false,confidence:0,reason:"unresolved"}));
  it("requires compatible conditions for model matching", () => expect(matchProduct(quote({modelNumber:"AB-CD 123",condition:"used"}),products)).toMatchObject({matched:false}));
});
