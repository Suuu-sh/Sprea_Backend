package research

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMockMarketAdvancesAndEvaluates(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	if _, err = s.AdvanceMockMarket(ctx, 0); err != nil {
		t.Fatal(err)
	}
	status, err := s.AdvanceMockMarket(ctx, 48)
	if err != nil {
		t.Fatal(err)
	}
	if status.ElapsedHours != 48 {
		t.Fatalf("elapsed=%d", status.ElapsedHours)
	}
	if len(status.Evaluations) == 0 {
		t.Fatal("expected due evaluations")
	}
}

func TestMockScenariosChangePrices(t *testing.T) {
	a := MockObservations(mockBaseTime, 0)
	b := MockObservations(mockBaseTime, 48)
	if a[1].Price == b[1].Price {
		t.Fatal("buyback price did not change")
	}
}

func TestMockScenarioVariants(t *testing.T) {
	base := mockObservationsForScenario(mockBaseTime, 0, "stable")
	crash := mockObservationsForScenario(mockBaseTime, 48, "crash")
	recovery := mockObservationsForScenario(mockBaseTime, 72, "recovery")
	stockout := mockObservationsForScenario(mockBaseTime, 24, "stockout")
	lost := mockObservationsForScenario(mockBaseTime, 48, "top_store_loss")
	if crash[1].Price >= base[1].Price {
		t.Fatal("crash scenario did not crash")
	}
	if recovery[1].Price <= crash[1].Price {
		t.Fatal("recovery scenario did not recover")
	}
	if stockout[0].Price != 0 {
		t.Fatal("stockout scenario kept purchase")
	}
	if lost[1].Price != 0 {
		t.Fatal("top store did not disappear")
	}
}
