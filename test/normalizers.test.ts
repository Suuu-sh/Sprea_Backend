import {describe,expect,it} from "vitest";
import {normalizeAttributes,normalizeColor,normalizeModelNumber,normalizeProductName,normalizeStorage} from "../src/domain";

describe("product normalizers",()=>{
 it("normalizes product names and removes sales language",()=>expect(normalizeProductName("ｉＰｈｏｎｅ 17 Pro 256 GB ブラック 新品 送料無料")).toBe("iphone 17 pro 256gb black"));
 it.each([["256 GB","256GB"],["256gb","256GB"],["256G","256GB"],["1 tb","1TB"]])("normalizes storage %s",(input,expected)=>expect(normalizeStorage(input)).toBe(expected));
 it.each([["ブラック","black"],["Black","black"],["ブルー","blue"]])("normalizes color %s",(input,expected)=>expect(normalizeColor(input)).toBe(expected));
 it("normalizes model number punctuation and case",()=>expect(new Set(["CFI-2000A01","CFI2000A01","cfi-2000a01"].map(normalizeModelNumber)).size).toBe(1));
 it("normalizes category attributes without changing the input",()=>{const input={storage:"256 g",color:"ブラック",carrier:"SIM フリー",edition:"Digital-Edition",discDrive:"なし",kitType:"Body Only"};expect(normalizeAttributes(input)).toEqual({storage:"256GB",color:"black",carrier:"sim フリー",edition:"digital edition",discDrive:false,kitType:"body only"});expect(input.storage).toBe("256 g");});
});
