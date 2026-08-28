import numpy as np
from promote import promotable
from train import metrics

def test_label_boundary_metrics():
    m=metrics([True,False],[5000,-100],[.9,.8],.9)
    assert m["precision"]==1 and m["average_profit_yen"]==5000

def test_promotion_requires_all_gates_and_coverage():
    incumbent={"precision":.8,"average_profit_yen":6000,"max_loss_yen":-1000,"selected":10}
    assert promotable({"precision":.9,"average_profit_yen":7000,"max_loss_yen":-500,"selected":4},incumbent)
    assert not promotable({"precision":.95,"average_profit_yen":5000,"max_loss_yen":-500,"selected":4},incumbent)
    assert not promotable({"precision":1,"average_profit_yen":9000,"max_loss_yen":0,"selected":1},incumbent)
