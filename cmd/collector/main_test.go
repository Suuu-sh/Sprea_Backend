package main

import (
	"context"
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

func TestProductionRejectsMock(t *testing.T) {
	t.Setenv("SPREA_ENV", "production")
	t.Setenv("SPREA_COLLECTOR_MODE", "mock")
	if _, err := collectorForEnvironment(); err == nil {
		t.Fatal("production accepted mock collector")
	}
}
