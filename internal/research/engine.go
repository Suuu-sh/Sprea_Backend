package research

import (
	"sort"
	"time"
)

type EngineConfig struct {
	SaleShipping   int
	Fees           int
	CertainRewards int
}

// Detect pairs only identical canonical keys and chooses the cheapest in-stock
// purchase with the highest buyback offer at a single capture point.
func Detect(items []ResolvedObservation, at time.Time, cfg EngineConfig) []Opportunity {
	type pair struct{ buy, sell *ResolvedObservation }
	groups := map[string]pair{}
	for i := range items {
		x := &items[i]
		if !x.Stock || x.Price <= 0 || x.CapturedAt.After(at) {
			continue
		}
		p := groups[x.CanonicalKey]
		if x.Side == Purchase && (p.buy == nil || x.Price+x.Shipping < p.buy.Price+p.buy.Shipping) {
			p.buy = x
		}
		if x.Side == Buyback && (p.sell == nil || x.Price > p.sell.Price) {
			p.sell = x
		}
		groups[x.CanonicalKey] = p
	}
	out := make([]Opportunity, 0, len(groups))
	for key, p := range groups {
		if p.buy == nil || p.sell == nil {
			continue
		}
		cost := p.buy.Price + p.buy.Shipping
		profit := p.sell.Price - cfg.SaleShipping - cfg.Fees - cost + cfg.CertainRewards
		rate := 0.0
		if cost > 0 {
			rate = float64(profit) / float64(cost) * 100
		}
		confidence := p.buy.Confidence
		if p.sell.Confidence < confidence {
			confidence = p.sell.Confidence
		}
		out = append(out, Opportunity{CanonicalKey: key, Title: p.buy.Title, PurchaseSource: p.buy.Source, BuybackSource: p.sell.Source, PurchasePrice: p.buy.Price, PurchaseShipping: p.buy.Shipping, BuybackPrice: p.sell.Price, SaleShipping: cfg.SaleShipping, Fees: cfg.Fees, CertainRewards: cfg.CertainRewards, MarketProfit: profit, ProfitRate: rate, ResolverConfidence: confidence, DetectedAt: at})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MarketProfit == out[j].MarketProfit {
			return out[i].CanonicalKey < out[j].CanonicalKey
		}
		return out[i].MarketProfit > out[j].MarketProfit
	})
	return out
}
