package domain

import "testing"

func TestWithPointAdjustment(t *testing.T) {
	o := Opportunity{PurchasePrice: 10000, BuybackPrice: 11000, BasePointRate: 5}.WithPointAdjustment(3)
	if o.PointValue != 800 || o.Profit != 1800 || o.ProfitRate < 19.5 {
		t.Fatalf("unexpected calculation: %+v", o)
	}
}
