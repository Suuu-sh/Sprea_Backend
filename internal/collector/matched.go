package collector

import (
	"context"
	"github.com/yota/sprea/backend/internal/collector/csv"
	"github.com/yota/sprea/backend/internal/domain"
	"github.com/yota/sprea/backend/internal/matcher"
	"github.com/yota/sprea/backend/internal/port"
)

type Matched struct {
	Purchases         port.Collector
	Buybacks          []csv.Offer
	MinimumConfidence float64
}

func (c Matched) Collect(ctx context.Context) ([]domain.Opportunity, error) {
	items, err := c.Purchases.Collect(ctx)
	if err != nil {
		return nil, err
	}
	threshold := c.MinimumConfidence
	if threshold <= 0 {
		threshold = .8
	}
	matched := MatchOpportunities(items, c.Buybacks, threshold)
	out := make([]domain.Opportunity, 0, len(matched))
	for _, item := range matched {
		if item.BuybackPrice > 0 {
			out = append(out, item)
		}
	}
	return out, nil
}

// MatchOpportunities applies buyback offers without discarding unmatched purchases.
func MatchOpportunities(items []domain.Opportunity, buybacks []csv.Offer, threshold float64) []domain.Opportunity {
	if threshold <= 0 {
		threshold = .8
	}
	out := append([]domain.Opportunity(nil), items...)
	for i, item := range out {
		best, buyer := -1, ""
		for _, offer := range buybacks {
			m := matcher.Match(matcher.Product{Name: item.Name}, offer.Product())
			if m.Matched && m.Confidence >= threshold && offer.Price > best {
				best, buyer = offer.Price, offer.Buyer
			}
		}
		if best >= 0 {
			out[i].BuybackPrice, out[i].Buyer = best, buyer
		}
	}
	return out
}
