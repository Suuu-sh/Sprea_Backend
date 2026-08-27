// Package rakuten implements a Collector backed by the Rakuten Ichiba Item
// Search API. It deliberately depends only on net/http so callers can inject a
// client (and tests can use an httptest server).
package rakuten

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Suuu-sh/Sprea_Backend/internal/domain"
	"github.com/Suuu-sh/Sprea_Backend/internal/port"
)

const defaultEndpoint = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701"

var ErrMissingApplicationID = errors.New("rakuten application ID is required")
var ErrMissingAccessKey = errors.New("rakuten access key is required")

type Config struct {
	ApplicationID string
	AccessKey     string
	AffiliateID   string
	Keyword       string
	GenreID       string
	Hits          int
	Endpoint      string
	HTTPClient    *http.Client
}

// NewFromEnv creates a collector from runtime configuration. Only the
// application ID is required; the remaining values have safe local defaults.
func NewFromEnv() (*Collector, error) {
	hits, _ := strconv.Atoi(os.Getenv("RAKUTEN_HITS"))
	return New(Config{
		ApplicationID: os.Getenv("RAKUTEN_APPLICATION_ID"),
		AccessKey:     os.Getenv("RAKUTEN_ACCESS_KEY"),
		AffiliateID:   os.Getenv("RAKUTEN_AFFILIATE_ID"),
		Keyword:       os.Getenv("RAKUTEN_KEYWORD"),
		GenreID:       os.Getenv("RAKUTEN_GENRE_ID"),
		Hits:          hits,
	})
}

type Collector struct {
	applicationID string
	accessKey     string
	affiliateID   string
	keyword       string
	genreID       string
	hits          int
	endpoint      string
	client        *http.Client
}

var _ port.Collector = (*Collector)(nil)

func New(cfg Config) (*Collector, error) {
	if strings.TrimSpace(cfg.ApplicationID) == "" {
		return nil, ErrMissingApplicationID
	}
	if strings.TrimSpace(cfg.AccessKey) == "" {
		return nil, ErrMissingAccessKey
	}
	if cfg.Keyword == "" && cfg.GenreID == "" {
		cfg.Keyword = "家電"
	}
	if cfg.Hits <= 0 {
		cfg.Hits = 30
	}
	if cfg.Hits > 30 {
		cfg.Hits = 30
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = defaultEndpoint
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &Collector{cfg.ApplicationID, cfg.AccessKey, cfg.AffiliateID, cfg.Keyword, cfg.GenreID, cfg.Hits, cfg.Endpoint, cfg.HTTPClient}, nil
}

func (c *Collector) Collect(ctx context.Context) ([]domain.Opportunity, error) {
	u, err := url.Parse(c.endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse Rakuten endpoint: %w", err)
	}
	q := u.Query()
	q.Set("applicationId", c.applicationID)
	q.Set("accessKey", c.accessKey)
	q.Set("format", "json")
	q.Set("formatVersion", "2")
	q.Set("hits", strconv.Itoa(c.hits))
	if c.affiliateID != "" {
		q.Set("affiliateId", c.affiliateID)
	}
	if c.keyword != "" {
		q.Set("keyword", c.keyword)
	}
	if c.genreID != "" {
		q.Set("genreId", c.genreID)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build Rakuten request: %w", err)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request Rakuten items: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Rakuten API returned %s", resp.Status)
	}

	var payload searchResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode Rakuten response: %w", err)
	}
	items := make([]domain.Opportunity, 0, len(payload.Items))
	for _, item := range payload.Items {
		imageURL := ""
		if len(item.MediumImageURLs) > 0 {
			imageURL = item.MediumImageURLs[0]
		}
		items = append(items, domain.Opportunity{
			Name: item.ItemName, Category: item.GenreName, Source: "楽天市場",
			ImageURL: imageURL, PurchasePrice: item.ItemPrice,
			// A buyback collector/matcher fills these fields in a later pipeline stage.
			Buyer: "未照合", BuybackPrice: 0, BasePointRate: item.PointRate,
			UpdatedAt: time.Now().Format(time.RFC3339),
		})
	}
	return items, nil
}

type searchResponse struct {
	Items []rakutenItem `json:"Items"`
}
type rakutenItem struct {
	ItemName        string   `json:"itemName"`
	ItemPrice       int      `json:"itemPrice"`
	GenreName       string   `json:"genreName"`
	PointRate       int      `json:"pointRate"`
	MediumImageURLs []string `json:"mediumImageUrls"`
}
