import type {RetailListing} from "../domain";
export interface RetailListingRepository{findEligibleByProductId(productId:string,now?:Date,maxAgeMinutes?:number):Promise<RetailListing[]>;}
