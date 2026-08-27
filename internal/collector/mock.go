package collector

import (
	"context"
	"github.com/Suuu-sh/Sprea_Backend/internal/domain"
)

type Mock struct{}

func (Mock) Collect(context.Context) ([]domain.Opportunity, error) {
	return []domain.Opportunity{
		{Name: "Nintendo Switch（有機ELモデル）", Category: "ゲーム", Source: "楽天市場", Buyer: "じゃんぱら", ImageURL: "🎮", PurchasePrice: 34980, BuybackPrice: 36000, BasePointRate: 8, UpdatedAt: "5分前"},
		{Name: "AirPods Pro（第2世代）USB-C", Category: "オーディオ", Source: "楽天市場", Buyer: "ゲオ", ImageURL: "🎧", PurchasePrice: 32800, BuybackPrice: 35000, BasePointRate: 6, UpdatedAt: "12分前"},
		{Name: "iPad（第10世代）64GB Wi-Fi", Category: "タブレット", Source: "Yahoo!ショッピング", Buyer: "じゃんぱら", ImageURL: "▣", PurchasePrice: 52800, BuybackPrice: 56500, BasePointRate: 5, UpdatedAt: "18分前"},
		{Name: "PlayStation 5 Slim", Category: "ゲーム", Source: "楽天市場", Buyer: "ソフマップ", ImageURL: "♟", PurchasePrice: 66980, BuybackPrice: 69000, BasePointRate: 4, UpdatedAt: "24分前"},
		{Name: "Apple Watch Series 10 GPS 42mm", Category: "ウェアラブル", Source: "Yahoo!ショッピング", Buyer: "ゲオ", ImageURL: "⌚", PurchasePrice: 54800, BuybackPrice: 57000, BasePointRate: 3, UpdatedAt: "31分前"},
	}, nil
}
