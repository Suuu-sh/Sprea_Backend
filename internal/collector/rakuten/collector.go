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

	"github.com/yota/sprea/backend/internal/domain"
	"github.com/yota/sprea/backend/internal/port"
)

// Current production version as of 2026-08. Rakuten retired the legacy
// app.rakuten.co.jp endpoint and now requires an access key in addition to the
// application ID.
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
// application ID and access key are required; the remaining values have safe
// local defaults.
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
	products, err := c.CollectProducts(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Opportunity, 0, len(products))
	for _, product := range products {
		items = append(items, domain.Opportunity{
			Name: product.Name, Category: product.GenreID, Source: "楽天市場",
			ImageURL: product.ImageURL, PurchasePrice: product.Price,
			Buyer: "未照合", BuybackPrice: 0, BasePointRate: product.PointRate,
			UpdatedAt: time.Now().Format(time.RFC3339),
		})
	}
	return items, nil
}

// Product preserves identifiers and destination URLs needed by the later
// matching and affiliate-link layers. port.Collector's Opportunity cannot yet
// represent these fields, so callers needing them should use CollectProducts.
type Product struct {
	ItemCode     string
	Name         string
	Price        int
	GenreID      string
	PointRate    int
	ImageURL     string
	ItemURL      string
	AffiliateURL string
}

func (c *Collector) CollectProducts(ctx context.Context) ([]Product, error) {
	u, err := url.Parse(c.endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse Rakuten endpoint: %w", err)
	}
	q := u.Query()
	q.Set("applicationId", c.applicationID)
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
	req.Header.Set("accessKey", c.accessKey)
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
	if len(payload.Items) == 0 && len(payload.LegacyItems) > 0 {
		payload.Items = payload.LegacyItems
	}
	items := make([]Product, 0, len(payload.Items))
	for _, item := range payload.Items {
		imageURL := ""
		if len(item.MediumImageURLs) > 0 {
			imageURL = item.MediumImageURLs[0]
		}
		items = append(items, Product{
			ItemCode: item.ItemCode, Name: item.ItemName, Price: item.ItemPrice,
			GenreID: fmt.Sprint(item.GenreID), PointRate: item.PointRate, ImageURL: imageURL,
			ItemURL: item.ItemURL, AffiliateURL: item.AffiliateURL,
		})
	}
	return items, nil
}

type searchResponse struct {
	Items       []rakutenItem `json:"Items"`
	LegacyItems []rakutenItem `json:"items"`
}
type rakutenItem struct {
	ItemName        string   `json:"itemName"`
	ItemCode        string   `json:"itemCode"`
	ItemPrice       int      `json:"itemPrice"`
	GenreID         any      `json:"genreId"`
	PointRate       int      `json:"pointRate"`
	MediumImageURLs []string `json:"mediumImageUrls"`
	ItemURL         string   `json:"itemUrl"`
	AffiliateURL    string   `json:"affiliateUrl"`
}
