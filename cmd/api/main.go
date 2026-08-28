package main

import (
	"context"
	"github.com/yota/sprea/backend/internal/httpapi"
	"github.com/yota/sprea/backend/internal/repository"
	"github.com/yota/sprea/backend/internal/research"
	"github.com/yota/sprea/backend/internal/service"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func main() {
	if err := os.MkdirAll("data", 0755); err != nil {
		log.Fatal(err)
	}
	repo, err := repository.NewSQLite(filepath.Join("data", "sprea.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer repo.Close()
	researchStore, err := research.Open(filepath.Join("data", "sprea-research.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer researchStore.Close()
	if os.Getenv("SPREA_ENV") != "production" {
		if status, e := researchStore.MockMarketStatus(context.Background()); e == nil && status.ElapsedHours == 0 {
			_, _ = researchStore.AdvanceMockMarket(context.Background(), 0)
		}
		go func() {
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				now, _, e := researchStore.MockClock(context.Background())
				if e == nil {
					_, auto, _ := researchStore.MockControl(context.Background())
					if auto {
						_, _ = researchStore.AdvanceMockMarket(context.Background(), 1)
						continue
					}
					_, _ = researchStore.EvaluateDue(context.Background(), now, 1000, 0, 5000)
					_, _ = researchStore.EvaluateDecisions(context.Background(), now, 5000)
				}
			}
		}()
	}
	addr := ":8080"
	log.Printf("Sprea API listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, httpapi.New(service.New(repo), repo, repo, os.Getenv("SPREA_INGEST_API_KEY"), researchStore)))
}
