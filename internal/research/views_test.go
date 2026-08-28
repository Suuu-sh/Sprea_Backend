package research

import (
	"context"
	"path/filepath"
	"testing"
)

func TestResearchOperations(t *testing.T) {
	ctx := context.Background()
	s, e := Open(filepath.Join(t.TempDir(), "x.db"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if _, e = s.AdvanceMockMarket(ctx, 0); e != nil {
		t.Fatal(e)
	}
	d, e := s.GetProductDetail(ctx, "jan:4900000000001")
	if e != nil || len(d.History) != 3 || d.History[0].MatchReason != "exact JAN" {
		t.Fatalf("detail=%+v err=%v", d, e)
	}
	settings := defaultResearchSettings()
	settings.MinimumProfit = 7000
	settings.EvaluationHours = []int{24, 72}
	if _, e = s.SaveResearchSettings(ctx, settings); e != nil {
		t.Fatal(e)
	}
	got, _ := s.GetResearchSettings(ctx)
	if got.MinimumProfit != 7000 || len(got.EvaluationHours) != 2 {
		t.Fatalf("settings=%+v", got)
	}
	if _, e = s.AdvanceMockMarket(ctx, 24); e != nil {
		t.Fatal(e)
	}
	schedules, _ := s.EvaluationSchedules(ctx)
	for _, x := range schedules {
		if x.HorizonHours == 48 || x.HorizonHours == 168 {
			t.Fatal("disabled horizon scheduled")
		}
	}
	run, e := s.RunEvaluator(ctx, "test", mockBaseTime.Add(24*60*60*1000000000))
	if e != nil || run.Status != "succeeded" {
		t.Fatalf("run=%+v err=%v", run, e)
	}
	runs, _ := s.ListEvaluatorRuns(ctx)
	if len(runs) == 0 {
		t.Fatal("run log missing")
	}
	trades, _ := s.ListPaperTrades(ctx)
	if len(trades) == 0 {
		t.Fatal("paper trade missing")
	}
	if _, e = s.ClosePaperTrade(ctx, trades[0].ID, mockBaseTime); e != nil {
		t.Fatal(e)
	}
}
