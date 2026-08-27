package csv

import (
	"strings"
	"testing"
)

func TestRead(t *testing.T) {
	x, e := Read(strings.NewReader("buyer,name,buyback_price,jan,capacity\nじゃんぱら,iPad,55000,4901234567890,64GB\n"))
	if e != nil || len(x) != 1 || x[0].Price != 55000 || x[0].JAN != "4901234567890" {
		t.Fatalf("x=%+v err=%v", x, e)
	}
}
func TestReadValidation(t *testing.T) {
	if _, e := Read(strings.NewReader("name,buyer\nx,y\n")); e == nil {
		t.Fatal("header")
	}
	if _, e := Read(strings.NewReader("name,buyer,buyback_price\nx,y,nope\n")); e == nil {
		t.Fatal("price")
	}
}
