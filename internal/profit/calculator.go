// Package profit contains the pure, marketplace-independent profit calculation.
package profit

import "math"

// Input represents all money paid or received for one item. Amounts are yen.
// Rates are percentages (for example, 3.5 means 3.5%).
type Input struct {
	PurchasePrice   int
	BuybackPrice    int
	ShippingCost    int
	PurchaseFee     int
	PurchaseFeeRate float64
	BuybackFee      int
	BuybackFeeRate  float64
	CouponValue     int
	PointRate       float64
	PointCap        int // zero means unlimited
}

type Result struct {
	PurchaseFee   int     `json:"purchaseFee"`
	BuybackFee    int     `json:"buybackFee"`
	CouponValue   int     `json:"couponValue"`
	PointValue    int     `json:"pointValue"`
	EffectiveCost int     `json:"effectiveCost"`
	NetProceeds   int     `json:"netProceeds"`
	Profit        int     `json:"profit"`
	ProfitRate    float64 `json:"profitRate"`
}

// Calculate applies discounts before percentage-based purchase fees and points.
// Individual monetary components are rounded to the nearest yen.
func Calculate(in Input) Result {
	purchase := max(0, in.PurchasePrice)
	buyback := max(0, in.BuybackPrice)
	coupon := min(max(0, in.CouponValue), purchase)
	discounted := purchase - coupon
	purchaseFee := max(0, in.PurchaseFee) + percent(discounted, in.PurchaseFeeRate)
	buybackFee := max(0, in.BuybackFee) + percent(buyback, in.BuybackFeeRate)
	points := percent(discounted, in.PointRate)
	if in.PointCap > 0 {
		points = min(points, in.PointCap)
	}
	effectiveCost := discounted + max(0, in.ShippingCost) + purchaseFee - points
	netProceeds := buyback - buybackFee
	result := Result{
		PurchaseFee: purchaseFee, BuybackFee: buybackFee, CouponValue: coupon,
		PointValue: points, EffectiveCost: effectiveCost, NetProceeds: netProceeds,
		Profit: netProceeds - effectiveCost,
	}
	if effectiveCost > 0 {
		result.ProfitRate = float64(result.Profit) / float64(effectiveCost) * 100
	}
	return result
}

func percent(amount int, rate float64) int {
	if rate <= 0 {
		return 0
	}
	return int(math.Round(float64(amount) * rate / 100))
}
