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
