package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/yota/sprea/backend/internal/collector"
	buybackcsv "github.com/yota/sprea/backend/internal/collector/csv"
	"github.com/yota/sprea/backend/internal/collector/rakuten"
	"github.com/yota/sprea/backend/internal/port"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var source port.Collector = collector.Mock{}
	if strings.EqualFold(os.Getenv("SPREA_COLLECTOR_MODE"), "live") {
		c, err := rakuten.NewFromEnv()
		if err != nil {
			log.Fatal(err)
		}
		source = c
	}
	if path := strings.TrimSpace(os.Getenv("SPREA_BUYBACK_CSV")); path != "" {
		offers, err := buybackcsv.ReadFile(path)
		if err != nil {
			log.Fatal(err)
		}
		source = collector.Matched{Purchases: source, Buybacks: offers}
	}
	items, err := source.Collect(ctx)
	if err != nil {
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
	base := strings.TrimRight(os.Getenv("SPREA_API_URL"), "/")
	if base == "" {
		base = "http://localhost:8080"
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
		log.Fatal(fmt.Errorf("ingest failed: %s", resp.Status))
	}
	log.Printf("ingested %d opportunities", len(items))
}
