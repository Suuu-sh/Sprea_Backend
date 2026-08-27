package main

import (
	"github.com/yota/sprea/backend/internal/httpapi"
	"github.com/yota/sprea/backend/internal/repository"
	"github.com/yota/sprea/backend/internal/research"
	"github.com/yota/sprea/backend/internal/service"
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
	researchStore, err := research.Open(filepath.Join("data", "sprea-research.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer researchStore.Close()
	addr := ":8080"
	log.Printf("Sprea API listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, httpapi.New(service.New(repo), repo, repo, os.Getenv("SPREA_INGEST_API_KEY"), researchStore)))
}
