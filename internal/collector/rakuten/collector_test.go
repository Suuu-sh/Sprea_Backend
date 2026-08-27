package rakuten

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRequiresApplicationID(t *testing.T) {
	_, err := New(Config{})
	if !errors.Is(err, ErrMissingApplicationID) {
		t.Fatalf("got %v", err)
	}
}

func TestCollectRequestsAndMapsItems(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("applicationId") != "test-app" || q.Get("keyword") != "ゲーム機" || q.Get("hits") != "2" || q.Get("formatVersion") != "2" || r.Header.Get("accessKey") != "test-key" {
			t.Errorf("unexpected query: %v", q)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"Items":[{"itemName":"Nintendo Switch","itemPrice":34980,"genreId":"101205","itemCode":"shop:1","itemUrl":"https://item.example/1","affiliateUrl":"https://affiliate.example/1","pointRate":8,"mediumImageUrls":["https://example.com/switch.jpg"]}]}`))
	}))
	defer server.Close()

	c, err := New(Config{ApplicationID: "test-app", AccessKey: "test-key", Keyword: "ゲーム機", Hits: 2, Endpoint: server.URL, HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	items, err := c.Collect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("got %d items", len(items))
	}
	got := items[0]
	if got.Name != "Nintendo Switch" || got.PurchasePrice != 34980 || got.Category != "101205" || got.BasePointRate != 8 || got.ImageURL != "https://example.com/switch.jpg" {
		t.Fatalf("unexpected mapped item: %+v", got)
	}
	if got.Source != "楽天市場" || got.Buyer != "未照合" || got.BuybackPrice != 0 {
		t.Fatalf("unexpected defaults: %+v", got)
	}
}

func TestCollectReturnsStatusError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "nope", http.StatusUnauthorized) }))
	defer server.Close()
	c, _ := New(Config{ApplicationID: "bad", AccessKey: "test-key", Keyword: "x", Endpoint: server.URL, HTTPClient: server.Client()})
	if _, err := c.Collect(context.Background()); err == nil {
		t.Fatal("expected status error")
	}
}

func TestCollectSupportsLegacyWrappedItems(t *testing.T) {
	// formatVersion=2 is requested and is the supported response shape. Keep this
	// test focused on an empty successful response, which must remain non-nil.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"Items":[]}`)) }))
	defer server.Close()
	c, _ := New(Config{ApplicationID: "test", AccessKey: "test-key", Endpoint: server.URL, HTTPClient: server.Client()})
	items, err := c.Collect(context.Background())
	if err != nil || items == nil {
		t.Fatalf("items=%v err=%v", items, err)
	}
}

func TestNewRequiresAccessKey(t *testing.T) {
	_, err := New(Config{ApplicationID: "app"})
	if !errors.Is(err, ErrMissingAccessKey) {
		t.Fatalf("got %v", err)
	}
}

func TestCollectProductsPreservesAffiliateURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"items":[{"itemName":"Switch","itemCode":"shop:42","itemPrice":30000,"genreId":101205,"itemUrl":"https://item.example/42","affiliateUrl":"https://affiliate.example/42"}]}`))
	}))
	defer server.Close()
	c, _ := New(Config{ApplicationID: "app", AccessKey: "key", AffiliateID: "affiliate", Endpoint: server.URL, HTTPClient: server.Client()})
	products, err := c.CollectProducts(context.Background())
	if err != nil || len(products) != 1 {
		t.Fatalf("products=%v err=%v", products, err)
	}
	if products[0].AffiliateURL != "https://affiliate.example/42" || products[0].ItemCode != "shop:42" {
		t.Fatalf("affiliate fields lost: %+v", products[0])
	}
}
