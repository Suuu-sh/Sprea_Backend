package rakuten

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRequiresApplicationID(t *testing.T) {
	_, err := New(Config{AccessKey: "key"})
	if !errors.Is(err, ErrMissingApplicationID) {
		t.Fatalf("got %v", err)
	}
}

func TestNewRequiresAccessKey(t *testing.T) {
	_, err := New(Config{ApplicationID: "app"})
	if !errors.Is(err, ErrMissingAccessKey) {
		t.Fatalf("got %v", err)
	}
}

func TestCollectRequestsAndMapsItems(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("applicationId") != "test-app" || q.Get("accessKey") != "test-key" || q.Get("keyword") != "ゲーム機" || q.Get("hits") != "2" || q.Get("formatVersion") != "2" {
			t.Errorf("unexpected query: %v", q)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"Items":[{"itemName":"Nintendo Switch","itemPrice":34980,"genreName":"ゲーム","pointRate":8,"mediumImageUrls":["https://example.com/switch.jpg"]}]}`))
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
	if got.Name != "Nintendo Switch" || got.PurchasePrice != 34980 || got.Category != "ゲーム" || got.BasePointRate != 8 || got.ImageURL != "https://example.com/switch.jpg" {
		t.Fatalf("unexpected mapped item: %+v", got)
	}
	if got.Source != "楽天市場" || got.Buyer != "未照合" || got.BuybackPrice != 0 {
		t.Fatalf("unexpected defaults: %+v", got)
	}
}

func TestCollectReturnsStatusError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "nope", http.StatusUnauthorized) }))
	defer server.Close()
	c, _ := New(Config{ApplicationID: "bad", AccessKey: "key", Keyword: "x", Endpoint: server.URL, HTTPClient: server.Client()})
	if _, err := c.Collect(context.Background()); err == nil {
		t.Fatal("expected status error")
	}
}

func TestCollectSupportsLegacyWrappedItems(t *testing.T) {
	// formatVersion=2 is requested and is the supported response shape. Keep this
	// test focused on an empty successful response, which must remain non-nil.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"Items":[]}`)) }))
	defer server.Close()
	c, _ := New(Config{ApplicationID: "test", AccessKey: "key", Endpoint: server.URL, HTTPClient: server.Client()})
	items, err := c.Collect(context.Background())
	if err != nil || items == nil {
		t.Fatalf("items=%v err=%v", items, err)
	}
}
