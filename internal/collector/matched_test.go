package collector

import (
	"context"
	"github.com/yota/sprea/backend/internal/collector/csv"
	"github.com/yota/sprea/backend/internal/domain"
	"testing"
)

type stubCollector []domain.Opportunity

func (s stubCollector) Collect(context.Context) ([]domain.Opportunity, error) { return s, nil }
func TestMatchedSelectsHighestSafeOffer(t *testing.T) {
	c := Matched{Purchases: stubCollector{{Name: "iPad 第10世代 64GB", PurchasePrice: 50000}}, Buybacks: []csv.Offer{{Name: "iPad 第10世代 128GB", Buyer: "wrong", Price: 70000}, {Name: "iPad 第10世代 64GB 新品", Buyer: "A", Price: 55000}, {Name: "iPad 第10世代 64 GB", Buyer: "B", Price: 56000}}}
	x, e := c.Collect(context.Background())
	if e != nil || len(x) != 1 || x[0].Buyer != "B" || x[0].BuybackPrice != 56000 {
		t.Fatalf("x=%+v err=%v", x, e)
	}
}
