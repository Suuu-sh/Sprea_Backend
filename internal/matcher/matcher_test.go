package matcher

import "testing"

func TestMatchJANPriority(t *testing.T) {
	r := Match(Product{Name: "totally different", JAN: "490-1234567890"}, Product{Name: "x", JAN: "4901234567890"})
	if !r.Matched || r.Confidence != 1 {
		t.Fatalf("unexpected: %+v", r)
	}
	if Match(Product{JAN: "4901234567890"}, Product{JAN: "4901234567891"}).Matched {
		t.Fatal("different JAN matched")
	}
}

func TestMatchRejectsVariantsBeforeJAN(t *testing.T) {
	for _, tc := range []struct {
		name string
		a, b Product
	}{
		{"capacity", Product{JAN: "4901234567890", Capacity: "64 GB"}, Product{JAN: "4901234567890", Capacity: "128GB"}},
		{"color", Product{Model: "ABC-1", Color: "black"}, Product{Model: "abc1", Color: "white"}},
		{"generation", Product{Model: "ABC-1", Generation: "第2世代"}, Product{Model: "abc1", Generation: "第3世代"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if Match(tc.a, tc.b).Matched {
				t.Fatal("variant mismatch matched")
			}
		})
	}
}

func TestMatchNormalizedModel(t *testing.T) {
	r := Match(Product{Model: "型番 ＭＱＤ８３Ｊ／Ａ"}, Product{Model: "model: mqd83j-a"})
	if !r.Matched || r.Confidence != .94 {
		t.Fatalf("unexpected: %+v", r)
	}
}

func TestMatchNameConservatively(t *testing.T) {
	r := Match(Product{Name: "Apple AirPods Pro USB C 第2世代"}, Product{Name: "Apple AirPods Pro USB C 第2世代 新品"})
	if !r.Matched || r.Confidence < .8 {
		t.Fatalf("unexpected: %+v", r)
	}
	if Match(Product{Name: "AirPods Pro"}, Product{Name: "AirPods Max"}).Matched {
		t.Fatal("weak name matched")
	}
}
func TestEnrichRejectsVariantsEmbeddedInName(t *testing.T) {
	r := Match(Product{Name: "iPad 第２世代 64 GB"}, Product{Name: "iPad 第3世代 64GB"})
	if r.Matched || r.Reason != "generation mismatch" {
		t.Fatalf("unexpected: %+v", r)
	}
	r = Match(Product{Name: "iPad 第2世代 64GB"}, Product{Name: "iPad 第2世代 128 GB"})
	if r.Matched || r.Reason != "capacity mismatch" {
		t.Fatalf("unexpected: %+v", r)
	}
}
