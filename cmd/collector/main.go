package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/yota/sprea/backend/internal/collector"
	buybackcsv "github.com/yota/sprea/backend/internal/collector/csv"
	"github.com/yota/sprea/backend/internal/collector/rakuten"
	"github.com/yota/sprea/backend/internal/collector/yahoo"
	"github.com/yota/sprea/backend/internal/domain"
	"github.com/yota/sprea/backend/internal/port"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	source, err := collectorForEnvironment()
	if err != nil {
		log.Fatal(err)
	}
	items, err := source.Collect(ctx)
	if err != nil {
		log.Fatal(err)
	}
	base := strings.TrimRight(os.Getenv("SPREA_API_URL"), "/")
	if base == "" {
		base = "http://localhost:8080"
	}
	if err := validateCollectedItems(items, lastCollectorCount(ctx, base)); err != nil {
		recordCollectorRun(ctx, base, "failed", len(items), err.Error())
		notifyCollectorFailure(ctx, err.Error())
		log.Fatal(err)
	}
	body, err := json.Marshal(items)
	if err != nil {
		log.Fatal(err)
	}
	if strings.EqualFold(os.Getenv("SPREA_DRY_RUN"), "true") {
		log.Printf("dry run: collected %d items", len(items))
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/ingest", bytes.NewReader(body))
	if err != nil {
		log.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if key := os.Getenv("SPREA_INGEST_API_KEY"); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		recordCollectorRun(ctx, base, "failed", len(items), "ingest failed: "+resp.Status)
		notifyCollectorFailure(ctx, "ingest failed: "+resp.Status)
		log.Fatal(fmt.Errorf("ingest failed: %s", resp.Status))
	}
	recordCollectorRun(ctx, base, "succeeded", len(items), "")
	log.Printf("ingested %d opportunities", len(items))
}

func collectorForEnvironment() (port.Collector, error) {
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("SPREA_ENV")))
	if environment == "" {
		environment = "local"
	}
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("SPREA_COLLECTOR_MODE")))
	if mode == "" {
		if environment == "production" {
			mode = "live"
		} else {
			mode = "mock"
		}
	}
	if environment == "production" && mode != "live" {
		return nil, fmt.Errorf("production requires SPREA_COLLECTOR_MODE=live")
	}
	if environment != "production" {
		if mode != "mock" {
			return nil, fmt.Errorf("local development requires SPREA_COLLECTOR_MODE=mock")
		}
		return collector.Mock{}, nil
	}
	var c port.Collector
	var err error
	if strings.EqualFold(os.Getenv("SPREA_COLLECTOR_SOURCE"), "yahoo") {
		c, err = yahoo.NewFromEnv()
	} else {
		c, err = rakuten.NewFromEnv()
	}
	if err != nil {
		return nil, err
	}
	var source port.Collector = c
	if path := strings.TrimSpace(os.Getenv("SPREA_BUYBACK_CSV")); path != "" {
		offers, err := buybackcsv.ReadFile(path)
		if err != nil {
			return nil, err
		}
		source = collector.Matched{Purchases: source, Buybacks: offers}
	}
	return source, nil
}

func validateCollectedItems(items []domain.Opportunity, previous int) error {
	min, _ := strconv.Atoi(os.Getenv("SPREA_MIN_ITEMS"))
	if min <= 0 {
		min = 1
	}
	if len(items) < min {
		return fmt.Errorf("collector anomaly: got %d items, minimum is %d", len(items), min)
	}
	if previous >= 4 && len(items)*4 < previous {
		return fmt.Errorf("collector anomaly: item count fell from %d to %d", previous, len(items))
	}
	for _, x := range items {
		if x.PurchasePrice <= 0 {
			return fmt.Errorf("collector anomaly: non-positive price")
		}
	}
	return nil
}
func lastCollectorCount(ctx context.Context, base string) int {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/collector/status?limit=1", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	var x struct {
		LastRun *domain.CollectorRun `json:"lastRun"`
	}
	if json.NewDecoder(resp.Body).Decode(&x) == nil && x.LastRun != nil {
		return x.LastRun.ItemCount
	}
	return 0
}
func recordCollectorRun(ctx context.Context, base, status string, count int, message string) {
	x := domain.CollectorRun{RunID: fmt.Sprintf("%d", time.Now().UnixNano()), Source: os.Getenv("SPREA_COLLECTOR_SOURCE"), Status: status, ItemCount: count, Message: message, StartedAt: time.Now().UTC().Format(time.RFC3339), FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	if x.Source == "" {
		x.Source = "rakuten"
	}
	b, _ := json.Marshal(x)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/collector/runs", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if key := os.Getenv("SPREA_INGEST_API_KEY"); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}
func notifyCollectorFailure(ctx context.Context, message string) {
	u := strings.TrimSpace(os.Getenv("SPREA_ALERT_WEBHOOK_URL"))
	if u == "" || os.Getenv("SPREA_ENV") != "production" {
		return
	}
	b, _ := json.Marshal(map[string]string{"text": "Sprea Collector停止: " + message})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}
