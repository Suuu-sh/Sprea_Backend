package yahoo

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNormalizesAppleNewOnly(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("appid") != "id" {
			t.Error("appid")
		}
		_, _ = w.Write([]byte(`{"hits":[{"name":"Apple iPhone 17 Pro 256GB MG854J/A 新品","code":"s:1","price":180000,"url":"https://x","janCode":"4900000000001","availability":"in_stock"},{"name":"iPhone 中古","code":"s:2","price":1}]}`))
	}))
	defer s.Close()
	c, _ := New(Config{ClientID: "id", Endpoint: s.URL, HTTPClient: s.Client(), Results: 2})
	x, err := c.CollectProducts(context.Background())
	if err != nil || len(x) != 1 || x[0].JAN != "4900000000001" || x[0].Model != "MG854J/A" {
		t.Fatalf("%+v %v", x, err)
	}
}
