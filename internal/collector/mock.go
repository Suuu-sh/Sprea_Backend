package collector

import (
	"context"
	"time"

	"github.com/yota/sprea/backend/internal/domain"
)

// Mock is a deterministic, network-free collector for local development.
// It must never be selected in production.
type Mock struct{}

func (Mock) Collect(context.Context) ([]domain.Opportunity, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	return []domain.Opportunity{
		{Name: "Apple iPhone 17 Pro 256GB Silver (local mock)", Category: "Apple", Source: "LOCAL MOCK STORE", Buyer: "LOCAL MOCK BUYBACK", PurchasePrice: 178000, BuybackPrice: 188000, BasePointRate: 1, UpdatedAt: now},
		{Name: "Apple AirPods Pro (local mock)", Category: "Apple", Source: "LOCAL MOCK STORE", Buyer: "LOCAL MOCK BUYBACK", PurchasePrice: 34000, BuybackPrice: 37000, BasePointRate: 1, UpdatedAt: now},
	}, nil
}
