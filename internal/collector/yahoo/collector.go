// Package yahoo implements Yahoo! Shopping itemSearch v3 using the official API only.
package yahoo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/yota/sprea/backend/internal/domain"
	"github.com/yota/sprea/backend/internal/port"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const endpoint = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch"

var ErrMissingClientID = errors.New("Yahoo Client ID is required")

type Config struct {
	ClientID, Query, Endpoint string
	Results                   int
	HTTPClient                *http.Client
}
type Product struct {
	Code, Name, JAN, Model, URL string
	Price, Shipping             int
	ShippingCode                int
	ShippingKnown               bool
	Stock                       bool
}
type Collector struct {
	cfg  Config
	mu   sync.Mutex
	last time.Time
}

var _ port.Collector = (*Collector)(nil)

func NewFromEnv() (*Collector, error) {
	n, _ := strconv.Atoi(os.Getenv("YAHOO_RESULTS"))
	return New(Config{ClientID: os.Getenv("YAHOO_CLIENT_ID"), Query: os.Getenv("YAHOO_QUERY"), Results: n})
}
func New(c Config) (*Collector, error) {
	if strings.TrimSpace(c.ClientID) == "" {
		return nil, ErrMissingClientID
	}
	if c.Query == "" {
		c.Query = "Apple iPhone iPad AirPods Apple Watch MacBook 新品"
	}
	if c.Results <= 0 || c.Results > 50 {
		c.Results = 30
	}
	if c.Endpoint == "" {
		c.Endpoint = endpoint
	}
	if c.HTTPClient == nil {
		c.HTTPClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &Collector{cfg: c}, nil
}
func (c *Collector) wait(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if d := time.Second - time.Since(c.last); d > 0 {
		select {
		case <-time.After(d):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	c.last = time.Now()
	return nil
}
func (c *Collector) CollectProducts(ctx context.Context) ([]Product, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	u, _ := url.Parse(c.cfg.Endpoint)
	q := u.Query()
	q.Set("appid", c.cfg.ClientID)
	q.Set("query", c.cfg.Query)
	q.Set("results", strconv.Itoa(c.cfg.Results))
	q.Set("condition", "new")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	resp, err := c.cfg.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Yahoo API returned %s", resp.Status)
	}
	var body struct {
		Hits []struct {
			Name, Code string
			Price      int
			URL        string
			JANCode    string `json:"janCode"`
			Shipping   struct{ Code int }
			InStock    bool `json:"inStock"`
		}
	}
	if err = json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := []Product{}
	for _, x := range body.Hits {
		lower := strings.ToLower(x.Name)
		if !isApple(lower) || strings.Contains(lower, "中古") || strings.Contains(lower, "整備済") || strings.Contains(lower, "訳あり") {
			continue
		}
		shipping, known := shippingPrice(x.Shipping.Code)
		out = append(out, Product{Code: x.Code, Name: x.Name, JAN: x.JANCode, Model: extractModel(x.Name), URL: x.URL, Price: x.Price, Shipping: shipping, ShippingCode: x.Shipping.Code, ShippingKnown: known, Stock: x.InStock})
	}
	return out, nil
}
func (c *Collector) Collect(ctx context.Context) ([]domain.Opportunity, error) {
	p, err := c.CollectProducts(ctx)
	if err != nil {
		return nil, err
	}
	out := []domain.Opportunity{}
	for _, x := range p {
		if !x.Stock {
			continue
		}
		out = append(out, domain.Opportunity{Name: x.Name, Category: "Apple", Source: "Yahoo!ショッピング", Buyer: "未照合", PurchasePrice: x.Price, UpdatedAt: time.Now().UTC().Format(time.RFC3339)})
	}
	return out, nil
}
func isApple(s string) bool {
	for _, x := range []string{"iphone", "ipad", "airpods", "apple watch", "macbook", "mac mini", "imac"} {
		if strings.Contains(s, x) {
			return true
		}
	}
	return false
}
func extractModel(s string) string {
	for _, f := range strings.Fields(s) {
		u := strings.ToUpper(strings.Trim(f, "[]()、,"))
		if strings.Contains(u, "/") && strings.HasSuffix(u, "A") {
			return u
		}
	}
	return ""
}
func shippingPrice(code int) (int, bool) {
	if code == 2 {
		return 0, true
	}
	return 0, false
}
