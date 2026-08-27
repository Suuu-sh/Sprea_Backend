package main

import (
	"context"
	"github.com/Suuu-sh/Sprea_Backend/internal/collector"
	"github.com/Suuu-sh/Sprea_Backend/internal/httpapi"
	"github.com/Suuu-sh/Sprea_Backend/internal/repository"
	"github.com/Suuu-sh/Sprea_Backend/internal/service"
	"log"
	"net/http"
	"os"
	"path/filepath"
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
	items, err := repo.List(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	if len(items) == 0 {
		fresh, err := (collector.Mock{}).Collect(context.Background())
		if err != nil {
			log.Fatal(err)
		}
		if err = repo.SaveAll(context.Background(), fresh); err != nil {
			log.Fatal(err)
		}
	}
	items, err = repo.List(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	if err = repo.RecordSnapshots(context.Background(), items); err != nil {
		log.Fatal(err)
	}
	addr := ":8080"
	log.Printf("Sprea API listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, httpapi.New(service.New(repo), repo, repo, os.Getenv("SPREA_INGEST_API_KEY"))))
}
