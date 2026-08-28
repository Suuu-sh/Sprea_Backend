package profit

import (
	"math"
	"testing"
)

func TestCalculateAllCosts(t *testing.T) {
	r := Calculate(Input{PurchasePrice: 10000, BuybackPrice: 12000, ShippingCost: 500,
		PurchaseFee: 100, PurchaseFeeRate: 2, BuybackFee: 50, BuybackFeeRate: 5,
		CouponValue: 1000, PointRate: 10, PointCap: 700})
	if r.PurchaseFee != 280 || r.BuybackFee != 650 || r.PointValue != 700 || r.EffectiveCost != 9080 || r.NetProceeds != 11350 || r.Profit != 2270 {
		t.Fatalf("unexpected result: %+v", r)
	}
	if math.Abs(r.ProfitRate-25) > .001 {
		t.Fatalf("profit rate = %v", r.ProfitRate)
	}
}

func TestCalculateClampsInvalidValues(t *testing.T) {
	r := Calculate(Input{PurchasePrice: 1000, BuybackPrice: -1, CouponValue: 5000, ShippingCost: -2, PointRate: -3})
	if r.CouponValue != 1000 || r.EffectiveCost != 0 || r.NetProceeds != 0 || r.Profit != 0 || r.ProfitRate != 0 {
		t.Fatalf("unexpected: %+v", r)
	}
}

func TestCalculateUnlimitedPointsAndLoss(t *testing.T) {
	r := Calculate(Input{PurchasePrice: 9999, BuybackPrice: 8000, PointRate: 3})
	if r.PointValue != 300 || r.Profit != -1699 || r.ProfitRate >= 0 {
		t.Fatalf("unexpected: %+v", r)
	}
}
