package main

import (
	"context"
	"github.com/yota/sprea/backend/internal/domain"
	"testing"
)

func TestLocalUsesMockWithoutCredentials(t *testing.T) {
	t.Setenv("SPREA_ENV", "local")
	t.Setenv("SPREA_COLLECTOR_MODE", "mock")
	c, err := collectorForEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	items, err := c.Collect(context.Background())
	if err != nil || len(items) == 0 || items[0].Source != "LOCAL MOCK STORE" {
		t.Fatalf("items=%v err=%v", items, err)
	}
}

func TestCollectorAnomalyStopsBadData(t *testing.T) {
	t.Setenv("SPREA_MIN_ITEMS", "2")
	if err := validateCollectedItems([]domain.Opportunity{{PurchasePrice: 100}}, 0); err == nil {
		t.Fatal("minimum count was not enforced")
	}
	if err := validateCollectedItems([]domain.Opportunity{{PurchasePrice: 100}, {PurchasePrice: 200}}, 20); err == nil {
		t.Fatal("sudden decrease was not detected")
	}
}

func TestProductionRejectsMock(t *testing.T) {
	t.Setenv("SPREA_ENV", "production")
	t.Setenv("SPREA_COLLECTOR_MODE", "mock")
	if _, err := collectorForEnvironment(); err == nil {
		t.Fatal("production accepted mock collector")
	}
}
