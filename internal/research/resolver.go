package research

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

var capacityRE = regexp.MustCompile(`(?i)(\d+)\s*(tb|gb)`)

// Resolve deliberately rejects weak name-only matches. Research v1 admits only
// Apple, new-condition observations with JAN or model+capacity evidence.
func Resolve(o Observation) (ResolvedObservation, error) {
	if !strings.Contains(strings.ToLower(o.Title+" "+o.Model), "apple") && !looksLikeApple(o.Title) {
		return ResolvedObservation{}, fmt.Errorf("not an Apple product")
	}
	if c := strings.ToLower(strings.TrimSpace(o.Condition)); c != "new" && c != "新品" {
		return ResolvedObservation{}, fmt.Errorf("condition must be new")
	}
	jan := digits(o.JAN)
	if len(jan) == 8 || len(jan) == 13 {
		return ResolvedObservation{Observation: o, CanonicalKey: "jan:" + jan, Confidence: 1, MatchReason: "exact JAN"}, nil
	}
	model := normalize(o.Model)
	capacity := normalizeCapacity(o.Capacity)
	if capacity == "" {
		if m := capacityRE.FindStringSubmatch(o.Title); m != nil {
			capacity = strings.ToLower(m[1] + m[2])
		}
	}
	if model == "" || capacity == "" {
		return ResolvedObservation{}, fmt.Errorf("model and capacity are required when JAN is absent")
	}
	key := "apple:" + model + ":" + capacity
	if color := normalize(o.Color); color != "" {
		key += ":" + color
	}
	return ResolvedObservation{Observation: o, CanonicalKey: key, Confidence: .97, MatchReason: "model+capacity attributes"}, nil
}

func looksLikeApple(s string) bool {
	s = strings.ToLower(s)
	for _, token := range []string{"iphone", "ipad", "airpods", "apple watch", "macbook", "mac mini", "imac"} {
		if strings.Contains(s, token) {
			return true
		}
	}
	return false
}
func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return -1
	}, s)
}
func normalizeCapacity(s string) string {
	if m := capacityRE.FindStringSubmatch(s); m != nil {
		return strings.ToLower(m[1] + m[2])
	}
	return normalize(s)
}
func digits(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, s)
}
