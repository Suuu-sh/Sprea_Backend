package research

import (
	"math"
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
	type pair struct {
		buy, sell *ResolvedObservation
		buybacks  []*ResolvedObservation
	}
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
		if x.Side == Buyback {
			p.buybacks = append(p.buybacks, x)
			if p.sell == nil || x.Price > p.sell.Price {
				p.sell = x
			}
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
		prices := make([]int, 0, len(p.buybacks))
		stores := map[string]bool{}
		for _, b := range p.buybacks {
			prices = append(prices, b.Price)
			stores[b.Source] = true
		}
		sort.Sort(sort.Reverse(sort.IntSlice(prices)))
		second := 0
		if len(prices) > 1 {
			second = prices[1]
		}
		spread := 0.0
		if second > 0 {
			spread = float64(p.sell.Price-second) / float64(second) * 100
		}
		capitalDays := 3
		annualized := rate * 365 / float64(capitalDays)
		return30Days := rate * 30 / float64(capitalDays)
		score := scoreOpportunity(profit, rate, confidence, len(stores), spread)
		out = append(out, Opportunity{CanonicalKey: key, Title: p.buy.Title, PurchaseSource: p.buy.Source, BuybackSource: p.sell.Source, PurchasePrice: p.buy.Price, PurchaseShipping: p.buy.Shipping, BuybackPrice: p.sell.Price, SaleShipping: cfg.SaleShipping, Fees: cfg.Fees, CertainRewards: cfg.CertainRewards, MarketProfit: profit, ProfitRate: rate, ResolverConfidence: confidence, BuybackStoreCount: len(stores), SecondBuybackPrice: second, TopTwoSpreadRate: spread, CapitalDays: capitalDays, AnnualizedReturn: annualized, Return30Days: return30Days, SpreaScore: score, DetectedAt: at})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MarketProfit == out[j].MarketProfit {
			return out[i].CanonicalKey < out[j].CanonicalKey
		}
		return out[i].MarketProfit > out[j].MarketProfit
	})
	return out
}

func scoreOpportunity(profit int, rate, confidence float64, stores int, spread float64) int {
	profitScore := math.Min(30, math.Max(0, float64(profit)/500))
	rateScore := math.Min(20, math.Max(0, rate*2))
	identityScore := math.Max(0, math.Min(20, confidence*20))
	storeScore := math.Min(15, float64(stores)*5)
	spreadScore := 15 - math.Min(15, math.Max(0, spread*2))
	return int(math.Round(math.Min(100, profitScore+rateScore+identityScore+storeScore+spreadScore)))
}
