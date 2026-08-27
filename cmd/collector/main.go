package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/Suuu-sh/Sprea_Backend/internal/collector"
	"github.com/Suuu-sh/Sprea_Backend/internal/collector/rakuten"
	"github.com/Suuu-sh/Sprea_Backend/internal/port"
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
