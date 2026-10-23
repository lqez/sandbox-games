extends Node
## 개발용: 자동 전투로 던전을 끝까지 돌려 막히는 곳 없이 클리어되는지 본다
const Game := preload("res://main.tscn")
var boot: Node
var t := 0.0
var last_room := -1
func _ready() -> void:
	boot = Game.instantiate()
	add_child(boot)
func _process(delta: float) -> void:
	t += delta / maxf(Engine.time_scale, 0.05)
	var g = boot.game
	if g == null or g.player == null:
		return
	if not g.auto_mode:
		g.auto_mode = true
		g.tap_down()
		g.tap_up()
	if g.room != last_room:
		last_room = g.room
		print("%.1f room %d" % [t, g.room])
	if g.state != "play" or t > 150.0:
		print("%.1f END state=%s room=%d hp=%s" % [t, g.state, g.room, str(g.party.map(func(p): return int(p.hp)))])
		get_tree().quit()
