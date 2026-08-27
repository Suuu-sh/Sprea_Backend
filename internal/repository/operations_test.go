package repository

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/yota/sprea/backend/internal/domain"
)

func TestNotificationOutboxDeduplicatesUnchangedOpportunity(t *testing.T) {
	repo, err := NewSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	ctx := context.Background()
	_, err = repo.CreateAlert(ctx, domain.AlertRule{UserID: "u1", Name: "利益通知", MinimumProfit: 1000, MinimumProfitRate: 1, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	items := []domain.Opportunity{{ID: 1, Name: "商品", PurchasePrice: 10000, BuybackPrice: 12000, BasePointRate: 0}}
	if n, err := repo.EvaluateNotifications(ctx, items); err != nil || n != 1 {
		t.Fatalf("first n=%d err=%v", n, err)
	}
	if n, err := repo.EvaluateNotifications(ctx, items); err != nil || n != 0 {
		t.Fatalf("duplicate n=%d err=%v", n, err)
	}
	items[0].BuybackPrice = 13000
	if n, err := repo.EvaluateNotifications(ctx, items); err != nil || n != 1 {
		t.Fatalf("changed n=%d err=%v", n, err)
	}
	history, err := repo.ListNotifications(ctx, "u1", 10)
	if err != nil || len(history) != 2 {
		t.Fatalf("history=%v err=%v", history, err)
	}
}

func TestCollectorRunUpsertAndLatest(t *testing.T) {
	repo, err := NewSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	ctx := context.Background()
	run := domain.CollectorRun{RunID: "run-1", Source: "mock", Status: "running", StartedAt: "2026-01-01T00:00:00Z"}
	if err := repo.RecordCollectorRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	run.Status = "succeeded"
	run.ItemCount = 5
	run.FinishedAt = "2026-01-01T00:01:00Z"
	if err := repo.RecordCollectorRun(ctx, run); err != nil {
		t.Fatal(err)
	}
	runs, err := repo.ListCollectorRuns(ctx, 10)
	if err != nil || len(runs) != 1 || runs[0].Status != "succeeded" || runs[0].ItemCount != 5 {
		t.Fatalf("runs=%v err=%v", runs, err)
	}
}
