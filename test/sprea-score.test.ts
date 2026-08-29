import {describe,expect,it} from "vitest";import {calculatePriceStatistics,calculatePriceVariation,calculateSpreaScore} from "../src/domain";
const base={marketProfit:5000,profitRate:3,buybackSourceCount:1,bestSecondSpreadRate:1,priceVariationRate:1,stockStatus:"in_stock" as const,retailAgeMinutes:10,buybackAgeMinutes:10,matchConfidence:1};
describe("Sprea Score rule-v1",()=>{
 it("is always bounded from zero to one hundred",()=>{expect(calculateSpreaScore({...base,marketProfit:999999,profitRate:999,buybackSourceCount:99}).score).toBeLessThanOrEqual(100);expect(calculateSpreaScore({...base,marketProfit:-1,profitRate:-1}).score).toBeGreaterThanOrEqual(0);});
 it("increases for greater profit",()=>expect(calculateSpreaScore({...base,marketProfit:15000}).score).toBeGreaterThan(calculateSpreaScore({...base,marketProfit:4999}).score));
 it("increases for greater profit rate",()=>expect(calculateSpreaScore({...base,profitRate:8}).score).toBeGreaterThan(calculateSpreaScore({...base,profitRate:2.99}).score));
 it("increases with more buyback sources",()=>expect(calculateSpreaScore({...base,buybackSourceCount:4}).score).toBeGreaterThan(calculateSpreaScore({...base,buybackSourceCount:1}).score));
 it("penalizes an isolated best quote",()=>expect(calculateSpreaScore({...base,bestSecondSpreadRate:11}).score).toBeLessThan(calculateSpreaScore({...base,bestSecondSpreadRate:1}).score));
 it("penalizes volatile prices",()=>expect(calculateSpreaScore({...base,priceVariationRate:11}).score).toBeLessThan(calculateSpreaScore({...base,priceVariationRate:1}).score));
 it("uses a neutral score when history is insufficient",()=>expect(calculateSpreaScore({...base,priceVariationRate:null}).reason).toMatchObject({priceStability:8,stabilityStatus:"insufficient_history"}));
 it("calculates variation from max, min, and average",()=>{expect(calculatePriceVariation([100,101])).toBeCloseTo(.995,2);expect(calculatePriceVariation([100])).toBeNull();});
 it("keeps min, max, average, and current price statistics",()=>expect(calculatePriceStatistics([100,120,110])).toEqual({minimum:100,maximum:120,average:110,current:110,variationRate:20/110*100}));
});
