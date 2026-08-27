package httpapi

import (
	"database/sql"
	"encoding/json"
	"github.com/yota/sprea/backend/internal/collector"
	buybackcsv "github.com/yota/sprea/backend/internal/collector/csv"
	"github.com/yota/sprea/backend/internal/domain"
	"github.com/yota/sprea/backend/internal/port"
	"github.com/yota/sprea/backend/internal/service"
	"net/http"
	"strconv"
	"strings"
)

type Handler struct {
	service   *service.Opportunities
	market    port.MarketRepository
	repo      port.OpportunityRepository
	ingestKey string
}

func New(s *service.Opportunities, repo port.OpportunityRepository, market port.MarketRepository, ingestKey string) http.Handler {
	h := &Handler{service: s, repo: repo, market: market, ingestKey: ingestKey}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/opportunities", h.list)
	mux.HandleFunc("GET /api/opportunities/{id}", h.find)
	mux.HandleFunc("GET /api/history/{id}", h.history)
	mux.HandleFunc("GET /api/settings", h.getSettings)
	mux.HandleFunc("PUT /api/settings", h.saveSettings)
	mux.HandleFunc("GET /api/alerts", h.listAlerts)
	mux.HandleFunc("POST /api/alerts", h.createAlert)
	mux.HandleFunc("GET /api/notifications", h.notifications)
	mux.HandleFunc("GET /api/collector/status", h.collectorStatus)
	mux.HandleFunc("POST /api/collector/runs", h.recordCollectorRun)
	mux.HandleFunc("POST /api/ingest", h.ingest)
	mux.HandleFunc("POST /api/import/buybacks.csv", h.importBuybacksCSV)
	return cors(mux)
}
func (h *Handler) notifications(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.market.ListNotifications(r.Context(), userID(r), limit)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, items)
}
func (h *Handler) collectorStatus(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.market.ListCollectorRuns(r.Context(), limit)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"lastRun": func() any {
		if len(items) > 0 {
			return items[0]
		}
		return nil
	}(), "runs": items})
}
func (h *Handler) recordCollectorRun(w http.ResponseWriter, r *http.Request) {
	if h.ingestKey == "" || r.Header.Get("Authorization") != "Bearer "+h.ingestKey {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	var x domain.CollectorRun
	if err := json.NewDecoder(r.Body).Decode(&x); err != nil {
		writeError(w, 400, err)
		return
	}
	if strings.TrimSpace(x.RunID) == "" || strings.TrimSpace(x.Source) == "" || (x.Status != "running" && x.Status != "succeeded" && x.Status != "failed") || x.ItemCount < 0 || len(x.Message) > 1000 {
		writeJSON(w, 400, map[string]string{"error": "invalid collector run"})
		return
	}
	if err := h.market.RecordCollectorRun(r.Context(), x); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 202, x)
}
func userID(r *http.Request) string {
	if v := r.Header.Get("X-User-ID"); v != "" {
		return v
	}
	return "local-user"
}
func (h *Handler) history(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	x, err := h.market.History(r.Context(), id, 30)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, x)
}
func (h *Handler) getSettings(w http.ResponseWriter, r *http.Request) {
	x, err := h.market.GetSettings(r.Context(), userID(r))
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, x)
}
func (h *Handler) saveSettings(w http.ResponseWriter, r *http.Request) {
	var x domain.UserSettings
	if err := json.NewDecoder(r.Body).Decode(&x); err != nil {
		writeError(w, 400, err)
		return
	}
	x.UserID = userID(r)
	if x.PointAdjustment < -5 || x.PointAdjustment > 20 || x.MinimumProfit < 0 || x.MinimumProfitRate < 0 {
		writeJSON(w, 400, map[string]string{"error": "invalid settings"})
		return
	}
	if err := h.market.SaveSettings(r.Context(), x); err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, x)
}
func (h *Handler) listAlerts(w http.ResponseWriter, r *http.Request) {
	x, err := h.market.ListAlerts(r.Context(), userID(r))
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, x)
}
func (h *Handler) createAlert(w http.ResponseWriter, r *http.Request) {
	var x domain.AlertRule
	if err := json.NewDecoder(r.Body).Decode(&x); err != nil {
		writeError(w, 400, err)
		return
	}
	x.UserID = userID(r)
	x.Enabled = true
	if strings.TrimSpace(x.Name) == "" {
		writeJSON(w, 400, map[string]string{"error": "name is required"})
		return
	}
	saved, err := h.market.CreateAlert(r.Context(), x)
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 201, saved)
}

func (h *Handler) importBuybacksCSV(w http.ResponseWriter, r *http.Request) {
	if h.ingestKey != "" && r.Header.Get("Authorization") != "Bearer "+h.ingestKey {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	offers, err := buybackcsv.Read(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		writeError(w, 400, err)
		return
	}
	items, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, 500, err)
		return
	}
	updated := collector.MatchOpportunities(items, offers, .8)
	matched := 0
	for i := range updated {
		if updated[i].BuybackPrice != items[i].BuybackPrice || updated[i].Buyer != items[i].Buyer {
			matched++
		}
	}
	if err = h.repo.ReplaceAll(r.Context(), updated); err != nil {
		writeError(w, 500, err)
		return
	}
	saved, err := h.repo.List(r.Context())
	if err == nil {
		err = h.market.RecordSnapshots(r.Context(), saved)
	}
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]int{"offers": len(offers), "matched": matched})
}
func (h *Handler) ingest(w http.ResponseWriter, r *http.Request) {
	if h.ingestKey != "" && r.Header.Get("Authorization") != "Bearer "+h.ingestKey {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	var items []domain.Opportunity
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		writeError(w, 400, err)
		return
	}
	if len(items) > 1000 {
		writeJSON(w, 400, map[string]string{"error": "too many items"})
		return
	}
	if err := h.repo.ReplaceAll(r.Context(), items); err != nil {
		writeError(w, 500, err)
		return
	}
	saved, err := h.repo.List(r.Context())
	if err == nil {
		err = h.market.RecordSnapshots(r.Context(), saved)
	}
	created := 0
	if err == nil {
		created, err = h.market.EvaluateNotifications(r.Context(), saved)
	}
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 202, map[string]int{"accepted": len(items), "notificationsCreated": created})
}
func adjustment(r *http.Request) int {
	v, _ := strconv.Atoi(r.URL.Query().Get("pointAdjustment"))
	if v < -20 {
		return -20
	}
	if v > 50 {
		return 50
	}
	return v
}
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.List(r.Context(), adjustment(r))
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, items)
}
func (h *Handler) find(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, 400, err)
		return
	}
	o, err := h.service.Find(r.Context(), id, adjustment(r))
	if err == sql.ErrNoRows {
		writeError(w, 404, err)
		return
	}
	if err != nil {
		writeError(w, 500, err)
		return
	}
	writeJSON(w, 200, o)
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if strings.HasPrefix(origin, "http://localhost:") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-User-ID,Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
